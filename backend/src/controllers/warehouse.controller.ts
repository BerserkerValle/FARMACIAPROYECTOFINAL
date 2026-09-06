import type { Request, Response } from 'express';
import { z } from 'zod';
import { createDatabaseProduct, databaseEnabled, deleteDatabaseProduct, listDatabaseProducts } from '../db.js';
import { store } from '../store.js';

const receiveSchema = z.object({
  branchId: z.number().int().positive(),
  supplierId: z.number().int().positive(),
  productId: z.number().int().positive(),
  batchCode: z.string().min(3),
  expirationDate: z.string().min(8),
  productionDate: z.string().min(8),
  quantity: z.number().int().positive(),
  costPrice: z.number().positive(),
  salePrice: z.number().positive()
});

const createProductSchema = z.object({
  sku: z.string().min(2),
  name: z.string().min(2),
  categoryId: z.coerce.number().int().positive().nullable().default(null),
  brand: z.string().min(1),
  laboratory: z.string().min(1),
  presentation: z.string().min(1),
  unitMeasure: z.string().min(1),
  sanitaryRegistry: z.string().min(1),
  requiresPrescription: z.boolean().default(false),
  active: z.boolean().optional().default(true),
  description: z.string().min(1),
  price: z.coerce.number().positive(),
  cost: z.coerce.number().positive(),
  imageUrl: z.string().trim().optional().nullable(),
  initialStock: z
    .object({
      branchId: z.coerce.number().int().positive(),
      supplierId: z.coerce.number().int().positive(),
      batchCode: z.string().min(1),
      expirationDate: z.string().min(8),
      productionDate: z.string().min(8),
      quantity: z.coerce.number().int().positive()
    })
    .optional()
    .nullable()
});

const updateProductSchema = z.object({
  sku: z.string().min(2).optional(),
  name: z.string().min(2).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  brand: z.string().min(1).optional(),
  laboratory: z.string().min(1).optional(),
  presentation: z.string().min(1).optional(),
  unitMeasure: z.string().min(1).optional(),
  sanitaryRegistry: z.string().min(1).optional(),
  requiresPrescription: z.boolean().optional(),
  active: z.boolean().optional(),
  description: z.string().min(1).optional(),
  price: z.coerce.number().positive().optional(),
  cost: z.coerce.number().positive().optional(),
  imageUrl: z.string().trim().optional().nullable()
});

function apiBaseUrl(req: Request) {
  return process.env.API_BASE_URL?.trim() || `${req.protocol}://${req.get('host')}`;
}

export function lots(req: Request, res: Response) {
  const branchId = req.user?.branchId ?? (req.query.branchId ? Number(req.query.branchId) : undefined);
  const productId = req.query.productId ? Number(req.query.productId) : undefined;
  return res.json({ success: true, data: store.getLots(productId, branchId) });
}

export function receive(req: Request, res: Response) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'No autenticado' });
  }
  const payload = receiveSchema.parse(req.body);
  const lot = store.receiveGoods({ ...payload, employeeId: req.user.employeeId });
  return res.status(201).json({ success: true, data: lot });
}

export async function listProducts(_req: Request, res: Response) {
  const data = databaseEnabled ? await listDatabaseProducts() : store.getProducts();
  return res.json({ success: true, data: data ?? [] });
}

export function categories(_req: Request, res: Response) {
  return res.json({ success: true, data: store.getCategories() });
}

export function suppliers(_req: Request, res: Response) {
  return res.json({ success: true, data: store.getSuppliers() });
}

export async function createProduct(req: Request, res: Response) {
  try {
    const payload = createProductSchema.parse(req.body);
    const result = databaseEnabled ? await createDatabaseProduct(payload) : store.addProduct(payload);
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo crear el producto';
    return res.status(400).json({ success: false, message });
  }
}

export function updateProduct(req: Request, res: Response) {
  const productId = Number(req.params.id);
  const payload = updateProductSchema.parse(req.body);
  const updated = store.updateProduct(productId, payload);
  return res.json({ success: true, data: updated });
}

export async function deleteProduct(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const result = databaseEnabled ? await deleteDatabaseProduct(id) : store.deleteProduct(id);
    return res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo eliminar el producto';
    return res.status(400).json({ success: false, message });
  }
}

export function uploadProductImage(req: Request, res: Response) {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Debe adjuntar una imagen' });
  }
  const url = `${apiBaseUrl(req)}/uploads/${req.file.filename}`;
  return res.json({ success: true, data: { url, filename: req.file.filename } });
}

