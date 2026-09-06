import type { Request, Response } from 'express';
import Stripe from 'stripe';
import { z } from 'zod';
import { databaseEnabled, getDatabaseBranches, getDatabaseCategories, getDatabaseSuppliers, searchDatabaseCatalog } from '../db.js';
import { store } from '../store.js';

const checkoutSchema = z.object({
  branchId: z.number().int().positive(),
  deliveryMode: z.enum(['DELIVERY', 'PICKUP']),
  address: z.string().trim().optional().nullable(),
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
  const data = databaseEnabled ? await searchDatabaseCatalog(query, branchId) : store.searchCatalog(query, branchId);
  return res.json({ success: true, data: data ?? [] });
}

export async function checkout(req: Request, res: Response) {
  const payload = checkoutSchema.parse(req.body);
  const created = store.createWebCheckout(payload);
  const stripe = stripeClient();

  if (!stripe) {
    const paidOrder = store.registerPayment(created.order.id, 'demo', `demo-${created.order.id}`);
    return res.json({
      success: true,
      data: {
        order: paidOrder,
        paymentUrl: `${process.env.APP_BASE_URL?.trim() || 'http://localhost:5173'}/checkout/success/${created.order.code}`,
        mode: 'demo'
      }
    });
  }

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
        currency: 'gtq',
        unit_amount: Math.round(item.product.price * 100),
        product_data: {
          name: item.product.name,
          description: item.product.description
        }
      }
    })),
    success_url: `${apiBaseUrl(req)}/api/public/orders/${created.order.id}`,
    cancel_url: `${process.env.APP_BASE_URL?.trim() || 'http://localhost:5173'}/checkout/cancelada`
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
