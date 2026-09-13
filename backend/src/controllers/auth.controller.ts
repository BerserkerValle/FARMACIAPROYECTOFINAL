/**
 * ============================================================================
 * PROYECTO FARMACIA - CONTROLADOR DE AUTENTICACIÓN Y GESTIÓN DE SESIONES
 * ============================================================================
 * Este módulo administra el ciclo de autenticación para dos tipos de usuarios:
 * 1. Empleados / Personal Interno:
 *    - Administradores, Gerentes, Cajeros, Bodegueros, Repartidores.
 *    - Verificación mediante contraseñas cifradas con bcrypt (costo 12).
 *    - Retorno de datos de sesión con roles asignados.
 * 2. Clientes de la Farmacia Virtual (E-commerce):
 *    - Registro de cuenta con NIT, teléfono y credenciales.
 *    - Inicio de sesión y actualización de perfil de entrega.
 *
 * MÉTODOS Y LIBRERÍAS:
 * - Zod: Validación rigurosa de tipos en tiempo de ejecución y esquemas de entrada.
 * - bcryptjs: Comparación segura de contraseñas contra hashes almacenados.
 * - Soporte dual: PostgreSQL (`db.ts`) con fallback automático a memoria (`store.ts`).
 * ============================================================================
 */

import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { 
  createDatabaseCustomerAccount, 
  databaseEnabled, 
  findDatabaseCustomerAccount, 
  findDatabaseCustomerAccountById, 
  findDatabaseEmployeeByEmail, 
  updateDatabaseCustomerAccount 
} from '../db.js';
import { store } from '../store.js';

// ============================================================================
// ESQUEMAS DE VALIDACIÓN ZOD (DTOs)
// ============================================================================

/**
 * Esquema de validación para el inicio de sesión de empleados.
 * Admite nombres de propiedades en inglés o español para interoperabilidad.
 */
const loginSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(4).optional(),
  correo_corporativo: z.string().email().optional(),
  contrasena: z.string().min(4).optional()
}).refine(
  (value) => (value.email || value.correo_corporativo) && (value.password || value.contrasena),
  { message: 'Correo y contraseña son obligatorios' }
);

/**
 * Esquema de validación para el registro de nuevos clientes en el portal web.
 */
const customerRegistrationSchema = z.object({
  fullName: z.string().min(3, 'El nombre debe tener al menos 3 caracteres'),
  email: z.string().email('Formato de correo electrónico inválido'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
  phone: z.string().min(6, 'Número de teléfono inválido'),
  nit: z.string().min(3, 'NIT inválido o ingrese CF')
});

/**
 * Esquema de validación para el inicio de sesión del cliente e-commerce.
 */
const customerLoginSchema = z.object({ 
  email: z.string().email('Correo electrónico no válido'), 
  password: z.string().min(6, 'Contraseña mínima de 6 caracteres') 
});

// ============================================================================
// ENDPOINTS DE AUTENTICACIÓN DE EMPLEADOS
// ============================================================================

/**
 * Endpoint de Login para Empleados / Personal Administrativo y Operativo.
 * POST /api/auth/login
 * 
 * ¿CÓMO FUNCIONA?
 * 1. Valida el cuerpo de la petición con `loginSchema`.
 * 2. Busca al empleado por correo electrónico (en PostgreSQL o en el almacén local).
 * 3. Si existe, verifica la contraseña usando `bcrypt.compare` (o texto plano si no tiene hash bcrypt).
 * 4. Si es válida, retorna los datos públicos del empleado (id, rol, sucursal, etc.).
 */
export async function login(req: Request, res: Response) {
  const payload = loginSchema.parse(req.body);
  const email = payload.email ?? payload.correo_corporativo!;
  const password = payload.password ?? payload.contrasena!;

  // Intenta recuperar el empleado desde la base de datos o desde el store en memoria
  const databaseEmployee = databaseEnabled ? await findDatabaseEmployeeByEmail(email) : null;
  const employee = databaseEmployee ?? store.findEmployeeByCredentials(email, password);

  if (!employee) {
    return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
  }

  // Validación de seguridad criptográfica con bcrypt para base de datos
  if (databaseEmployee) {
    const validPassword = databaseEmployee.password.startsWith('$2')
      ? await bcrypt.compare(password, databaseEmployee.password)
      : password === databaseEmployee.password;

    if (!validPassword) {
      return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
    }
  }

  // Respuesta exitosa con la información de sesión
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

// ============================================================================
// ENDPOINTS DE AUTENTICACIÓN Y GESTIÓN DE CLIENTES
// ============================================================================

/**
 * Endpoint para el registro de clientes desde el portal web.
 * POST /api/auth/customers/register
 * 
 * ¿CÓMO FUNCIONA?
 * 1. Valida los datos requeridos (nombre, correo, teléfono, NIT, contraseña).
 * 2. Encripta la contraseña y persiste el cliente en PostgreSQL o en memoria.
 * 3. Previene duplicidad de correos electrónicos.
 */
export async function registerCustomer(req: Request, res: Response) {
  try {
    const payload = customerRegistrationSchema.parse(req.body);
    const customer = databaseEnabled
      ? await createDatabaseCustomerAccount(payload)
      : (() => {
          const localCustomer = store.registerCustomerAccount(payload);
          return { 
            customerId: localCustomer.id, 
            fullName: localCustomer.name, 
            email: localCustomer.email, 
            phone: localCustomer.phone, 
            nit: localCustomer.nit, 
            address: localCustomer.address ?? '' 
          };
        })();

    return res.status(201).json({ success: true, data: { customer } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo crear la cuenta';
    return res.status(400).json({ 
      success: false, 
      message: message.includes('duplicate key') ? 'El correo ya está registrado' : message 
    });
  }
}

/**
 * Endpoint para inicio de sesión de clientes en la tienda en línea.
 * POST /api/auth/customers/login
 */
export async function loginCustomer(req: Request, res: Response) {
  try {
    const payload = customerLoginSchema.parse(req.body);
    const customer = databaseEnabled
      ? await findDatabaseCustomerAccount(payload.email, payload.password)
      : (() => {
          const localCustomer = store.findCustomerAccount(payload.email, payload.password);
          return localCustomer ? { 
            customerId: localCustomer.id, 
            fullName: localCustomer.name, 
            email: localCustomer.email, 
            phone: localCustomer.phone, 
            nit: localCustomer.nit, 
            address: localCustomer.address ?? '' 
          } : null;
        })();

    if (!customer) {
      return res.status(401).json({ success: false, message: 'Correo o contraseña inválidos' });
    }

    return res.json({ success: true, data: { customer } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo iniciar sesión';
    return res.status(400).json({ success: false, message });
  }
}

/**
 * Endpoint para actualizar información del cliente (teléfono, NIT, dirección).
 * PUT /api/auth/customers/me
 */
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
      return res.json({ 
        success: true, 
        data: { 
          customer: { 
            customerId: customer.id, 
            fullName: customer.name, 
            email: customer.email, 
            phone: customer.phone, 
            nit: customer.nit, 
            address: customer.address ?? '' 
          } 
        } 
      });
    }
    return res.json({ success: true, data: { customer } });
  } catch (error) {
    return res.status(400).json({ 
      success: false, 
      message: error instanceof Error ? error.message : 'No se pudo actualizar la cuenta' 
    });
  }
}

// ============================================================================
// VERIFICACIÓN DEL PERFIL EN SESIÓN ACTIVA
// ============================================================================

/**
 * Retorna el perfil y los datos de la sesión del empleado actualmente autenticado.
 * GET /api/auth/me
 */
export function me(req: Request, res: Response) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'No autenticado' });
  }
  return res.json({ success: true, data: req.user });
}
