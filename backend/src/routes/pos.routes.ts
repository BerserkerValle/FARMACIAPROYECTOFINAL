
import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { 
  createSale, 
  deliveries, 
  pickupOrders, 
  releasePickup, 
  updateDelivery 
} from '../controllers/pos.controller.js';

export const posRouter = Router();


// RESTRICCIÓN DE ACCESO OPERATIVO

posRouter.use(authenticate, authorize('Administrador', 'Gerente', 'Cajero', 'Repartidor'));


// RETIROS EN TIENDA (PICKUP) Y VENTAS EN MOSTRADOR
posRouter.get('/pickup-orders', pickupOrders);
posRouter.post('/sales', createSale);
posRouter.post('/orders/:id/release', releasePickup);

// GESTIÓN Y RASTREO DE ENVÍOS A DOMICILIO (DELIVERY)

posRouter.get('/deliveries', deliveries);
posRouter.patch('/deliveries/:id', updateDelivery);
