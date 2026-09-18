

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


// RUTAS DE ACCESO PARA EMPLEADOS

authRouter.post('/login', login);
authRouter.get('/me', authenticate, me);

// RUTAS DE ACCESO PARA CLIENTES (E-COMMERCE)

authRouter.post('/customers/register', registerCustomer);
authRouter.post('/customers/login', loginCustomer);
authRouter.put('/customers/me', updateCustomer);
