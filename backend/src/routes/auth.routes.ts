/**
 * ============================================================================
 * PROYECTO FARMACIA - RUTAS DE AUTENTICACIÓN (/api/auth)
 * ============================================================================
 * Centraliza las rutas de autenticación y sesiones para:
 * 1. Empleados: Inicio de sesión (`/login`) y perfil activo (`/me`).
 * 2. Clientes: Registro (`/customers/register`), login (`/customers/login`) y
 *    actualización de datos (`/customers/me`).
 * ============================================================================
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { 
  login, 
  loginCustomer, 
  me, 
  registerCustomer, 
  updateCustomer 
} from '../controllers/auth.controller.js';

export const authRouter = Router();

// ============================================================================
// RUTAS DE ACCESO PARA EMPLEADOS
// ============================================================================
authRouter.post('/login', login);
authRouter.get('/me', authenticate, me);

// ============================================================================
// RUTAS DE ACCESO PARA CLIENTES (E-COMMERCE)
// ============================================================================
authRouter.post('/customers/register', registerCustomer);
authRouter.post('/customers/login', loginCustomer);
authRouter.put('/customers/me', updateCustomer);
