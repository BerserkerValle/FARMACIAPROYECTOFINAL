import type { Request, Response } from 'express';
import { z } from 'zod';
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
