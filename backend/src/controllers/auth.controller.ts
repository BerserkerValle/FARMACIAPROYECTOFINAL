import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { signEmployeeToken } from '../middleware/auth.js';
import { store } from '../store.js';

function secret() {
  return process.env.JWT_SECRET?.trim() || 'derkas-dev-secret';
}

const loginSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(4).optional(),
  correo_corporativo: z.string().email().optional(),
  contrasena: z.string().min(4).optional()
}).refine(
  (value) => (value.email || value.correo_corporativo) && (value.password || value.contrasena),
  { message: 'Correo y contraseña son obligatorios' }
);

export function login(req: Request, res: Response) {
  const payload = loginSchema.parse(req.body);
  const email = payload.email ?? payload.correo_corporativo!;
  const password = payload.password ?? payload.contrasena!;
  const employee = store.findEmployeeByCredentials(email, password);
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
