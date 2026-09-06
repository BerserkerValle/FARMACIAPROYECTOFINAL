import type { Request, Response } from 'express';
import { z } from 'zod';
import { databaseEnabled, listDatabaseDeliveries, updateDatabaseDeliveryTracking } from '../db.js';
import { store } from '../store.js';

const saleSchema = z.object({
  branchId: z.number().int().positive(),
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
  ).min(1)
});

const releaseSchema = z.object({
  prescriptionDeliveryUrl: z.string().url().optional().nullable()
});

const trackingSchema = z.object({
  status: z.enum(['CREATED', 'PACKING', 'IN_ROUTE', 'NEARBY', 'DELIVERED']).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional()
});

export function pickupOrders(req: Request, res: Response) {
  const branchId = req.user?.branchId ?? (req.query.branchId ? Number(req.query.branchId) : undefined);
  if (!branchId) {
    return res.status(400).json({ success: false, message: 'Debe definir la sucursal' });
  }
  return res.json({ success: true, data: store.listPendingOrders(branchId) });
}

export function createSale(req: Request, res: Response) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'No autenticado' });
  }
  const payload = saleSchema.parse(req.body);
  const sale = store.createPosSale(payload, req.user.employeeId);
  return res.json({ success: true, data: sale });
}

export function releasePickup(req: Request, res: Response) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'No autenticado' });
  }
  const orderId = Number(req.params.id);
  const payload = releaseSchema.parse(req.body ?? {});
  const order = store.releasePickupOrder(orderId, req.user.employeeId, payload.prescriptionDeliveryUrl ?? null);
  return res.json({ success: true, data: order });
}

export async function deliveries(req: Request, res: Response) {
  const branchId = req.user?.branchId ?? (req.query.branchId ? Number(req.query.branchId) : undefined);
  if (!branchId) return res.status(400).json({ success: false, message: 'Debe definir la sucursal' });
  const data = databaseEnabled ? await listDatabaseDeliveries(branchId) : store.listPendingOrders(branchId).filter((order) => order.deliveryMode === 'DELIVERY');
  return res.json({ success: true, data });
}

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
