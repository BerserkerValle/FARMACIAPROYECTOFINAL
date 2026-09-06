import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { store } from '../store.js';

interface JwtPayload {
  employeeId: number;
  role: string;
  branchId: number | null;
  fullName: string;
  email: string;
}

function secret() {
  return process.env.JWT_SECRET?.trim() || 'derkas-dev-secret';
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = req.header('authorization')?.replace('Bearer ', '').trim();
  if (!token) {
    return res.status(401).json({ success: false, message: 'Falta token JWT' });
  }

  try {
    const payload = jwt.verify(token, secret()) as JwtPayload;
    req.user = {
      employeeId: payload.employeeId,
      role: payload.role as never,
      branchId: payload.branchId,
      fullName: payload.fullName,
      email: payload.email
    };
    return next();
  } catch {
    return res.status(401).json({ success: false, message: 'Token inválido o expirado' });
  }
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

export function signEmployeeToken(employeeId: number) {
  const employee = store.getEmployeeById(employeeId);
  if (!employee) {
    throw new Error('Empleado no encontrado');
  }
  return jwt.sign(
    {
      employeeId: employee.id,
      role: employee.role,
      branchId: employee.branchId,
      fullName: employee.fullName,
      email: employee.email
    },
    secret(),
    { expiresIn: '8h' }
  );
}
