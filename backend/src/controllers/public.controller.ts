import type { Request, Response } from 'express';
import Stripe from 'stripe';
import { z } from 'zod';
import { createDatabaseCheckout, createDatabaseDeliveryTracking, databaseEnabled, findDatabaseCustomerAccount, findDatabaseCustomerAccountById, getDatabaseBranches, getDatabaseCategories, getDatabaseSuppliers, listDatabaseCustomerOrders, registerDatabasePayment, searchDatabaseCatalog } from '../db.js';
import { store } from '../store.js';

const checkoutSchema = z.object({
  branchId: z.number().int().positive(),
  deliveryMode: z.enum(['DELIVERY', 'PICKUP']),
  paymentMethod: z.enum(['STRIPE', 'CASH']),
  address: z.string().trim().optional().nullable(),
  deliveryLatitude: z.number().min(-90).max(90).optional().nullable(),
  deliveryLongitude: z.number().min(-180).max(180).optional().nullable(),
  customer: z.object({
    name: z.string().min(2),
    nit: z.string().min(3),
    email: z.string().email(),
    phone: z.string().min(6)
  }),
  items: z.array(
    z.object({
      productId: z.number().int().positive(),
      quantity: z.number().int().positive()
    })
  ).min(1),
  prescriptionWebUrl: z.string().url().optional().nullable()
});

const uploadSchema = z.object({
  orderId: z.coerce.number().int().positive(),
  kind: z.enum(['web', 'delivery'])
});

function apiBaseUrl(req: Request) {
  return process.env.API_BASE_URL?.trim() || `${req.protocol}://${req.get('host')}`;
}

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    return null;
  }
  return new Stripe(key, {
    apiVersion: '2025-02-24.acacia'
  });
}

export async function branches(_req: Request, res: Response) {
  const data = databaseEnabled ? await getDatabaseBranches() : store.getBranches();
  return res.json({ success: true, data: data ?? [] });
}

export async function categories(_req: Request, res: Response) {
  const data = databaseEnabled ? await getDatabaseCategories() : store.getCategories();
  return res.json({ success: true, data: data ?? [] });
}

export async function suppliers(_req: Request, res: Response) {
  const data = databaseEnabled ? await getDatabaseSuppliers() : store.getSuppliers();
  return res.json({ success: true, data: data ?? [] });
}

export async function catalog(req: Request, res: Response) {
  const query = String(req.query.q ?? '').trim();
  const branchId = req.query.branchId ? Number(req.query.branchId) : undefined;
  const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
  const data = databaseEnabled
    ? await searchDatabaseCatalog(query, branchId, categoryId)
    : store.searchCatalog(query, branchId, categoryId);
  return res.json({ success: true, data: data ?? [] });
}

export async function checkout(req: Request, res: Response) {
  try {
    const payload = checkoutSchema.parse(req.body);
    const created = databaseEnabled ? await createDatabaseCheckout(payload) : store.createWebCheckout(payload);
    const customerAccountId = Number(req.header('x-customer-id'));
    if (databaseEnabled && payload.deliveryMode === 'DELIVERY') {
      const account = Number.isInteger(customerAccountId) && customerAccountId > 0
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

    const appUrl = process.env.APP_BASE_URL?.trim() || 'http://localhost:5173';
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: created.customer.email,
      metadata: {
        orderId: String(created.order.id),
        orderCode: created.order.code
      },
      line_items: created.items.map((item) => ({
        quantity: item.quantity,
        price_data: {
          currency: process.env.STRIPE_CURRENCY?.trim().toLowerCase() || 'gtq',
          unit_amount: Math.round(item.product.price * 100),
          product_data: {
            name: item.product.name,
            description: item.product.description
          }
        }
      })),
      success_url: `${appUrl}/?payment=success&order=${created.order.code}`,
      cancel_url: `${appUrl}/?payment=cancelled&order=${created.order.code}`
    });

    return res.json({
      success: true,
      data: {
        order: created.order,
        customer: created.customer,
        paymentUrl: session.url,
        mode: 'stripe'
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo iniciar el pago con Stripe';
    return res.status(400).json({ success: false, message });
  }
}

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
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = Number(session.metadata?.orderId);
      if (Number.isInteger(orderId) && orderId > 0) {
        if (databaseEnabled) {
          await registerDatabasePayment(orderId, session.payment_intent ? String(session.payment_intent) : session.id, Number(session.amount_total ?? 0) / 100);
        } else {
          store.registerPayment(orderId, 'stripe', session.payment_intent ? String(session.payment_intent) : session.id);
        }
      }
    }
    return res.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Webhook inválido';
    return res.status(400).json({ success: false, message });
  }
}

export function getOrder(req: Request, res: Response) {
  const orderId = Number(req.params.id);
  const order = store.getOrderById(orderId);
  if (!order) {
    return res.status(404).json({ success: false, message: 'Orden no encontrada' });
  }
  return res.json({ success: true, data: order });
}

export function uploadPrescription(req: Request, res: Response) {
  const parsed = uploadSchema.parse(req.body);
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Debe adjuntar un archivo de receta' });
  }
  const url = `${apiBaseUrl(req)}/uploads/${req.file.filename}`;
  const order = store.attachPrescription(parsed.orderId, parsed.kind, url);
  return res.json({ success: true, data: { order, url } });
}

export function uploadTemporaryPrescription(req: Request, res: Response) {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Debe adjuntar un archivo de receta' });
  }
  const url = `${apiBaseUrl(req)}/uploads/${req.file.filename}`;
  return res.json({ success: true, data: { url } });
}

export function trackOrder(req: Request, res: Response) {
  const code = String(req.params.code || '').trim();
  const order = store.findOrderByCode(code);
  if (!order) {
    return res.status(404).json({ success: false, message: 'Orden no encontrada' });
  }
  return res.json({ success: true, data: order });
}

export async function customerOrders(req: Request, res: Response) {
  const customerId = Number(req.header('x-customer-id'));
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return res.status(401).json({ success: false, message: 'Inicia sesión como cliente para ver tus pedidos' });
  }
  const data = databaseEnabled ? await listDatabaseCustomerOrders(customerId) : store.listCustomerOrders(customerId);
  return res.json({ success: true, data });
}
