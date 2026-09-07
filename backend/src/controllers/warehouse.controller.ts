import type { Request, Response } from 'express';
import { z } from 'zod';
import { createDatabaseProduct, databaseEnabled, deleteDatabaseProduct, getDatabaseCategories, getDatabaseSuppliers, listDatabaseLots, listDatabaseProducts, receiveDatabaseLot, updateDatabaseProduct } from '../db.js';
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
  brand: z.string().default(''),
  laboratory: z.string().default(''),
  presentation: z.string().default(''),
  unitMeasure: z.string().default(''),
  sanitaryRegistry: z.string().default(''),
  requiresPrescription: z.boolean().default(false),
  active: z.boolean().optional().default(true),
  description: z.string().nullish().transform((v) => v ?? ''),
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
    .default(null)
});

const updateProductSchema = z.object({
  sku: z.string().min(2).optional(),
  name: z.string().min(2).optional(),
  categoryId: z.coerce.number().int().positive().nullable().optional(),
  brand: z.string().nullish().transform((v) => (v == null ? undefined : v)),
  laboratory: z.string().nullish().transform((v) => (v == null ? undefined : v)),
  presentation: z.string().nullish().transform((v) => (v == null ? undefined : v)),
  unitMeasure: z.string().nullish().transform((v) => (v == null ? undefined : v)),
  sanitaryRegistry: z.string().nullish().transform((v) => (v == null ? undefined : v)),
  requiresPrescription: z.boolean().optional(),
  active: z.boolean().optional(),
  description: z.string().nullish().transform((v) => (v == null ? '' : v)),
  price: z.coerce.number().positive().optional(),
  cost: z.coerce.number().positive().optional(),
  imageUrl: z.string().trim().optional().nullable()
});

function apiBaseUrl(req: Request) {
  return process.env.API_BASE_URL?.trim() || `${req.protocol}://${req.get('host')}`;
}

export async function lots(req: Request, res: Response) {
  const branchId = req.user?.branchId ?? (req.query.branchId ? Number(req.query.branchId) : undefined);
  const productId = req.query.productId ? Number(req.query.productId) : undefined;
  const data = databaseEnabled ? await listDatabaseLots(branchId, productId) : store.getLots(productId, branchId);
  return res.json({ success: true, data: data ?? [] });
}

export async function receive(req: Request, res: Response) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'No autenticado' });
  }
  const payload = receiveSchema.parse(req.body);
  try {
    const lot = databaseEnabled
      ? await receiveDatabaseLot({ ...payload, employeeId: req.user.employeeId })
      : store.receiveGoods({ ...payload, employeeId: req.user.employeeId });
    return res.status(201).json({ success: true, data: lot });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo recibir el lote';
    return res.status(400).json({ success: false, message });
  }
}

export async function listProducts(_req: Request, res: Response) {
  const data = databaseEnabled ? await listDatabaseProducts() : store.getProducts();
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

export async function createProduct(req: Request, res: Response) {
  try {
    const payload = createProductSchema.parse(req.body);
    const result = databaseEnabled ? await createDatabaseProduct(payload) : store.addProduct(payload);
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    let message = 'No se pudo crear el producto';
    if (error instanceof z.ZodError) {
      message = error.errors.map((e) => `Campo ${e.path.join('.') || 'inválido'}: ${e.message}`).join(', ');
    } else if (error instanceof Error) {
      message = error.message;
    }
    return res.status(400).json({ success: false, message });
  }
}

export async function updateProduct(req: Request, res: Response) {
  try {
    const productId = Number(req.params.id);
    const payload = updateProductSchema.parse(req.body);
    const updated = databaseEnabled ? await updateDatabaseProduct(productId, payload) : store.updateProduct(productId, payload);
    return res.json({ success: true, data: updated });
  } catch (error) {
    let message = 'No se pudo actualizar el producto';
    if (error instanceof z.ZodError) {
      message = error.errors.map((e) => `Campo ${e.path.join('.') || 'inválido'}: ${e.message}`).join(', ');
    } else if (error instanceof Error) {
      message = error.message;
    }
    return res.status(400).json({ success: false, message });
  }
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

