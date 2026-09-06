import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { login, loginCustomer, me, registerCustomer, updateCustomer } from '../controllers/auth.controller.js';

export const authRouter = Router();

authRouter.post('/login', login);
authRouter.post('/customers/register', registerCustomer);
authRouter.post('/customers/login', loginCustomer);
authRouter.put('/customers/me', updateCustomer);
authRouter.get('/me', authenticate, me);
