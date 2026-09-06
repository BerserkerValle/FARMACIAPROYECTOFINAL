import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { signEmployeeToken } from '../middleware/auth.js';
import { store } from '../store.js';

function secret() {
  return process.env.JWT_SECRET?.trim() || 'derkas-dev-secret';
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(4)
});

export function login(req: Request, res: Response) {
  const payload = loginSchema.parse(req.body);
  const employee = store.findEmployeeByCredentials(payload.email, payload.password);
  if (!employee) {
    return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
  }
  const token = signEmployeeToken(employee.id);
  return res.json({
    success: true,
    data: {
      token,
      employee: {
        id: employee.id,
        fullName: employee.fullName,
        email: employee.email,
        role: employee.role,
        branchId: employee.branchId
      }
    }
  });
}

export function me(req: Request, res: Response) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'No autenticado' });
  }
  return res.json({ success: true, data: req.user });
}
