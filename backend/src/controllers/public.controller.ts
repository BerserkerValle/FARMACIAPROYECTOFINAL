/**
 * ============================================================================
 * PROYECTO FARMACIA - CONTROLADOR PÚBLICO Y TIENDA VIRTUAL (E-COMMERCE)
 * ============================================================================
 * Este módulo contiene todos los endpoints accesibles para clientes y público:
 * 1. Catálogo de Productos y Búsqueda:
 *    - Filtro en tiempo real por nombre/SKU, sucursal física y categoría.
 *    - Disponibilidad de inventario consolidado.
 * 2. Proceso de Checkout y Pagos:
 *    - Soporte para entrega a domicilio (Delivery con coordenadas) y retiro (Pickup).
 *    - Pasarela de pagos con tarjeta de crédito mediante Stripe Checkout Sessions.
 *    - Soporte para pago contra entrega en efectivo (CASH) y modo demostración.
 * 3. Webhook de Seguridad de Stripe:
 *    - Verificación criptográfica con la firma `stripe-signature` y cuerpo crudo (buffer).
 *    - Conciliación automática de la orden una vez completada la transacción.
 * 4. Gestión de Recetas Médicas Digitales:
 *    - Carga de imágenes/PDF de prescripción médica vía Multer.
 *    - Vinculación obligatoria para medicamentos controlados.
 * 5. Rastreo y Seguimiento de Órdenes:
 *    - Búsqueda pública por código correlativo (ej: ORD-00001).
 *    - Historial de pedidos por cliente autenticado.
 * ============================================================================
 */

import type { Request, Response } from 'express';
import Stripe from 'stripe';
import { z } from 'zod';
import { 
  createDatabaseCheckout, 
  createDatabaseDeliveryTracking, 
  databaseEnabled, 
  findDatabaseCustomerAccount, 
  findDatabaseCustomerAccountById, 
  getDatabaseBranches, 
  getDatabaseCategories, 
  getDatabaseSuppliers, 
  listDatabaseCustomerOrders, 
  registerDatabasePayment, 
  searchDatabaseCatalog 
} from '../db.js';
import { store } from '../store.js';
import { FORBIDDEN_MESSAGE } from '../utils/permissions.js';

async function resolveAuthenticatedCustomer(customerId: number) {
  if (databaseEnabled) {
    const account = await findDatabaseCustomerAccountById(customerId);
    if (!account) return null;
    return { name: account.fullName, email: account.email, phone: account.phone, nit: account.nit };
  }
  const account = store.getCustomerById(customerId);
  if (!account) return null;
  return { name: account.name, email: account.email, phone: account.phone, nit: account.nit };
}

function authenticatedCustomerId(res: Response): number | null {
  const raw = Number(res.locals.customerId);
  return Number.isInteger(raw) && raw > 0 ? raw : null;
}

function forbidUnlessOwner(res: Response, isStaff: boolean, owns: boolean): boolean {
  if (isStaff || owns) return false;
  res.status(403).json({ success: false, message: FORBIDDEN_MESSAGE });
  return true;
}

// ============================================================================
// ESQUEMAS DE VALIDACIÓN ZOD (DTOs)
// ============================================================================

/** Esquema de validación para la creación de órdenes de compra desde la tienda */
const checkoutSchema = z.object({
  branchId: z.number().int().positive('Debe seleccionar una sucursal válida'),
  deliveryMode: z.enum(['DELIVERY', 'PICKUP']),
  paymentMethod: z.enum(['STRIPE', 'CASH']),
  address: z.string().trim().optional().nullable(),
  deliveryLatitude: z.number().min(-90).max(90).optional().nullable(),
  deliveryLongitude: z.number().min(-180).max(180).optional().nullable(),
  customer: z.object({
    name: z.string().min(2, 'Nombre de cliente requerido'),
    nit: z.string().min(3, 'NIT requerido o ingrese CF'),
    email: z.string().email('Correo electrónico de facturación inválido'),
    phone: z.string().min(6, 'Número telefónico requerido')
  }),
  items: z.array(
    z.object({
      productId: z.number().int().positive(),
      quantity: z.number().int().positive()
    })
  ).min(1, 'El carrito no puede estar vacío'),
  prescriptionWebUrl: z.string().url('URL de receta inválida').optional().nullable()
});

/** Esquema para carga de archivo de receta médica vinculada a una orden existente */
const uploadSchema = z.object({
  orderId: z.coerce.number().int().positive(),
  kind: z.enum(['web', 'delivery'])
});

// ============================================================================
// UTILIDADES INTERNAS DE COMUNICACIÓN Y PASARELAS
// ============================================================================

/**
 * Obtiene la URL base de la API para construir las rutas absolutas a archivos subidos.
 */
function apiBaseUrl(req: Request): string {
  return process.env.API_BASE_URL?.trim() || `${req.protocol}://${req.get('host')}`;
}

/**
 * Instancia el cliente del SDK oficial de Stripe con su API key secreta.
 * Retorna null si la variable no está configurada, permitiendo modo demo.
 */
export function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    return null;
  }
  return new Stripe(key, {
    apiVersion: '2025-02-24.acacia'
  });
}

export async function getPosPayment(req: Request, res: Response) {
  const stripe = stripeClient();
  const paymentIntentId = String(req.params.paymentIntentId ?? '').trim();
  if (!stripe || !/^pi_[A-Za-z0-9]+$/.test(paymentIntentId)) {
    return res.status(404).json({ success: false, message: 'Pago no encontrado' });
  }

  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (!paymentIntent.metadata.posPayment) {
      return res.status(404).json({ success: false, message: 'Pago no encontrado' });
    }
    return res.json({
      success: true,
      data: {
        clientSecret: paymentIntent.client_secret,
        amount: paymentIntent.amount,
        status: paymentIntent.status
      }
    });
  } catch {
    return res.status(404).json({ success: false, message: 'Pago no encontrado o expirado' });
  }
}

// ============================================================================
// SECCIÓN 1: CATÁLOGO Y CONSULTAS PÚBLICAS
// ============================================================================

/** Obtiene las sucursales disponibles para despacho o retiro */
export async function branches(_req: Request, res: Response) {
  const data = databaseEnabled ? await getDatabaseBranches() : store.getBranches();
  return res.json({ success: true, data: data ?? [] });
}

/** Obtiene las categorías de productos para el menú de navegación */
export async function categories(_req: Request, res: Response) {
  const data = databaseEnabled ? await getDatabaseCategories() : store.getCategories();
  return res.json({ success: true, data: data ?? [] });
}

/** Obtiene la lista de laboratorios farmacéuticos */
export async function suppliers(_req: Request, res: Response) {
  const data = databaseEnabled ? await getDatabaseSuppliers() : store.getSuppliers();
  return res.json({ success: true, data: data ?? [] });
}

/**
 * Búsqueda y filtrado del catálogo público de medicamentos.
 * GET /api/public/catalog?q=paracetamol&branchId=1&categoryId=2&minPrice=10&maxPrice=100
 * 
 * ¿CÓMO FUNCIONA?
 * - Si `databaseEnabled` es true, realiza consulta SQL optimizada con ILIKE.
 * - Si está en memoria, filtra la colección de productos contrastando texto y sucursal.
 */
export async function catalog(req: Request, res: Response) {
  const query = String(req.query.q ?? '').trim();
  const branchId = req.query.branchId ? Number(req.query.branchId) : undefined;
  const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
  const minPrice = req.query.minPrice ? Number(req.query.minPrice) : undefined;
  const maxPrice = req.query.maxPrice ? Number(req.query.maxPrice) : undefined;
  const data = databaseEnabled
    ? await searchDatabaseCatalog(query, branchId, categoryId, minPrice, maxPrice)
    : store.searchCatalog(query, branchId, categoryId, minPrice, maxPrice);
  return res.json({ success: true, data: data ?? [] });
}

// ============================================================================
// SECCIÓN 2: CHECKOUT Y PROCESAMIENTO DE PAGOS
// ============================================================================

/**
 * Procesa la compra de productos desde la tienda web.
 * POST /api/public/checkout
 * 
 * ¿CÓMO FUNCIONA?
 * 1. Valida el carrito, datos del comprador y modo de entrega (Delivery o Pickup).
 * 2. Verifica si alguno de los medicamentos requiere receta médica obligatoria.
 * 3. Crea la orden en PostgreSQL o almacén en memoria.
 * 4. Si el pago es en efectivo (CASH), finaliza la orden en estado AWAITING_PAYMENT.
 * 5. Si el pago es con tarjeta (STRIPE):
 *    - Si Stripe está configurado: Genera una sesión de pago alojada en Stripe (`stripe.checkout.sessions.create`).
 *    - Si no está configurado: Utiliza una pasarela simulada (Modo Demo).
 */
export async function checkout(req: Request, res: Response) {
  try {
    const payload = checkoutSchema.parse(req.body);
    const customerAccountId = authenticatedCustomerId(res);

    // Si la sesión es de cliente autenticado, su identidad se toma del token y nunca del body,
    // para que no pueda sobrescribir los datos de otra cuenta enviando su NIT o correo.
    if (customerAccountId) {
      const account = await resolveAuthenticatedCustomer(customerAccountId);
      if (!account) throw new Error('Cuenta de cliente no encontrada');
      payload.customer = account;
    }

    const created = databaseEnabled ? await createDatabaseCheckout(payload) : store.createWebCheckout(payload);
    
    // Si la entrega es a domicilio, registra el seguimiento inicial para el mapa de repartidor
    if (databaseEnabled && payload.deliveryMode === 'DELIVERY') {
      const account = customerAccountId
        ? await findDatabaseCustomerAccountById(customerAccountId)
        : await findDatabaseCustomerAccount(payload.customer.email);
      if (!account) throw new Error('No se encontró la cuenta de cliente para registrar el seguimiento');
      await createDatabaseDeliveryTracking({
        orderCode: created.order.code,
        customerId: account.customerId,
        branchId: payload.branchId,
        address: payload.address ?? '',
        latitude: payload.deliveryLatitude ?? null,
        longitude: payload.deliveryLongitude ?? null,
        deliveryMode: payload.deliveryMode
      });
    }
    const stripe = payload.paymentMethod === 'STRIPE' ? stripeClient() : null;

    // Opción A: Pago en efectivo contra entrega o en ventanilla
    if (payload.paymentMethod === 'CASH') {
      return res.json({
        success: true,
        data: {
          order: created.order,
          paymentUrl: null,
          mode: 'cash',
          message: payload.deliveryMode === 'DELIVERY'
            ? 'Pedido recibido. Pagarás en efectivo al recibirlo.'
            : 'Pedido recibido. Pagarás en efectivo al recogerlo en la sucursal.'
        }
      });
    }

    // Opción B: Pasarela simulada en caso de no contar con claves de Stripe
    if (!stripe) {
      const paidOrder = databaseEnabled
        ? created.order
        : store.registerPayment(created.order.id, 'demo', `demo-${created.order.id}`);
      return res.json({
        success: true,
        data: {
          order: paidOrder,
          paymentUrl: `${process.env.APP_BASE_URL?.trim() || 'http://localhost:5173'}/?payment=success&order=${created.order.code}`,
          mode: 'demo'
        }
      });
    }

    // Opción C: Generación de Checkout Session con Stripe
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(created.order.total * 100),
      currency: process.env.STRIPE_CURRENCY?.trim().toLowerCase() || 'gtq',
      automatic_payment_methods: { enabled: true },
      receipt_email: created.customer.email,
      description: `Orden ${created.order.code}`,
      metadata: {
        orderId: String(created.order.id),
        orderCode: created.order.code
      }
    });

    return res.json({
      success: true,
      data: {
        order: created.order,
        customer: created.customer,
        clientSecret: paymentIntent.client_secret,
        mode: 'stripe'
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo iniciar el pago con Stripe';
    return res.status(400).json({ success: false, message });
  }
}

// ============================================================================
// SECCIÓN 3: WEBHOOK DE CONCILIACIÓN DE PAGOS STRIPE
// ============================================================================

/**
 * Endpoint de Webhook invocado por los servidores de Stripe.
 * POST /api/webhooks/stripe
 * 
 * ¿CÓMO FUNCIONA?
 * 1. Requiere el cuerpo de la petición sin procesar (`express.raw({ type: 'application/json' })`).
 * 2. Verifica la autenticidad con `stripe.webhooks.constructEvent` y el secreto de webhook.
 * 3. Al recibir `payment_intent.succeeded` (o sesiones antiguas), registra el pago
 *    y descuenta el inventario definitivo si no se había hecho previamente.
 */
export async function stripeWebhook(req: Request, res: Response) {
  const stripe = stripeClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!stripe || !webhookSecret) {
    return res.status(503).json({ success: false, message: 'Stripe Webhook no está configurado' });
  }

  try {
    const signature = req.header('stripe-signature');
    if (!signature || !Buffer.isBuffer(req.body)) {
      return res.status(400).json({ success: false, message: 'Firma de Stripe ausente' });
    }
    const event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
    if (event.type === 'checkout.session.completed' || event.type === 'payment_intent.succeeded') {
      const payment = event.data.object as Stripe.Checkout.Session | Stripe.PaymentIntent;
      const orderId = Number(payment.metadata?.orderId);
      if (Number.isInteger(orderId) && orderId > 0) {
        if (databaseEnabled) {
          const transactionId = event.type === 'payment_intent.succeeded'
            ? payment.id
            : (payment as Stripe.Checkout.Session).payment_intent
              ? String((payment as Stripe.Checkout.Session).payment_intent)
              : payment.id;
          const amount = event.type === 'payment_intent.succeeded'
            ? Number((payment as Stripe.PaymentIntent).amount_received ?? (payment as Stripe.PaymentIntent).amount) / 100
            : Number((payment as Stripe.Checkout.Session).amount_total ?? 0) / 100;
          await registerDatabasePayment(orderId, transactionId, amount);
        } else {
          store.registerPayment(orderId, 'stripe', payment.id);
        }
      }
    }
    return res.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Webhook inválido';
    return res.status(400).json({ success: false, message });
  }
}

// ============================================================================
// SECCIÓN 4: SUBIDA DE RECETAS MÉDICAS (MULTER)
// ============================================================================

/**
 * Vincula una receta médica a una orden existente.
 * POST /api/public/orders/prescription
 * Solo el cliente propietario de la orden o el personal autorizado puede adjuntarla.
 */
export function uploadPrescription(req: Request, res: Response) {
  const parsed = uploadSchema.parse(req.body);
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Debe adjuntar un archivo de receta' });
  }
  const orderId = Number(parsed.orderId);
  const rawOrder = store.getOrderById(orderId);
  if (!rawOrder) {
    return res.status(404).json({ success: false, message: 'Orden no encontrada' });
  }
  if (!req.user) {
    const customerId = authenticatedCustomerId(res);
    if (!customerId || !store.customerOwnsOrder(customerId, rawOrder)) {
      return res.status(403).json({ success: false, message: FORBIDDEN_MESSAGE });
    }
  }
  const url = `${apiBaseUrl(req)}/uploads/${req.file.filename}`;
  const order = store.attachPrescription(parsed.orderId, parsed.kind, url);
  return res.json({ success: true, data: { order, url } });
}

/**
 * Permite subir una receta temporal durante el proceso de compra antes de confirmar la orden.
 * POST /api/public/prescriptions/temp
 */
export function uploadTemporaryPrescription(req: Request, res: Response) {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Debe adjuntar un archivo de receta' });
  }
  const url = `${apiBaseUrl(req)}/uploads/${req.file.filename}`;
  return res.json({ success: true, data: { url } });
}

// ============================================================================
// SECCIÓN 5: CONSULTA Y RASTREO DE ÓRDENES
// ============================================================================

/**
 * Obtiene una orden por su identificador numérico.
 * Solo el cliente propietario de la orden o el personal autorizado puede verla.
 */
export function getOrder(req: Request, res: Response) {
  const orderId = Number(req.params.id);
  const customerId = authenticatedCustomerId(res);
  const order = req.user
    ? store.getOrderById(orderId)
    : customerId
      ? store.getOrderByIdForCustomer(customerId, orderId)
      : null;
  if (!order) {
    if (customerId) return res.status(403).json({ success: false, message: FORBIDDEN_MESSAGE });
    return res.status(404).json({ success: false, message: 'Orden no encontrada' });
  }
  return res.json({ success: true, data: order });
}

/**
 * Consulta el estado y telemetría de una orden mediante su código público (ej: 'ORD-00004').
 * GET /api/public/orders/track/:code
 * Solo el cliente propietario de la orden o el personal autorizado puede rastrearla.
 */
export function trackOrder(req: Request, res: Response) {
  const code = String(req.params.code || '').trim();
  const customerId = authenticatedCustomerId(res);
  const order = req.user
    ? store.findOrderByCode(code)
    : customerId
      ? store.findOrderByCodeForCustomer(customerId, code)
      : null;
  if (!order) {
    if (customerId) return res.status(403).json({ success: false, message: FORBIDDEN_MESSAGE });
    return res.status(404).json({ success: false, message: 'Orden no encontrada' });
  }
  return res.json({ success: true, data: order });
}

/**
 * Lista el historial de compras del cliente logueado en la tienda web.
 * GET /api/public/customers/orders
 */
export async function customerOrders(req: Request, res: Response) {
  const customerId = Number(res.locals.customerId);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return res.status(401).json({ success: false, message: 'Inicia sesión como cliente para ver tus pedidos' });
  }
  const data = databaseEnabled ? await listDatabaseCustomerOrders(customerId) : store.listCustomerOrders(customerId);
  return res.json({ success: true, data });
}
