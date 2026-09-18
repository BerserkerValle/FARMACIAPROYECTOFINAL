import type { Request, Response } from 'express';
import { z } from 'zod';
import { 
  createDatabaseBranch, 
  createDatabaseCategory, 
  createDatabaseEmployee, 
  createDatabaseSupplier, 
  databaseEnabled, 
  deleteDatabaseBranch, 
  deleteDatabaseCategory, 
  deleteDatabaseSupplier, 
  deactivateDatabaseEmployee, 
  getDatabaseBranches, 
  getDatabaseCategories, 
  getDatabaseSuppliers, 
  listDatabaseEmployees, 
  updateDatabaseBranch, 
  updateDatabaseCategory, 
  updateDatabaseEmployee, 
  updateDatabaseSupplier 
} from '../db.js';
import { store } from '../store.js';

// ============================================================================
// ESQUEMAS DE VALIDACIÓN ZOD (DTOs)
// ============================================================================

/** Validación para creación y actualización de empleados */
const employeeSchema = z.object({
  fullName: z.string().min(3, 'El nombre debe contener al menos 3 caracteres'),
  email: z.string().email('Correo corporativo no válido'),
  password: z.string().min(6, 'Contraseña mínima de 6 caracteres'),
  role: z.enum(['Administrador', 'Gerente', 'Cajero', 'Bodeguero', 'Repartidor', 'Proveedor']),
  branchId: z.number().int().positive().nullable(),
  supervisorId: z.number().int().positive().nullable()
});

/** Validación para auditoría de doble chequeo de órdenes */
const crosscheckSchema = z.object({
  reviewerEmployeeId: z.number().int().positive(),
  approved: z.boolean(),
  notes: z.string().optional()
});

/** Validación para devolución de productos de una orden */
const returnSchema = z.object({
  employeeId: z.number().int().positive(),
  reason: z.string().min(3, 'Indique el motivo detallado de la devolución'),
  destiny: z.enum(['REINTEGRATION', 'DISPOSAL'])
});

/** Validación para sucursales físicas */
const branchSchema = z.object({ 
  name: z.string().min(2, 'Nombre de sucursal requerido'), 
  city: z.string().min(2, 'Ciudad requerida'), 
  address: z.string().min(3, 'Dirección requerida') 
});

/** Validación para categorías de medicamentos */
const categorySchema = z.object({ 
  name: z.string().min(2, 'Nombre de categoría requerido'), 
  parentId: z.number().int().positive().nullable() 
});

/** Validación para proveedores y laboratorios */
const supplierSchema = z.object({
  name: z.string().min(2, 'Nombre de proveedor requerido'),
  nit: z.string().min(3, 'NIT requerido'),
  email: z.string().email('Correo de contacto inválido'),
  phone: z.string().min(6, 'Teléfono requerido'),
  address: z.string().min(3, 'Dirección requerida'),
  active: z.boolean().default(true)
});

// ============================================================================
// SECCIÓN 1: MÉTRICAS, ESTADÍSTICAS Y REPORTES
// ============================================================================

/**
 * Retorna las métricas consolidadas del Dashboard gerencial.
 * GET /api/admin/dashboard
 * Incluye: ventas del día, ventas del mes, alertas de stock bajo, lotes próximos a vencer.
 */
export function dashboard(_req: Request, res: Response) {
  return res.json({ success: true, data: store.getDashboard() });
}

/**
 * Genera reportes de ventas, productos más vendidos y rendimiento por sucursal.
 * GET /api/admin/reports
 */
export function reports(_req: Request, res: Response) {
  return res.json({ success: true, data: store.getReports() });
}

// ============================================================================
// SECCIÓN 2: GESTIÓN DE SUCURSALES (CRUD)
// ============================================================================

/** Obtiene la lista de todas las sucursales registradas */
export async function branches(_req: Request, res: Response) {
  const data = databaseEnabled ? await getDatabaseBranches() : store.getBranches();
  return res.json({ success: true, data: data ?? [] });
}

/** Crea una nueva sucursal física en el sistema */
export async function createBranch(req: Request, res: Response) {
  try { 
    const payload = branchSchema.parse(req.body); 
    const data = databaseEnabled ? await createDatabaseBranch(payload) : store.addBranch(payload); 
    return res.status(201).json({ success: true, data }); 
  } catch (error) { 
    return res.status(400).json({ success: false, message: error instanceof Error ? error.message : 'No se pudo crear la sucursal' }); 
  }
}

/** Actualiza los datos de una sucursal existente por ID */
export async function updateBranch(req: Request, res: Response) {
  try { 
    const payload = branchSchema.partial().parse(req.body); 
    const data = databaseEnabled ? await updateDatabaseBranch(Number(req.params.id), payload) : store.updateBranch(Number(req.params.id), payload); 
    return res.json({ success: true, data }); 
  } catch (error) { 
    return res.status(400).json({ success: false, message: error instanceof Error ? error.message : 'No se pudo actualizar la sucursal' }); 
  }
}

/** Elimina una sucursal por ID */
export async function deleteBranch(req: Request, res: Response) {
  try { 
    const data = databaseEnabled ? await deleteDatabaseBranch(Number(req.params.id)) : store.deleteBranch(Number(req.params.id)); 
    return res.json({ success: true, data }); 
  } catch (error) { 
    return res.status(400).json({ success: false, message: error instanceof Error ? error.message : 'No se pudo eliminar la sucursal' }); 
  }
}

// ============================================================================
// SECCIÓN 3: GESTIÓN DE CATEGORÍAS (CRUD)
// ============================================================================

/** Obtiene el catálogo de categorías */
export async function categories(_req: Request, res: Response) {
  const data = databaseEnabled ? await getDatabaseCategories() : store.getCategories();
  return res.json({ success: true, data: data ?? [] });
}

/** Crea una nueva categoría con soporte de jerarquía padre opcional */
export async function createCategory(req: Request, res: Response) {
  try {
    const payload = categorySchema.parse(req.body);
    const data = databaseEnabled ? await createDatabaseCategory(payload) : store.addCategory(payload);
    return res.status(201).json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo crear la categoría';
    return res.status(400).json({ success: false, message });
  }
}

/** Actualiza el nombre o pertenencia de una categoría existente */
export async function updateCategory(req: Request, res: Response) {
  try {
    const payload = categorySchema.partial().parse(req.body);
    const data = databaseEnabled ? await updateDatabaseCategory(Number(req.params.id), payload) : store.updateCategory(Number(req.params.id), payload);
    return res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo actualizar la categoría';
    return res.status(400).json({ success: false, message });
  }
}

/** Elimina una categoría por su identificador */
export async function deleteCategory(req: Request, res: Response) {
  try {
    const data = databaseEnabled ? await deleteDatabaseCategory(Number(req.params.id)) : store.deleteCategory(Number(req.params.id));
    return res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo eliminar la categoría';
    return res.status(400).json({ success: false, message });
  }
}

// ============================================================================
// SECCIÓN 4: GESTIÓN DE PROVEEDORES (CRUD)
// ============================================================================

/** Obtiene la lista completa de laboratorios y proveedores */
export async function suppliers(_req: Request, res: Response) {
  const data = databaseEnabled ? await getDatabaseSuppliers() : store.getSuppliers();
  return res.json({ success: true, data: data ?? [] });
}

/** Registra un nuevo proveedor de medicamentos e insumos */
export async function createSupplier(req: Request, res: Response) {
  try { 
    const payload = supplierSchema.parse(req.body); 
    const data = databaseEnabled ? await createDatabaseSupplier(payload) : store.addSupplier(payload); 
    return res.status(201).json({ success: true, data }); 
  } catch (error) { 
    return res.status(400).json({ success: false, message: error instanceof Error ? error.message : 'No se pudo crear el proveedor' }); 
  }
}

/** Actualiza la información fiscal o de contacto de un proveedor */
export async function updateSupplier(req: Request, res: Response) {
  try { 
    const payload = supplierSchema.partial().parse(req.body); 
    const data = databaseEnabled ? await updateDatabaseSupplier(Number(req.params.id), payload) : store.updateSupplier(Number(req.params.id), payload); 
    return res.json({ success: true, data }); 
  } catch (error) { 
    return res.status(400).json({ success: false, message: error instanceof Error ? error.message : 'No se pudo actualizar el proveedor' }); 
  }
}

/** Desactiva o elimina un proveedor por ID */
export async function deleteSupplier(req: Request, res: Response) {
  try { 
    const data = databaseEnabled ? await deleteDatabaseSupplier(Number(req.params.id)) : store.deleteSupplier(Number(req.params.id)); 
    return res.json({ success: true, data }); 
  } catch (error) { 
    return res.status(400).json({ success: false, message: error instanceof Error ? error.message : 'No se pudo eliminar el proveedor' }); 
  }
}

// ============================================================================
// SECCIÓN 5: GESTIÓN DE EMPLEADOS Y COLABORADORES (CRUD)
// ============================================================================

/** Lista todos los colaboradores del sistema */
export async function employees(_req: Request, res: Response) {
  const data = databaseEnabled ? await listDatabaseEmployees() : store.getEmployees();
  return res.json({ success: true, data: data ?? [] });
}

/** 
 * Da de alta un nuevo empleado en el sistema.
 * Aplica encriptación a la contraseña y la excluye de la respuesta devuelta al cliente.
 */
export async function createEmployee(req: Request, res: Response) {
  try {
    const payload = employeeSchema.parse(req.body);
    const employee = databaseEnabled ? await createDatabaseEmployee(payload) : store.addEmployee(payload);
    const { password: _password, ...safeEmployee } = employee as typeof employee & { password?: string };
    return res.status(201).json({ success: true, data: safeEmployee });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo crear el empleado';
    return res.status(400).json({ success: false, message });
  }
}

/** Actualiza roles, asignación de sucursales o datos del empleado */
export async function updateEmployee(req: Request, res: Response) {
  try {
    const payload = employeeSchema.partial().parse(req.body);
    const employee = databaseEnabled
      ? await updateDatabaseEmployee(Number(req.params.id), payload)
      : store.updateEmployee(Number(req.params.id), payload);
    const { password: _password, ...safeEmployee } = employee as typeof employee & { password?: string };
    return res.json({ success: true, data: safeEmployee });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo actualizar el empleado';
    return res.status(400).json({ success: false, message });
  }
}

/** Desactiva un empleado en el sistema (baja lógica) */
export async function deleteEmployee(req: Request, res: Response) {
  try {
    const data = databaseEnabled
      ? await deactivateDatabaseEmployee(Number(req.params.id))
      : store.deleteEmployee(Number(req.params.id));
    return res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo desactivar el empleado';
    return res.status(400).json({ success: false, message });
  }
}

// ============================================================================
// SECCIÓN 6: AUDITORÍA DE CALIDAD Y DEVOLUCIONES
// ============================================================================

/**
 * Realiza la verificación cruzada (doble chequeo) de una orden.
 * POST /api/admin/orders/:id/crosscheck
 * Un supervisor confirma que los medicamentos empacados coinciden con la receta y factura.
 */
export function crosscheck(req: Request, res: Response) {
  const orderId = Number(req.params.id);
  const payload = crosscheckSchema.parse(req.body);
  const record = store.crosscheckOrder(orderId, payload);
  return res.status(201).json({ success: true, data: record });
}

/**
 * Registra la devolución de una orden con su justificación y destino.
 * POST /api/admin/orders/:id/returns
 * Destino: 'REINTEGRATION' (vuelve a stock) o 'DISPOSAL' (destrucción por deterioro).
 */
export function returns(req: Request, res: Response) {
  const orderId = Number(req.params.id);
  const payload = returnSchema.parse(req.body);
  const record = store.createReturn(orderId, payload.employeeId, payload.reason, payload.destiny);
  return res.status(201).json({ success: true, data: record });
}
