import { Router } from 'express';
import { crosscheck, orderHistory, returns } from '../../controllers/admin.controller.js';
import { authorize } from '../../middleware/auth.js';

export const ordersRouter = Router();

ordersRouter.get('/order-history', authorize('Administrador', 'Gerente'), orderHistory);
ordersRouter.post('/orders/:id/crosscheck', authorize('Administrador', 'Gerente'), crosscheck);
ordersRouter.post('/orders/:id/returns', authorize('Administrador'), returns);