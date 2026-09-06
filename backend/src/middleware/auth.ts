import type { NextFunction, Request, Response } from 'express';
import { databaseEnabled, findDatabaseEmployeeById } from '../db.js';
import { store } from '../store.js';

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const employeeId = Number(req.header('x-employee-id'));
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    return res.status(401).json({ success: false, message: 'Falta la sesión del empleado' });
  }

  const employee = databaseEnabled ? await findDatabaseEmployeeById(employeeId) : store.getEmployeeById(employeeId);
  if (!employee) {
    return res.status(401).json({ success: false, message: 'Empleado no encontrado o inactivo' });
  }
  req.user = {
    employeeId: 'employeeId' in employee ? employee.employeeId : employee.id,
    role: employee.role,
    branchId: employee.branchId,
    fullName: employee.fullName,
    email: employee.email
  };
  return next();
}

export function authorize(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'No autenticado' });
    }
    if (roles.length > 0 && !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'No tiene permisos para esta acción' });
    }
    return next();
  };
}
