import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { createSale, deliveries, pickupOrders, releasePickup, updateDelivery } from '../controllers/pos.controller.js';

export const posRouter = Router();

posRouter.use(authenticate, authorize('Administrador', 'Gerente', 'Cajero', 'Repartidor'));
posRouter.get('/pickup-orders', pickupOrders);
posRouter.get('/deliveries', deliveries);
posRouter.patch('/deliveries/:id', updateDelivery);
posRouter.post('/sales', createSale);
posRouter.post('/orders/:id/release', releasePickup);
