import type { NextFunction, Request, Response } from 'express';
import { databaseEnabled, findDatabaseEmployeeById } from '../db.js';
import { store } from '../store.js';
import { getEmployeeIdFromToken } from '../utils/jwt.js';

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const authorization = req.header('authorization');
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : '';
  const employeeId = token ? getEmployeeIdFromToken(token) : null;
  if (!employeeId) {
    return res.status(401).json({ success: false, message: 'Token inválido o expirado' });
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
