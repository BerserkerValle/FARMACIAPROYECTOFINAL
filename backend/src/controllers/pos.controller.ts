/**
 * ============================================================================
 * PROYECTO FARMACIA - CONTROLADOR DE PUNTO DE VENTA (POS) Y DESPACHOS
 * ============================================================================
 * Este módulo gestiona las operaciones diarias del mostrador de farmacia:
 * 1. Ventas en Mostrador (POS):
 *    - Registro de venta presencial inmediata.
 *    - Descuento automático de existencias según regla FEFO (First Expired, First Out).
 *    - Generación de factura electrónica y comprobante para el cliente.
 * 2. Retiro en Sucursal (Pickup):
 *    - Listado de pedidos preparados pendientes de retiro en tienda.
 *    - Validación de receta médica física antes de la entrega final.
 * 3. Envíos y Rutas a Domicilio (Delivery Tracking):
 *    - Listado de órdenes asignadas para entrega motorizada.
 *    - Actualización de telemetría y coordenadas GPS (latitud/longitud).
 *    - Transición de estados de envío: PACKING -> IN_ROUTE -> NEARBY -> DELIVERED.
 * 4. Descarga de Facturas POS:
 *    - Generación y descarga de factura PDF para ventas en mostrador.
 *
 * MÉTODOS Y LIBRERÍAS:
 * - Zod: Validación de coordenadas y estructuras de venta.
 * - Soporte dual: Consultas especializadas en PostgreSQL y operaciones en memoria sincronizadas.
 * ============================================================================
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import {
  claimDatabaseDelivery,
  createDatabaseCheckout,
  databaseEnabled,
  findDatabaseDeliveryOwnership,
  listDatabaseDeliveries,
  updateDatabaseDeliveryTracking,
  checkAndReserveDatabasePosIdempotency,
  confirmDatabasePosIdempotency,
  getDatabasePosIdempotencyOrderId
} from '../db.js';
import { stripeClient } from './public.controller.js';
import { generarFacturaDesdeOrden } from '../services/invoice.service.js';
import { store } from '../store.js';
import { fiscalNitSchema } from '../utils.js';
import {
  FORBIDDEN_MESSAGE,
  canClaimDelivery,
  canReadDelivery,
  canUpdateDelivery,
  isSupervisorRole,
  resolveBranchScope
} from '../utils/permissions.js';

function branchScope(req: Request, requested?: unknown): number | null {
  const fromQuery = requested === undefined || requested === null || requested === ''
    ? null
    : Number(requested);
  return resolveBranchScope(req.user?.role, req.user?.branchId ?? null, Number.isInteger(fromQuery) && fromQuery! > 0 ? fromQuery : null);
}

function forbidden(res: Response) {
  return res.status(403).json({ success: false, message: FORBIDDEN_MESSAGE });
}

// ============================================================================
// ESQUEMAS DE VALIDACIÓN ZOD (DTOs)
// ============================================================================

/**
 * Esquema de validación para la creación de ventas en el Punto de Venta (POS).
 * Requiere la sucursal, datos fiscales del cliente y al menos un producto a facturar.
 */
const saleSchema = z.object({
  branchId: z.number().int().positive('La sucursal debe ser válida'),
  customer: z.object({
    name: z.string().min(2, 'Nombre de cliente requerido'),
    nit: fiscalNitSchema('NIT requerido o ingrese CF'),
    email: z.string().email('Correo de facturación inválido'),
    phone: z.string().min(6, 'Teléfono requerido')
  }),
  items: z.array(
    z.object({
      productId: z.number().int().positive('ID de producto inválido'),
      quantity: z.number().int().positive('La cantidad debe ser mayor a 0')
    })
  ).min(1, 'Debe incluir al menos un producto en la venta')
});

/**
 * Esquema para liberación de pedidos en mostrador.
 * Permite registrar la URL o foto de la receta física presentada en caja.
 */
const releaseSchema = z.object({
  prescriptionDeliveryUrl: z.string().url('URL de receta inválida').optional().nullable()
});

/**
 * Esquema para actualización de estado y telemetría de reparto.
 * Valida coordenadas en rangos geográficos válidos (lat [-90, 90], lng [-180, 180]).
 */
const trackingSchema = z.object({
  status: z.enum(['CREATED', 'PACKING', 'IN_ROUTE', 'NEARBY', 'DELIVERED']).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional()
});

// ============================================================================
// SECCIÓN 1: OPERACIONES DE PUNTO DE VENTA (POS) Y RETIRO (PICKUP)
// ============================================================================

/**
 * Lista las órdenes en espera de entrega o retiro en una sucursal específica.
 * GET /api/pos/orders
 */
export function pickupOrders(req: Request, res: Response) {
  const branchId = branchScope(req, req.query.branchId);
  if (!branchId) {
    return res.status(400).json({ success: false, message: 'Debe definir la sucursal' });
  }
  return res.json({ success: true, data: store.listPendingOrders(branchId) });
}

/**
 * Procesa y registra una venta directa de mostrador en el Punto de Venta.
 * POST /api/pos/sale
 *
 * ¿CÓMO FUNCIONA?
 * 1. Valida los datos con 'saleSchema'.
 * 2. Verifica el inventario disponible en la sucursal del cajero.
 * 3. Aplica FEFO para descontar de los lotes más próximos a caducar.
 * 4. Genera la orden, el registro de pago en efectivo/tarjeta y la factura legal.
 * 5. Requiere Idempotency-Key para evitar duplicados por doble clic / reintento red.
 *    - La clave debe ser única por intento de venta (generada por frontend).
 *    - En reintentos, el frontend reutiliza la misma clave.
 *    - Se valida la huella (X-Request-Fingerprint) para detectar colisiones.
 *
 * IDEMPOTENCIA ATÓMICA:
 * - En PostgreSQL: checkAndReserveDatabasePosIdempotency usa INSERT ... ON CONFLICT
 *   dentro de una transacción para reservar la clave ANTES de crear la venta.
 * - En memoria: checkPosIdempotency + createPosSale + registerPosIdempotency
 *   (riesgo teórico de duplicado si el proceso muere entre create y register).
 */
export function createSale(req: Request, res: Response) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'No autenticado' });
  }
  const payload = saleSchema.parse(req.body);
  const branchId = resolveBranchScope(req.user.role, req.user.branchId, payload.branchId);
  if (!branchId) {
    return res.status(400).json({ success: false, message: 'Debe definir la sucursal' });
  }

  // Idempotencia obligatoria: requerir header 'Idempotency-Key' y 'X-Request-Fingerprint'
  const idempotencyKey = req.header('Idempotency-Key')?.trim();
  const requestFingerprint = req.header('X-Request-Fingerprint')?.trim();

  if (!idempotencyKey) {
    return res.status(400).json({
      success: false,
      message: 'Falta header Idempotency-Key. Genere una clave única por intento de venta.'
    });
  }
  if (!requestFingerprint) {
    return res.status(400).json({
      success: false,
      message: 'Falta header X-Request-Fingerprint. Incluya huella de la solicitud.'
    });
  }

  // Hash de la clave para no almacenar el valor crudo en logs/BD
  const keyHash = createHash('sha256').update(`pos:${req.user.employeeId}:${branchId}:${idempotencyKey}`).digest('hex');

  if (databaseEnabled) {
    // MODO POSTGRESQL: Reserva atómica de la clave ANTES de crear la venta
    return handlePosSaleDatabase(req, res, payload, branchId, keyHash, requestFingerprint);
  }

  // MODO MEMORIA (JSON): Verificar duplicado, crear venta, registrar clave
  return handlePosSaleMemory(req, res, payload, branchId, keyHash, idempotencyKey, requestFingerprint);
}

async function handlePosSaleDatabase(
  req: Request,
  res: Response,
  payload: z.infer<typeof saleSchema>,
  branchId: number,
  keyHash: string,
  requestFingerprint: string
) {
  if (!req.user) return res.status(401).json({ success: false, message: 'No autenticado' });

  try {
    // PASO 1: Reserva atómica de la clave de idempotencia
    // Esto evita que dos requests concurrentes creen la misma venta
    const check = await checkAndReserveDatabasePosIdempotency(
      keyHash,
      req.user.employeeId,
      branchId,
      requestFingerprint,
      5 // TTL 5 minutos
    );

    if (check.isDuplicate) {
      if (check.fingerprintMatch === false) {
        return res.status(409).json({
          success: false,
          message: 'Conflicto de idempotencia: misma clave con contenido de venta diferente. Genere una nueva clave para esta venta.',
          code: 'IDEMPOTENCY_CONFLICT'
        });
      }
      // Misma clave y misma huella → replay idempotente
      if (check.existingOrderId && check.existingOrderId > 0) {
        const existingSale = store.getOrderById(check.existingOrderId);
        if (existingSale) {
          return res.json({
            success: true,
            data: existingSale,
            idempotentReplay: true
          });
        }
      }
      // Clave reservada pero sin orderId aún (creación en progreso por otro request)
      // Esperar brevemente y reintentar lectura
      await new Promise(r => setTimeout(r, 100));
      const orderId = await getDatabasePosIdempotencyOrderId(keyHash);
      if (orderId) {
        const existingSale = store.getOrderById(orderId);
        if (existingSale) {
          return res.json({ success: true, data: existingSale, idempotentReplay: true });
        }
      }
      return res.status(409).json({
        success: false,
        message: 'Venta en proceso con esta clave. Intente de nuevo en unos segundos.',
        code: 'IDEMPOTENCY_IN_PROGRESS'
      });
    }

    // PASO 2: Crear la venta (la clave ya está reservada con order_id = 0)
    const sale = store.createPosSale({ ...payload, branchId }, req.user.employeeId);

    // PASO 3: Confirmar la clave con el orderId real
    await confirmDatabasePosIdempotency(keyHash, sale.order.id);

    return res.json({ success: true, data: sale });
  } catch (error) {
    // Si falla la creación, la clave expira en 5 min y permite reintento
    const message = error instanceof Error ? error.message : 'No se pudo crear la venta';
    return res.status(400).json({ success: false, message });
  }
}

function handlePosSaleMemory(
  req: Request,
  res: Response,
  payload: z.infer<typeof saleSchema>,
  branchId: number,
  keyHash: string,
  idempotencyKey: string,
  requestFingerprint: string
) {
  if (!req.user) return res.status(401).json({ success: false, message: 'No autenticado' });

  const key = `pos:${req.user.employeeId}:${branchId}:${idempotencyKey}`;
  const check = store.checkPosIdempotency(key, requestFingerprint);

  if (check.isDuplicate) {
    if (check.fingerprintMatch === false) {
      return res.status(409).json({
        success: false,
        message: 'Conflicto de idempotencia: misma clave con contenido de venta diferente. Genere una nueva clave para esta venta.',
        code: 'IDEMPOTENCY_CONFLICT'
      });
    }
    if (check.existingOrderId) {
      const existingSale = store.getOrderById(check.existingOrderId);
      if (existingSale) {
        return res.json({
          success: true,
          data: existingSale,
          idempotentReplay: true
        });
      }
    }
  }

  // Crear la venta
  const sale = store.createPosSale({ ...payload, branchId }, req.user.employeeId);

  // Registrar clave de idempotencia con huella SOLO tras éxito
  store.registerPosIdempotency(key, sale.order.id, requestFingerprint);

  return res.json({ success: true, data: sale });
}

export async function createQrPayment(req: Request, res: Response) {
  try {
    const stripe = stripeClient();
    if (!stripe) return res.status(503).json({ success: false, message: 'Stripe no está configurado' });
    const payload = saleSchema.parse(req.body);
    const branchId = resolveBranchScope(req.user?.role, req.user?.branchId ?? null, payload.branchId);
    if (!branchId) {
      return res.status(400).json({ success: false, message: 'Debe definir la sucursal' });
    }
    const checkout = {
      branchId,
      deliveryMode: 'PICKUP' as const,
      paymentMethod: 'STRIPE' as const,
      address: null,
      deliveryLatitude: null,
      deliveryLongitude: null,
      customer: payload.customer,
      items: payload.items,
      prescriptionWebUrl: null
    };
    const created = databaseEnabled
      ? await createDatabaseCheckout(checkout)
      : store.createWebCheckout(checkout);
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(created.order.total * 100),
      currency: process.env.STRIPE_CURRENCY?.trim().toLowerCase() || 'gtq',
      automatic_payment_methods: { enabled: true },
      receipt_email: created.customer.email,
      description: 'Venta POS ' + created.order.code,
      metadata: {
        orderId: String(created.order.id),
        orderCode: created.order.code,
        posPayment: 'true'
      }
    });
    const appUrl = process.env.APP_BASE_URL?.trim() || 'http://localhost:5173';
    return res.status(201).json({
      success: true,
      data: {
        order: created.order,
        paymentIntentId: paymentIntent.id,
        paymentUrl: appUrl + '/?posPayment=' + encodeURIComponent(paymentIntent.id)
      }
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error instanceof Error ? error.message : 'No se pudo crear el pago QR' });
  }
}

/**
 * Entrega una orden preparada al cliente en mostrador (Pickup).
 * POST /api/pos/orders/:id/release
 * Si los productos requieren prescripción médica, almacena la constancia de validación.
 */
export function releasePickup(req: Request, res: Response) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'No autenticado' });
  }
  const orderId = Number(req.params.id);
  const payload = releaseSchema.parse(req.body ?? {});
  const order = store.releasePickupOrder(orderId, req.user.employeeId, payload.prescriptionDeliveryUrl ?? null);
  return res.json({ success: true, data: order });
}

// ============================================================================
// SECCIÓN 2: GESTIÓN DE ENVÍOS A DOMICILIO Y SEGUIMIENTO GPS
// ============================================================================

/**
 * Obtiene los pedidos a domicilio asignados a la sucursal del repartidor.
 * GET /api/pos/deliveries
 */
export async function deliveries(req: Request, res: Response) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'No autenticado' });
  }
  const actor = { employeeId: req.user.employeeId, role: req.user.role, branchId: req.user.branchId };
  const branchId = branchScope(req, req.query.branchId);
  if (!branchId) {
    return res.status(400).json({ success: false, message: 'Debe definir la sucursal' });
  }

  if (databaseEnabled) {
    const rows = await listDatabaseDeliveries(branchId, {
      employeeId: actor.employeeId,
      restrictToAssignee: !isSupervisorRole(actor.role)
    });
    const data = rows.filter((row) => canReadDelivery(actor, {
      branchId: Number(row.branchId),
      assignedEmployeeId: row.assignedEmployeeId == null ? null : Number(row.assignedEmployeeId)
    }));
    return res.json({ success: true, data });
  }

  const data = store
    .listDeliveries(branchId, actor)
    .filter((order) => canReadDelivery(actor, { branchId: order.branchId, assignedEmployeeId: order.assignedEmployeeId ?? null }));
  return res.json({ success: true, data });
}

/**
 * Actualiza el estado del despacho y/o la ubicación GPS del repartidor en ruta.
 * PATCH /api/pos/deliveries/:id
 *
 * Permite que los clientes sigan el avance de su pedido en el mapa interactivo.
 */
export async function updateDelivery(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'No autenticado' });
    }
    const payload = trackingSchema.parse(req.body);
    const deliveryId = Number(req.params.id);
    const actor = { employeeId: req.user.employeeId, role: req.user.role, branchId: req.user.branchId };

    if (databaseEnabled) {
      const ownership = await findDatabaseDeliveryOwnership(deliveryId);
      if (!ownership) {
        return res.status(404).json({ success: false, message: 'Seguimiento no encontrado' });
      }
      if (!canUpdateDelivery(actor, ownership)) return forbidden(res);
      if (canClaimDelivery(actor, ownership)) {
        const claimed = await claimDatabaseDelivery(deliveryId, actor.employeeId);
        if (!claimed) {
          const currentOwnership = await findDatabaseDeliveryOwnership(deliveryId);
          if (!currentOwnership || !canReadDelivery(actor, currentOwnership)) return forbidden(res);
        }
      }
      const data = await updateDatabaseDeliveryTracking(deliveryId, {
        status: payload.status,
        ...(payload.latitude !== undefined ? { riderLatitude: payload.latitude } : {}),
        ...(payload.longitude !== undefined ? { riderLongitude: payload.longitude } : {})
      });
      return res.json({ success: true, data });
    }

    const ownership = store.getDeliveryOwnership(deliveryId);
    if (!ownership) {
      return res.status(404).json({ success: false, message: 'Seguimiento no encontrado' });
    }
    if (!canUpdateDelivery(actor, ownership)) return forbidden(res);
    if (canClaimDelivery(actor, ownership)) {
      store.claimDelivery(deliveryId, actor.employeeId);
    }
    const data = store.updateDelivery(deliveryId, payload, actor);
    return res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo actualizar la entrega';
    return res.status(400).json({ success: false, message });
  }
}

// ============================================================================
// SECCIÓN 3: DESCARGA DE FACTURAS POS
// ============================================================================

/**
 * Descarga la factura PDF de una venta POS completada.
 * GET /api/pos/sales/:id/invoice
 * Solo personal autorizado (cajeros, gerentes, administradores) de la misma sucursal.
 */
export async function downloadPosInvoice(req: Request, res: Response) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'No autenticado' });
  }

  const orderId = Number(req.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return res.status(400).json({ success: false, message: 'ID de venta inválido' });
  }

  // Verificar que la orden existe y es una venta POS
  const order = store.getOrderById(orderId);
  if (!order) {
    return res.status(404).json({ success: false, message: 'Venta no encontrada' });
  }

  if (order.source !== 'POS') {
    return res.status(400).json({ success: false, message: 'Esta orden no es una venta de mostrador' });
  }

  // Verificar permisos: cajero de la misma sucursal o supervisor
  const actorBranchId = req.user.branchId;
  const actorRole = req.user.role;
  const isSupervisor = actorRole === 'Administrador' || actorRole === 'Gerente';

  if (!isSupervisor && actorBranchId !== order.branchId) {
    return res.status(403).json({ success: false, message: 'No tiene permisos para acceder a esta factura' });
  }

  // Verificar que la venta está pagada
  if (order.paymentStatus !== 'PAID') {
    return res.status(400).json({ success: false, message: 'La venta no está pagada, no se puede generar factura' });
  }

  try {
    const { pdfBuffer } = await generarFacturaDesdeOrden(orderId, false);

    const invoice = store.getInvoiceByOrderId(orderId);
    const filename = invoice ? 'factura-' + invoice.invoiceNumber + '.pdf' : 'factura-' + order.code + '.pdf';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=\"' + filename + '\"');
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.send(pdfBuffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error generando la factura';
    console.error('[POS] Error generando factura:', error);
    return res.status(500).json({ success: false, message });
  }
}
