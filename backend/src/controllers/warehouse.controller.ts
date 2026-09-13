/**
 * ============================================================================
 * PROYECTO FARMACIA - CONTROLADOR DE BODEGA E INVENTARIO (WAREHOUSE)
 * ============================================================================
 * Este módulo gestiona las operaciones de almacenamiento y existencias:
 * 1. Recepción de Mercadería y Lotes:
 *    - Registro de nuevos lotes con código de lote, fecha de vencimiento y producción.
 *    - Actualización de costos de adquisición y precios de venta.
 *    - Auditoría del colaborador/bodeguero que recibe la mercadería.
 * 2. Catálogo de Medicamentos (CRUD):
 *    - Creación de fichas técnicas de medicamentos (SKU, registro sanitario, laboratorio).
 *    - Alta directa opcional con lote inicial (`initialStock`).
 *    - Actualización de atributos médicos (receta obligatoria, presentación).
 *    - Eliminación / inactivación de productos.
 * 3. Multimedia:
 *    - Carga y procesamiento de imágenes del medicamento para exhibición en el catálogo.
 *
 * MÉTODOS Y LIBRERÍAS:
 * - Zod: Coerción y validación exhaustiva de tipos.
 * - Multer: Almacenamiento seguro de archivos de imagen en servidor.
 * - PostgreSQL (`db.ts`) con sincronización bidireccional a `store.ts`.
 * ============================================================================
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import { 
  createDatabaseProduct, 
  databaseEnabled, 
  deleteDatabaseProduct, 
  getDatabaseCategories, 
  getDatabaseSuppliers, 
  listDatabaseLots, 
  listDatabaseProducts, 
  receiveDatabaseLot, 
  updateDatabaseProduct 
} from '../db.js';
import { store } from '../store.js';

// ============================================================================
// ESQUEMAS DE VALIDACIÓN ZOD (DTOs)
// ============================================================================

/** Esquema para registrar la recepción de un lote de medicamentos */
const receiveSchema = z.object({
  branchId: z.number().int().positive('Debe especificar la sucursal de destino'),
  supplierId: z.number().int().positive('Debe especificar el proveedor o laboratorio'),
  productId: z.number().int().positive('Debe especificar el medicamento'),
  batchCode: z.string().min(3, 'El código de lote debe tener al menos 3 caracteres'),
  expirationDate: z.string().min(8, 'Fecha de vencimiento requerida (YYYY-MM-DD)'),
  productionDate: z.string().min(8, 'Fecha de elaboración requerida (YYYY-MM-DD)'),
  quantity: z.number().int().positive('La cantidad a ingresar debe ser mayor a 0'),
  costPrice: z.number().positive('El costo de compra debe ser positivo'),
  salePrice: z.number().positive('El precio de venta debe ser positivo')
});

/** Esquema para la creación de un nuevo producto en catálogo */
const createProductSchema = z.object({
  sku: z.string().min(2, 'SKU requerido'),
  name: z.string().min(2, 'Nombre de medicamento requerido'),
  categoryId: z.coerce.number().int().positive().nullable().default(null),
  brand: z.string().default(''),
  laboratory: z.string().default(''),
  presentation: z.string().default(''),
  unitMeasure: z.string().default(''),
  sanitaryRegistry: z.string().default(''),
  requiresPrescription: z.boolean().default(false),
  active: z.boolean().optional().default(true),
  description: z.string().nullish().transform((v) => v ?? ''),
  price: z.coerce.number().positive('El precio debe ser mayor a 0'),
  cost: z.coerce.number().positive('El costo debe ser mayor a 0'),
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

/** Esquema para actualización parcial de campos de un producto existente */
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

/** Construye la URL base para el acceso a imágenes estáticas */
function apiBaseUrl(req: Request): string {
  return process.env.API_BASE_URL?.trim() || `${req.protocol}://${req.get('host')}`;
}

// ============================================================================
// SECCIÓN 1: CONTROL DE LOTES Y RECEPCIÓN DE MERCADERÍA
// ============================================================================

/**
 * Consulta los lotes de inventario con filtros opcionales de sucursal y producto.
 * GET /api/warehouse/lots?branchId=1&productId=5
 */
export async function lots(req: Request, res: Response) {
  const branchId = req.user?.branchId ?? (req.query.branchId ? Number(req.query.branchId) : undefined);
  const productId = req.query.productId ? Number(req.query.productId) : undefined;
  const data = databaseEnabled ? await listDatabaseLots(branchId, productId) : store.getLots(productId, branchId);
  return res.json({ success: true, data: data ?? [] });
}

/**
 * Registra el ingreso formal de un lote de mercadería en bodega.
 * POST /api/warehouse/receive
 * Asocia la recepción al ID del empleado autenticado para trazabilidad de auditoría.
 */
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

// ============================================================================
// SECCIÓN 2: GESTIÓN DE PRODUCTOS Y CATÁLOGO FARMACÉUTICO
// ============================================================================

/** Lista todos los productos registrados en el sistema */
export async function listProducts(_req: Request, res: Response) {
  const data = databaseEnabled ? await listDatabaseProducts() : store.getProducts();
  return res.json({ success: true, data: data ?? [] });
}

/** Obtiene las categorías disponibles para clasificación de productos */
export async function categories(_req: Request, res: Response) {
  const data = databaseEnabled ? await getDatabaseCategories() : store.getCategories();
  return res.json({ success: true, data: data ?? [] });
}

/** Obtiene la lista de proveedores para asignación de lotes */
export async function suppliers(_req: Request, res: Response) {
  const data = databaseEnabled ? await getDatabaseSuppliers() : store.getSuppliers();
  return res.json({ success: true, data: data ?? [] });
}

/**
 * Da de alta un nuevo medicamento en el catálogo.
 * POST /api/warehouse/products
 * Si se incluye `initialStock`, crea inmediatamente el primer lote con su existencia.
 */
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

/**
 * Actualiza los datos de un medicamento existente por ID.
 * PUT /api/warehouse/products/:id
 */
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

/**
 * Elimina o desactiva un medicamento por ID.
 * DELETE /api/warehouse/products/:id
 */
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

// ============================================================================
// SECCIÓN 3: SUBIDA DE IMÁGENES DE MEDICAMENTOS (MULTER)
// ============================================================================

/**
 * Sube una fotografía o ilustración para un medicamento.
 * POST /api/warehouse/products/upload-image
 * Retorna la URL pública y el nombre del archivo guardado.
 */
export function uploadProductImage(req: Request, res: Response) {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Debe adjuntar una imagen' });
  }
  const url = `${apiBaseUrl(req)}/uploads/${req.file.filename}`;
  return res.json({ success: true, data: { url, filename: req.file.filename } });
}
