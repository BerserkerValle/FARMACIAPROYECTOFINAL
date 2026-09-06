import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { databaseEnabled, findDatabaseEmployeeByEmail } from '../db.js';
import { store } from '../store.js';

const loginSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(4).optional(),
  correo_corporativo: z.string().email().optional(),
  contrasena: z.string().min(4).optional()
}).refine(
  (value) => (value.email || value.correo_corporativo) && (value.password || value.contrasena),
  { message: 'Correo y contraseña son obligatorios' }
);

export async function login(req: Request, res: Response) {
  const payload = loginSchema.parse(req.body);
  const email = payload.email ?? payload.correo_corporativo!;
  const password = payload.password ?? payload.contrasena!;
  const databaseEmployee = databaseEnabled ? await findDatabaseEmployeeByEmail(email) : null;
  const employee = databaseEmployee ?? store.findEmployeeByCredentials(email, password);
  if (!employee) {
    return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
  }
  if (databaseEmployee) {
    const validPassword = databaseEmployee.password.startsWith('$2')
      ? await bcrypt.compare(password, databaseEmployee.password)
      : password === databaseEmployee.password;
    if (!validPassword) {
      return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
    }
  }
  return res.json({
    success: true,
    data: {
      employee: {
        employeeId: 'employeeId' in employee ? employee.employeeId : employee.id,
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
