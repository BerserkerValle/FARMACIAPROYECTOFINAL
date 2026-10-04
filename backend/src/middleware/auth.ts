/**
 * ============================================================================
 * PROYECTO FARMACIA - MIDDLEWARE DE AUTENTICACIÓN Y AUTORIZACIÓN (RBAC)
 * ============================================================================
 * La identidad se toma EXCLUSIVAMENTE del encabezado `Authorization: Bearer <jwt>`.
 * Nunca se confía en identificadores enviados por el cliente (x-employee-id, etc.).
 * El rol NO viaja en el JWT: se relee de la base de datos en cada petición, de modo
 * que un cambio de rol surte efecto en la request siguiente sin reemitir el token.
 * ============================================================================
 */

import type { NextFunction, Request, Response } from 'express';
import type { Role } from '../domain.js';
import { databaseEnabled, findDatabaseCustomerAccountById, findDatabaseEmployeeById } from '../db.js';
import { store } from '../store.js';
import { getCustomerIdFromToken, getEmployeeIdFromToken } from '../utils/jwt.js';
import { FORBIDDEN_MESSAGE } from '../utils/permissions.js';

// ============================================================================
// MIDDLEWARE DE AUTENTICACIÓN (IDENTIFICACIÓN DE USUARIO)
// ============================================================================

function bearerToken(req: Request): string {
  const authorization = req.header('authorization');
  if (!authorization || !authorization.startsWith('Bearer ')) return '';
  return authorization.slice('Bearer '.length).trim();
}

async function loadAuthenticatedEmployee(req: Request) {
  const token = bearerToken(req);
  const employeeId = token ? getEmployeeIdFromToken(token) : null;
  if (!employeeId) return { error: 401 as const, message: 'Token inválido o expirado' };

  const employee = databaseEnabled ? await findDatabaseEmployeeById(employeeId) : store.getEmployeeById(employeeId);
  if (!employee) return { error: 401 as const, message: 'Empleado no encontrado o inactivo' };

  req.user = {
    employeeId: 'employeeId' in employee ? employee.employeeId : employee.id,
    role: employee.role,
    branchId: employee.branchId,
    fullName: employee.fullName,
    email: employee.email
  };
  return null;
}

/**
 * Autentica la petición como sesión de empleado (plantilla interna, POS, bodega).
 * Responde 401 si no hay token válido o el empleado no existe / está inactivo.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const failure = await loadAuthenticatedEmployee(req);
  if (failure) {
    return res.status(failure.error).json({ success: false, message: failure.message });
  }
  return next();
}

// ============================================================================
// MIDDLEWARE DE AUTORIZACIÓN BASADA EN ROLES (RBAC)
// ============================================================================

/**
 * Restringe un endpoint a los roles indicados. Requiere `authenticate` previo.
 * Responde 403 si el rol no está en la lista.
 */
export function authorize(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'No autenticado' });
    }
    if (roles.length > 0 && !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: FORBIDDEN_MESSAGE });
    }
    return next();
  };
}

/**
 * Para endpoints públicos que sirven tanto a un cliente propietario como al personal
 * autorizado (consulta de pedido, seguimiento, carga de receta).
 * - Token de cliente válido -> `res.locals.customerId` (el controlador valida la propiedad).
 * - Token de empleado válido -> `req.user` y se aplica el RBAC indicado.
 * - Sin token o token inválido -> 401.
 */
export function authorizeStaffOrCustomer(...roles: Role[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = bearerToken(req);
    if (!token) {
      return res.status(401).json({ success: false, message: 'No autenticado' });
    }

    const customerId = getCustomerIdFromToken(token);
    if (customerId) {
      const customer = databaseEnabled
        ? await findDatabaseCustomerAccountById(customerId)
        : store.getCustomerById(customerId);
      if (!customer) {
        return res.status(401).json({ success: false, message: 'Cuenta de cliente no encontrada' });
      }
      res.locals.customerId = customerId;
      return next();
    }

    const failure = await loadAuthenticatedEmployee(req);
    if (failure) {
      return res.status(failure.error).json({ success: false, message: failure.message });
    }
    if (roles.length > 0 && !roles.includes(req.user!.role)) {
      return res.status(403).json({ success: false, message: FORBIDDEN_MESSAGE });
    }
    return next();
  };
}

function customerIdFromRequest(req: Request) {
  const token = bearerToken(req);
  return token ? getCustomerIdFromToken(token) : null;
}

export async function authenticateCustomer(req: Request, res: Response, next: NextFunction) {
  const customerId = customerIdFromRequest(req);
  if (!customerId) {
    return res.status(401).json({ success: false, message: 'Sesión de cliente inválida o expirada' });
  }

  const customer = databaseEnabled
    ? await findDatabaseCustomerAccountById(customerId)
    : store.getCustomerById(customerId);
  if (!customer) {
    return res.status(401).json({ success: false, message: 'Cuenta de cliente no encontrada' });
  }

  res.locals.customerId = customerId;
  return next();
}

export function optionalAuthenticateCustomer(req: Request, res: Response, next: NextFunction) {
  const authorization = req.header('authorization');
  const customerId = customerIdFromRequest(req);
  if (authorization && !customerId) {
    return res.status(401).json({ success: false, message: 'Sesión de cliente inválida o expirada' });
  }
  if (customerId) res.locals.customerId = customerId;
  return next();
}
