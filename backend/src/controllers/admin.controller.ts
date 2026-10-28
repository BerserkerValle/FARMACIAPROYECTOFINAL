import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Role } from '../domain.js';
import { FORBIDDEN_MESSAGE, canAccessBranch, canGrantRole, canManageEmployee } from '../utils/permissions.js';
import {
  createDatabaseBranch,
  createDatabaseCategory,
  createDatabaseEmployee,
  createDatabaseSupplier,
  databaseEnabled,
  deleteDatabaseCustomerAccount,
  deleteDatabaseBranch,
  deleteDatabaseCategory,
  deactivateDatabaseEmployee,
  getDatabaseBranches,
  listDatabaseCustomerAccounts,
  getDatabaseCategories,
  getDatabaseDashboard,
  getDatabaseReports,
  getDatabaseOrderById,
  getDatabaseSuppliers,
  listDatabaseEmployees,
  updateDatabaseBranch,
  updateDatabaseCategory,
  updateDatabaseEmployee,
  updateDatabaseSupplier
} from '../db.js';
import { store } from '../store.js';
import { guatemalaPhoneSchema } from '../utils.js';


// ESQUEMAS DE VALIDACION


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
  name: z.string().trim().min(2, 'Nombre de proveedor requerido'),
  contactName: z.string().trim().min(2, 'Nombre de contacto requerido'),
  nit: z.string().trim().min(3, 'NIT requerido'),
  email: z.string().email('Correo de contacto inválido'),
  phone: guatemalaPhoneSchema(),
  address: z.string().min(3, 'Dirección requerida'),
  active: z.boolean().default(true)
});

function assertLocalSupplierUnique(input: Partial<{ id: number; nit: string; email: string }>) {
  const duplicate = store.getSuppliers().find((supplier) => supplier.id !== input.id && (supplier.nit.toLowerCase() === input.nit?.trim().toLowerCase() || supplier.email.toLowerCase() === input.email?.trim().toLowerCase()));
  if (duplicate) throw new Error('Ya existe un proveedor con ese NIT o correo');
}

// ============================================================================
// SECCIÓN 1: MÉTRICAS, ESTADÍSTICAS Y REPORTES

export async function dashboard(req: Request, res: Response) {
  try {
    const requestedBranchId = req.query.branchId ? Number(req.query.branchId) : null;
    if (requestedBranchId !== null && (!Number.isInteger(requestedBranchId) || requestedBranchId <= 0)) {
      return res.status(400).json({ success: false, message: 'Sucursal no válida' });
    }
    const branchId = req.user?.role === 'Administrador'
      ? requestedBranchId ?? undefined
      : req.user?.branchId ?? undefined;
    if (req.user?.role === 'Gerente' && branchId === undefined) {
      return res.status(403).json({ success: false, message: 'El gerente debe tener una sucursal asignada' });
    }
    const data = databaseEnabled ? await getDatabaseDashboard({ branchId }) : store.getDashboard({ branchId });
    return res.json({
      success: true,
      data: { ...data, dataSource: databaseEnabled ? 'postgres' : 'server-store' }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error instanceof Error ? error.message : 'No se pudo cargar el dashboard' });
  }
}

/**
 * Genera reportes de ventas, productos más vendidos y rendimiento por sucursal.
 * GET /api/admin/reports
 */
export async function reports(req: Request, res: Response) {
  try {
    const requestedBranchId = req.query.branchId ? Number(req.query.branchId) : null;
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    if (requestedBranchId !== null && (!Number.isInteger(requestedBranchId) || requestedBranchId <= 0)) {
      return res.status(400).json({ success: false, message: 'Sucursal no válida' });
    }
    const branchId = req.user?.role === 'Administrador'
      ? requestedBranchId ?? undefined
      : req.user?.branchId ?? undefined;
    if (req.user?.role === 'Gerente' && branchId === undefined) {
      return res.status(403).json({ success: false, message: 'El gerente debe tener una sucursal asignada' });
    }
    const filters = { branchId, from, to };
    const data = databaseEnabled ? await getDatabaseReports(filters) : store.getReports(filters);
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error instanceof Error ? error.message : 'No se pudieron cargar los reportes' });
  }
}
export async function branches(req: Request, res: Response) {
  const data = databaseEnabled ? await getDatabaseBranches() : store.getBranches();
  const visibleBranches = req.user?.role === 'Gerente'
    ? (data ?? []).filter((branch) => Number(branch.id) === req.user?.branchId)
    : data ?? [];
  return res.json({ success: true, data: visibleBranches });
}

/** Crea una nueva sucursal física en el sistema */
export async function createBranch(req: Request, res: Response) {
  try { 
    if (req.user?.role !== 'Administrador') {
      return res.status(403).json({ success: false, message: FORBIDDEN_MESSAGE });
    }
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
    if (req.user?.role !== 'Administrador') {
      return res.status(403).json({ success: false, message: FORBIDDEN_MESSAGE });
    }
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
    if (req.user?.role !== 'Administrador') {
      return res.status(403).json({ success: false, message: FORBIDDEN_MESSAGE });
    }
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

export async function suppliers(req: Request, res: Response) {
  try {
    const search = String(req.query.search ?? '').trim().toLowerCase();
    const data = databaseEnabled ? await getDatabaseSuppliers() : store.getSuppliers();
    const filtered = (data ?? []).filter((supplier) => !search || [supplier.name, supplier.contactName, supplier.nit, supplier.email, supplier.phone].some((value) => String(value ?? '').toLowerCase().includes(search)));
    return res.json({ success: true, data: filtered });
  } catch (error) {
    return res.status(500).json({ success: false, message: error instanceof Error ? error.message : 'No se pudieron cargar los proveedores' });
  }
}

export async function createSupplier(req: Request, res: Response) {
  try {
    const payload = supplierSchema.parse(req.body);
    if (!databaseEnabled) assertLocalSupplierUnique(payload);
    const data = databaseEnabled ? await createDatabaseSupplier(payload) : store.addSupplier(payload);
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return res.status(400).json({ success: false, message: error instanceof Error ? error.message : 'No se pudo crear el proveedor' });
  }
}

export async function updateSupplier(req: Request, res: Response) {
  try {
    const payload = supplierSchema.partial().parse(req.body);
    if (!databaseEnabled && (payload.nit !== undefined || payload.email !== undefined)) {
      assertLocalSupplierUnique({ id: Number(req.params.id), nit: payload.nit, email: payload.email });
    }
    const data = databaseEnabled ? await updateDatabaseSupplier(Number(req.params.id), payload) : store.updateSupplier(Number(req.params.id), payload);
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(400).json({ success: false, message: error instanceof Error ? error.message : 'No se pudo actualizar el proveedor' });
  }
}

export async function deleteSupplier(req: Request, res: Response) {
  try {
    const data = databaseEnabled ? await updateDatabaseSupplier(Number(req.params.id), { active: false }) : store.deleteSupplier(Number(req.params.id));
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(400).json({ success: false, message: error instanceof Error ? error.message : 'No se pudo desactivar el proveedor' });
  }
}

// ============================================================================
// SECCIÓN 5: GESTIÓN DE EMPLEADOS Y COLABORADORES (CRUD)
// ============================================================================

async function findEmployeeRecord(id: number) {
  if (databaseEnabled) {
    const list = await listDatabaseEmployees();
    return list?.find((item) => item.id === id) ?? null;
  }
  return store.getEmployees().find((item) => item.id === id) ?? null;
}

async function assertEmployeeBranchExists(branchId: number | null, role: Role) {
  if (role === 'Administrador') {
    if (branchId !== null) throw new Error('Un administrador tiene acceso a todas las sucursales y no requiere asignación');
    return;
  }
  if (branchId == null) throw new Error('Debe asignar una sucursal al colaborador');
  const branches = databaseEnabled ? await getDatabaseBranches() : store.getBranches();
  if (!branches?.some((branch) => Number(branch.id) === branchId)) {
    throw new Error('La sucursal seleccionada no existe');
  }
}

/** Lista todos los colaboradores del sistema */
export async function employees(req: Request, res: Response) {
  const data = databaseEnabled ? await listDatabaseEmployees() : store.getEmployees();
  const safeData = (data ?? []).map((employee) => {
    if ('password' in employee) {
      const { password: _password, ...safeEmployee } = employee;
      return safeEmployee;
    }
    return employee;
  });
  const visibleEmployees = req.user?.role === 'Gerente'
    ? safeData.filter((employee) => Number(employee.branchId) === req.user?.branchId)
    : safeData;
  return res.json({ success: true, data: visibleEmployees });
}

/** Lista las cuentas de clientes registradas sin incluir credenciales */
export async function customerAccounts(req: Request, res: Response) {
  if (req.user?.role !== 'Administrador') {
    return res.status(403).json({ success: false, message: FORBIDDEN_MESSAGE });
  }
  const data = databaseEnabled ? await listDatabaseCustomerAccounts() : store.getRegisteredCustomers();
  return res.json({ success: true, data: data ?? [] });
}

/** Elimina la cuenta de acceso de un cliente y conserva su historial de pedidos */
export async function deleteCustomerAccount(req: Request, res: Response) {
  try {
    if (req.user?.role !== 'Administrador') {
      return res.status(403).json({ success: false, message: FORBIDDEN_MESSAGE });
    }
    const customerId = Number(req.params.id);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ success: false, message: 'Cliente no válido' });
    }
    const data = databaseEnabled
      ? await deleteDatabaseCustomerAccount(customerId)
      : store.deleteCustomerAccount(customerId);
    return res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo eliminar la cuenta del cliente';
    const status = message === 'Cuenta de cliente no encontrada' ? 404 : 400;
    return res.status(status).json({ success: false, message });
  }
}

/** 
 * Da de alta un nuevo empleado en el sistema.
 * Aplica encriptación a la contraseña y la excluye de la respuesta devuelta al cliente.
 * Un Gerente no puede crear administradores ni usuarios con más permisos que él.
 */
export async function createEmployee(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'No autenticado' });
    }
    const payload = employeeSchema.parse(req.body);
    if (!canGrantRole(req.user.role, payload.role)) {
      return res.status(403).json({ success: false, message: FORBIDDEN_MESSAGE });
    }
    if (req.user.role === 'Gerente' && payload.branchId !== req.user.branchId) {
      return res.status(403).json({ success: false, message: 'Solo puedes asignar colaboradores a tu sucursal' });
    }
    await assertEmployeeBranchExists(payload.branchId, payload.role);
    const employee = databaseEnabled ? await createDatabaseEmployee(payload) : store.addEmployee(payload);
    const { password: _password, ...safeEmployee } = employee as typeof employee & { password?: string };
    return res.status(201).json({ success: true, data: safeEmployee });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo crear el empleado';
    return res.status(400).json({ success: false, message });
  }
}

/**
 * Actualiza roles, asignación de sucursales o datos del empleado.
 * Impide la escalada de privilegios: nadie puede otorgar un rol que no sea
 * inferior al suyo, autoasignarse permisos, ni modificar a otro administrador.
 */
export async function updateEmployee(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'No autenticado' });
    }
    const targetId = Number(req.params.id);
    const payload = employeeSchema.partial().parse(req.body);
    const current = await findEmployeeRecord(targetId);

    if (!current) {
      return res.status(404).json({ success: false, message: 'Empleado no encontrado' });
    }
    if (!canManageEmployee(req.user.role, current.role as Role)) {
      return res.status(403).json({ success: false, message: FORBIDDEN_MESSAGE });
    }
    if (!canAccessBranch(req.user.role, req.user.branchId, current.branchId)) {
      return res.status(403).json({ success: false, message: FORBIDDEN_MESSAGE });
    }
    if (targetId === req.user.employeeId && payload.role !== undefined) {
      return res.status(403).json({ success: false, message: 'No puedes cambiar tu propio rol' });
    }
    if (payload.role !== undefined && !canGrantRole(req.user.role, payload.role)) {
      return res.status(403).json({ success: false, message: FORBIDDEN_MESSAGE });
    }

    const nextRole = payload.role ?? current.role as Role;
    const nextBranchId = payload.branchId !== undefined ? payload.branchId : current.branchId;
    if (req.user.role === 'Gerente' && nextBranchId !== req.user.branchId) {
      return res.status(403).json({ success: false, message: 'Solo puedes asignar colaboradores a tu sucursal' });
    }
    await assertEmployeeBranchExists(nextBranchId, nextRole);

    const employee = databaseEnabled
      ? await updateDatabaseEmployee(targetId, payload)
      : store.updateEmployee(targetId, payload);
    const { password: _password, ...safeEmployee } = employee as typeof employee & { password?: string };
    return res.json({ success: true, data: safeEmployee });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo actualizar el empleado';
    return res.status(400).json({ success: false, message });
  }
}

/**
 * Desactiva un empleado en el sistema (baja lógica).
 * Nadie puede desactivarse a sí mismo ni desactivar a un administrador.
 */
export async function deleteEmployee(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'No autenticado' });
    }
    const targetId = Number(req.params.id);
    if (targetId === req.user.employeeId) {
      return res.status(403).json({ success: false, message: 'No puedes desactivar tu propia cuenta' });
    }
    const current = await findEmployeeRecord(targetId);
    if (!current) {
      return res.status(404).json({ success: false, message: 'Empleado no encontrado' });
    }
    if (!canManageEmployee(req.user.role, current.role as Role)) {
      return res.status(403).json({ success: false, message: FORBIDDEN_MESSAGE });
    }
    if (!canAccessBranch(req.user.role, req.user.branchId, current.branchId)) {
      return res.status(403).json({ success: false, message: FORBIDDEN_MESSAGE });
    }
    const data = databaseEnabled
      ? await deactivateDatabaseEmployee(targetId)
      : store.deleteEmployee(targetId);
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
 * El revisor se toma siempre de la sesión, nunca del cuerpo de la petición.
 */
export async function crosscheck(req: Request, res: Response) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'No autenticado' });
  }
  try {
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return res.status(400).json({ success: false, message: 'Orden no válida' });
    }
    if (req.user.role === 'Gerente') {
      if (req.user.branchId == null) {
        return res.status(403).json({ success: false, message: 'El gerente debe tener una sucursal asignada' });
      }
      const order = databaseEnabled
        ? await getDatabaseOrderById(orderId)
        : store.getOrderById(orderId);
      if (!order || order.branchId !== req.user.branchId) {
        return res.status(404).json({ success: false, message: 'Orden no encontrada en tu sucursal' });
      }
    }
    const payload = crosscheckSchema.parse(req.body);
    const record = store.crosscheckOrder(orderId, { ...payload, reviewerEmployeeId: req.user.employeeId });
    return res.status(201).json({ success: true, data: record });
  } catch (error) {
    return res.status(400).json({ success: false, message: error instanceof Error ? error.message : 'No se pudo validar la orden' });
  }
}

/**
 * Registra la devolución de una orden con su justificación y destino.
 * POST /api/admin/orders/:id/returns
 * Destino: 'REINTEGRATION' (vuelve a stock) o 'DISPOSAL' (destrucción por deterioro).
 * El empleado responsable se toma siempre de la sesión, nunca del cuerpo de la petición.
 */
export function returns(req: Request, res: Response) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'No autenticado' });
  }
  const orderId = Number(req.params.id);
  const payload = returnSchema.parse(req.body);
  const record = store.createReturn(orderId, req.user.employeeId, payload.reason, payload.destiny);
  return res.status(201).json({ success: true, data: record });
}
