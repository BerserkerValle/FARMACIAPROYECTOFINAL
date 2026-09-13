/**
 * ============================================================================
 * PROYECTO FARMACIA - MIDDLEWARE DE AUTENTICACIÓN Y AUTORIZACIÓN (RBAC)
 * ============================================================================
 * Este módulo gestiona el control de acceso a las rutas protegidas de la API:
 * 1. Autenticación (`authenticate`):
 *    - Valida la presencia del ID de empleado en los encabezados HTTP.
 *    - Recupera el usuario desde la base de datos PostgreSQL o la memoria (fallback).
 *    - Adjunta la información del usuario autenticado a `req.user`.
 * 2. Autorización (`authorize`):
 *    - Implementa control de acceso basado en roles (Role-Based Access Control - RBAC).
 *    - Verifica si el rol del empleado tiene autorización para ejecutar el endpoint.
 * ============================================================================
 */

import type { NextFunction, Request, Response } from 'express';
import { databaseEnabled, findDatabaseEmployeeById } from '../db.js';
import { store } from '../store.js';

// ============================================================================
// MIDDLEWARE DE AUTENTICACIÓN (IDENTIFICACIÓN DE USUARIO)
// ============================================================================

/**
 * Middleware para autenticar las peticiones que requieren sesión de empleado.
 * 
 * ¿CÓMO FUNCIONA?
 * 1. Lee el encabezado HTTP 'x-employee-id' (o sus alternativas en español 'x-empleado-id' / 'x-user-id').
 * 2. Verifica que el ID sea un entero positivo válido. Si no lo es, responde con HTTP 401.
 * 3. Si PostgreSQL está activo (`databaseEnabled`), consulta `findDatabaseEmployeeById`.
 *    Si está en modo local/memoria, consulta `store.getEmployeeById`.
 * 4. Si el empleado no existe o está inactivo, rechaza con HTTP 401.
 * 5. Si es válido, inyecta los datos del empleado en `req.user` para su uso en los controladores.
 * 6. Llama a `next()` para continuar el flujo de ejecución.
 *
 * @param {Request} req Petición entrante de Express.
 * @param {Response} res Respuesta de Express.
 * @param {NextFunction} next Función para transferir el control al siguiente middleware.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  // Extracción del ID de empleado de los encabezados HTTP soportados
  const employeeId = Number(req.header('x-employee-id') ?? req.header('x-empleado-id') ?? req.header('x-user-id'));
  
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    return res.status(401).json({ 
      success: false, 
      message: 'Falta la sesión del empleado. Agrega el header X-Employee-Id: 1 después de iniciar sesión.' 
    });
  }

  // Búsqueda del empleado en PostgreSQL o Store en memoria
  const employee = databaseEnabled ? await findDatabaseEmployeeById(employeeId) : store.getEmployeeById(employeeId);
  if (!employee) {
    return res.status(401).json({ 
      success: false, 
      message: 'Empleado no encontrado o inactivo' 
    });
  }

  // Vinculación de los datos del usuario en el objeto Request de Express
  req.user = {
    employeeId: 'employeeId' in employee ? employee.employeeId : employee.id,
    role: employee.role,
    branchId: employee.branchId,
    fullName: employee.fullName,
    email: employee.email
  };

  return next();
}

// ============================================================================
// MIDDLEWARE DE AUTORIZACIÓN BASADA EN ROLES (RBAC)
// ============================================================================

/**
 * Generador de middleware para restringir endpoints a roles específicos.
 * 
 * ¿CÓMO FUNCIONA?
 * - Recibe una lista de roles permitidos como argumentos rest (`...roles`).
 * - Verifica primero que `req.user` exista (previamente establecido por `authenticate`).
 * - Comprueba si `req.user.role` está incluido en la lista de roles permitidos.
 * - Si no tiene el rol necesario, deniega el acceso con código HTTP 403 (Forbidden).
 * - Si el usuario cuenta con el rol adecuado, ejecuta `next()`.
 *
 * EJEMPLO DE USO EN RUTAS:
 * `router.post('/productos', authenticate, authorize('Administrador', 'Gerente'), crearProducto);`
 *
 * @param {...string[]} roles Lista de roles con permiso de acceso (ej: 'Administrador', 'Cajero').
 * @returns Retorna la función middleware de Express.
 */
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
