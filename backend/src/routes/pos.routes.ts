/**
 * ============================================================================
 * PROYECTO FARMACIA - RUTAS DEL PUNTO DE VENTA Y DESPACHOS (/api/pos)
 * ============================================================================
 * Administra las operaciones directas de farmacia y reparto:
 * - Venta en mostrador físico con emisión de factura (POS).
 * - Consulta de órdenes pendientes de retiro en tienda física.
 * - Liberación formal de pedidos en mostrador con validación de receta.
 * - Asignación y actualización de telemetría de entregas motorizadas (Delivery).
 *
 * SEGURIDAD Y ROLES:
 * - Protegido por `authenticate` y `authorize('Administrador', 'Gerente', 'Cajero', 'Repartidor')`.
 * ============================================================================
 */

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

// ============================================================================
// RESTRICCIÓN DE ACCESO OPERATIVO
// ============================================================================
posRouter.use(authenticate, authorize('Administrador', 'Gerente', 'Cajero', 'Repartidor'));

// ============================================================================
// RETIROS EN TIENDA (PICKUP) Y VENTAS EN MOSTRADOR
// ============================================================================
posRouter.get('/pickup-orders', pickupOrders);
posRouter.post('/sales', createSale);
posRouter.post('/orders/:id/release', releasePickup);

// ============================================================================
// GESTIÓN Y RASTREO DE ENVÍOS A DOMICILIO (DELIVERY)
// ============================================================================
posRouter.get('/deliveries', deliveries);
posRouter.patch('/deliveries/:id', updateDelivery);
