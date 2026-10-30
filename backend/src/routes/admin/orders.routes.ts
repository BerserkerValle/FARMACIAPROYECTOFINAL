import { Router } from 'express';
import { crosscheck, downloadAdminOrderInvoice, orderHistory, returns } from '../../controllers/admin.controller.js';
import { authorize } from '../../middleware/auth.js';

export const ordersRouter = Router();

ordersRouter.get('/order-history', authorize('Administrador', 'Gerente'), orderHistory);
ordersRouter.get('/orders/:id/invoice', authorize('Administrador', 'Gerente'), downloadAdminOrderInvoice);
ordersRouter.post('/orders/:id/crosscheck', authorize('Administrador', 'Gerente'), crosscheck);
ordersRouter.post('/orders/:id/returns', authorize('Administrador'), returns);