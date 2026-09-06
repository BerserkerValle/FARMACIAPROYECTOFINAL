import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { createSale, pickupOrders, releasePickup } from '../controllers/pos.controller.js';

export const posRouter = Router();

posRouter.use(authenticate, authorize('Administrador', 'Gerente', 'Cajero'));
posRouter.get('/pickup-orders', pickupOrders);
posRouter.post('/sales', createSale);
posRouter.post('/orders/:id/release', releasePickup);
