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
 *
 * MÉTODOS Y LIBRERÍAS:
 * - Zod: Validación de coordenadas y estructuras de venta.
 * - Soporte dual: Consultas especializadas en PostgreSQL y operaciones en memoria sincronizadas.
 * ============================================================================
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import { databaseEnabled, listDatabaseDeliveries, updateDatabaseDeliveryTracking } from '../db.js';
import { store } from '../store.js';

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
    nit: z.string().min(3, 'NIT requerido o ingrese CF'),
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
  const branchId = req.user?.branchId ?? (req.query.branchId ? Number(req.query.branchId) : undefined);
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
 * 1. Valida los datos con `saleSchema`.
 * 2. Verifica el inventario disponible en la sucursal del cajero.
 * 3. Aplica FEFO para descontar de los lotes más próximos a caducar.
 * 4. Genera la orden, el registro de pago en efectivo/tarjeta y la factura legal.
 */
export function createSale(req: Request, res: Response) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'No autenticado' });
  }
  const payload = saleSchema.parse(req.body);
  const sale = store.createPosSale(payload, req.user.employeeId);
  return res.json({ success: true, data: sale });
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
  const branchId = req.user?.branchId ?? (req.query.branchId ? Number(req.query.branchId) : undefined);
  if (!branchId) {
    return res.status(400).json({ success: false, message: 'Debe definir la sucursal' });
  }
  const data = databaseEnabled 
    ? await listDatabaseDeliveries(branchId) 
    : store.listPendingOrders(branchId).filter((order) => order.deliveryMode === 'DELIVERY');
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
    const payload = trackingSchema.parse(req.body);
    if (databaseEnabled) {
      const data = await updateDatabaseDeliveryTracking(Number(req.params.id), payload);
      return res.json({ success: true, data });
    }
    const data = store.updateDelivery(Number(req.params.id), payload);
    return res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo actualizar la entrega';
    return res.status(400).json({ success: false, message });
  }
}
