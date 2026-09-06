import type { Request, Response } from 'express';
import { z } from 'zod';
import { createDatabaseEmployee, databaseEnabled, deactivateDatabaseEmployee, listDatabaseEmployees, updateDatabaseEmployee } from '../db.js';
import { store } from '../store.js';

const employeeSchema = z.object({
  fullName: z.string().min(3),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['Administrador', 'Gerente', 'Cajero', 'Bodeguero', 'Repartidor', 'Proveedor']),
  branchId: z.number().int().positive().nullable(),
  supervisorId: z.number().int().positive().nullable()
});

const crosscheckSchema = z.object({
  reviewerEmployeeId: z.number().int().positive(),
  approved: z.boolean(),
  notes: z.string().optional()
});

const returnSchema = z.object({
  employeeId: z.number().int().positive(),
  reason: z.string().min(3),
  destiny: z.enum(['REINTEGRATION', 'DISPOSAL'])
});

const branchSchema = z.object({ name: z.string().min(2), city: z.string().min(2), address: z.string().min(3) });
const categorySchema = z.object({ name: z.string().min(2), parentId: z.number().int().positive().nullable() });
const supplierSchema = z.object({
  name: z.string().min(2),
  nit: z.string().min(3),
  email: z.string().email(),
  phone: z.string().min(6),
  address: z.string().min(3),
  active: z.boolean().default(true)
});

export function dashboard(_req: Request, res: Response) {
  return res.json({ success: true, data: store.getDashboard() });
}

export function reports(_req: Request, res: Response) {
  return res.json({ success: true, data: store.getReports() });
}

export async function employees(_req: Request, res: Response) {
  const data = databaseEnabled ? await listDatabaseEmployees() : store.getEmployees();
  return res.json({ success: true, data: data ?? [] });
}

export function branches(_req: Request, res: Response) {
  return res.json({ success: true, data: store.getBranches() });
}

export function createBranch(req: Request, res: Response) {
  return res.status(201).json({ success: true, data: store.addBranch(branchSchema.parse(req.body)) });
}

export function updateBranch(req: Request, res: Response) {
  return res.json({ success: true, data: store.updateBranch(Number(req.params.id), branchSchema.partial().parse(req.body)) });
}

export function deleteBranch(req: Request, res: Response) {
  return res.json({ success: true, data: store.deleteBranch(Number(req.params.id)) });
}

export function categories(_req: Request, res: Response) {
  return res.json({ success: true, data: store.getCategories() });
}

export function createCategory(req: Request, res: Response) {
  return res.status(201).json({ success: true, data: store.addCategory(categorySchema.parse(req.body)) });
}

export function updateCategory(req: Request, res: Response) {
  return res.json({ success: true, data: store.updateCategory(Number(req.params.id), categorySchema.partial().parse(req.body)) });
}

export function deleteCategory(req: Request, res: Response) {
  return res.json({ success: true, data: store.deleteCategory(Number(req.params.id)) });
}

export function suppliers(_req: Request, res: Response) {
  return res.json({ success: true, data: store.getSuppliers() });
}

export function createSupplier(req: Request, res: Response) {
  return res.status(201).json({ success: true, data: store.addSupplier(supplierSchema.parse(req.body)) });
}

export function updateSupplier(req: Request, res: Response) {
  return res.json({ success: true, data: store.updateSupplier(Number(req.params.id), supplierSchema.partial().parse(req.body)) });
}

export function deleteSupplier(req: Request, res: Response) {
  return res.json({ success: true, data: store.deleteSupplier(Number(req.params.id)) });
}

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

export function crosscheck(req: Request, res: Response) {
  const orderId = Number(req.params.id);
  const payload = crosscheckSchema.parse(req.body);
  const record = store.crosscheckOrder(orderId, payload);
  return res.status(201).json({ success: true, data: record });
}

export function returns(req: Request, res: Response) {
  const orderId = Number(req.params.id);
  const payload = returnSchema.parse(req.body);
  const record = store.createReturn(orderId, payload.employeeId, payload.reason, payload.destiny);
  return res.status(201).json({ success: true, data: record });
}
