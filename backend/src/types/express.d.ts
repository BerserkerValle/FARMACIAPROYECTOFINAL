/**
 * ============================================================================
 * PROYECTO FARMACIA - DECLARACIÓN DE TIPOS GLOBALES PARA EXPRESS
 * ============================================================================
 * Este archivo implementa Module Augmentation sobre el espacio de nombres
 * global de Express para extender la interfaz estándar `Request`.
 * 
 * Permite que TypeScript reconozca la propiedad `req.user` tipada de forma
 * segura en todos los controladores y middlewares de la aplicación una vez
 * validada la sesión del empleado.
 * ============================================================================
 */

import type { Role } from '../domain.js';

declare global {
  namespace Express {
    interface Request {
      /**
       * Datos del empleado o colaborador actualmente autenticado en la sesión.
       * Inyectado por el middleware `authenticate`.
       */
      user?: {
        /** ID numérico único del empleado */
        employeeId: number;
        /** Rol operativo del empleado en el sistema */
        role: Role;
        /** Sucursal asignada (o null si es administrador corporativo) */
        branchId: number | null;
        /** Nombre completo del empleado */
        fullName: string;
        /** Correo electrónico corporativo */
        email: string;
      };
    }
  }
}

export {};
