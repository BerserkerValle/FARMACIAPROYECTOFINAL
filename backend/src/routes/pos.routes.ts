
import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { DELIVERY_ROLES, POS_ROLES } from '../utils/permissions.js';
import { 
  createSale, 
  createQrPayment,
  deliveries, 
  pickupOrders, 
  releasePickup, 
  updateDelivery 
} from '../controllers/pos.controller.js';

export const posRouter = Router();


posRouter.use(authenticate);

// RETIROS EN TIENDA (PICKUP) Y VENTAS EN MOSTRADOR — solo personal de caja
posRouter.get('/pickup-orders', authorize(...POS_ROLES), pickupOrders);
posRouter.post('/sales', authorize(...POS_ROLES), createSale);
posRouter.post('/qr-payment', authorize(...POS_ROLES), createQrPayment);
posRouter.post('/orders/:id/release', authorize(...POS_ROLES), releasePickup);

// GESTIÓN Y RASTREO DE ENVÍOS A DOMICILIO (DELIVERY) — repartidores y supervisores
posRouter.get('/deliveries', authorize(...DELIVERY_ROLES), deliveries);
posRouter.patch('/deliveries/:id', authorize(...DELIVERY_ROLES), updateDelivery);
