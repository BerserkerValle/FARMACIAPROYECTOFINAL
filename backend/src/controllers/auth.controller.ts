import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { createDatabaseCustomerAccount, databaseEnabled, findDatabaseCustomerAccount, findDatabaseCustomerAccountById, findDatabaseEmployeeByEmail, updateDatabaseCustomerAccount } from '../db.js';
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

const customerRegistrationSchema = z.object({
  fullName: z.string().min(3),
  email: z.string().email(),
  password: z.string().min(6),
  phone: z.string().min(6),
  nit: z.string().min(3)
});

const customerLoginSchema = z.object({ email: z.string().email(), password: z.string().min(6) });

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

export async function registerCustomer(req: Request, res: Response) {
  try {
    const payload = customerRegistrationSchema.parse(req.body);
    const customer = databaseEnabled
      ? await createDatabaseCustomerAccount(payload)
      : (() => {
          const localCustomer = store.registerCustomerAccount(payload);
          return { customerId: localCustomer.id, fullName: localCustomer.name, email: localCustomer.email, phone: localCustomer.phone, nit: localCustomer.nit, address: localCustomer.address ?? '' };
        })();
    return res.status(201).json({ success: true, data: { customer } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo crear la cuenta';
    return res.status(400).json({ success: false, message: message.includes('duplicate key') ? 'El correo ya está registrado' : message });
  }
}

export async function loginCustomer(req: Request, res: Response) {
  try {
    const payload = customerLoginSchema.parse(req.body);
    const customer = databaseEnabled
      ? await findDatabaseCustomerAccount(payload.email, payload.password)
      : (() => {
          const localCustomer = store.findCustomerAccount(payload.email, payload.password);
          return localCustomer ? { customerId: localCustomer.id, fullName: localCustomer.name, email: localCustomer.email, phone: localCustomer.phone, nit: localCustomer.nit, address: localCustomer.address ?? '' } : null;
        })();
    if (!customer) return res.status(401).json({ success: false, message: 'Correo o contraseña inválidos' });
    return res.json({ success: true, data: { customer } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo iniciar sesión';
    return res.status(400).json({ success: false, message });
  }
}

export async function updateCustomer(req: Request, res: Response) {
  try {
    const customerId = Number(req.header('x-customer-id'));
    const payload = customerRegistrationSchema.omit({ email: true, password: true }).extend({ address: z.string().optional() }).parse(req.body);
    const customer = databaseEnabled
      ? await updateDatabaseCustomerAccount(customerId, { ...payload, address: payload.address ?? '' })
      : (() => {
          const current = store.getCustomerById(customerId);
          if (!current) throw new Error('Cuenta de cliente no encontrada');
          current.name = payload.fullName;
          current.phone = payload.phone;
          current.nit = payload.nit;
          current.address = payload.address ?? '';
          current.updatedAt = new Date().toISOString();
          return current;
        })();
    if (databaseEnabled) return res.json({ success: true, data: { customer } });
    if ('id' in customer) {
      return res.json({ success: true, data: { customer: { customerId: customer.id, fullName: customer.name, email: customer.email, phone: customer.phone, nit: customer.nit, address: customer.address ?? '' } } });
    }
    return res.json({ success: true, data: { customer } });
  } catch (error) {
    return res.status(400).json({ success: false, message: error instanceof Error ? error.message : 'No se pudo actualizar la cuenta' });
  }
}

export function me(req: Request, res: Response) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'No autenticado' });
  }
  return res.json({ success: true, data: req.user });
}
