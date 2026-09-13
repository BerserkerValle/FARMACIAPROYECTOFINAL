/**
 * ============================================================================
 * PROYECTO FARMACIA - RUTAS PÚBLICAS Y TIENDA ONLINE (/api/public)
 * ============================================================================
 * Endpoints públicos sin requerimiento de autenticación de personal:
 * - Consulta de sucursales, categorías y proveedores.
 * - Búsqueda en catálogo con filtros de stock.
 * - Checkout y pasarela de pago (Stripe / Efectivo).
 * - Carga de recetas médicas digitales asociadas a pedidos o temporales (Multer).
 * - Consulta y seguimiento de órdenes por código de compra (Tracking).
 * - Consulta de historial de compras para clientes registrados.
 * ============================================================================
 */

import { Router } from 'express';
import multer from 'multer';
import { extname } from 'node:path';
import {
  branches,
  catalog,
  categories,
  checkout,
  customerOrders,
  getOrder,
  suppliers,
  trackOrder,
  uploadPrescription,
  uploadTemporaryPrescription
} from '../controllers/public.controller.js';
import { getUploadsDir } from '../utils.js';

// ============================================================================
// CONFIGURACIÓN DE MULTER PARA CARGA DE RECETAS MÉDICAS
// ============================================================================
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, getUploadsDir());
  },
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase() || '.jpg';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `rx-${uniqueSuffix}${ext}`);
  }
});
const upload = multer({ storage });

export const publicRouter = Router();

// ============================================================================
// CONSULTAS PÚBLICAS Y CATÁLOGO
// ============================================================================
publicRouter.get('/branches', branches);
publicRouter.get('/categories', categories);
publicRouter.get('/suppliers', suppliers);
publicRouter.get('/catalog', catalog);

// ============================================================================
// CHECKOUT Y SEGUIMIENTO DE COMPRAS
// ============================================================================
publicRouter.post('/checkout', checkout);
publicRouter.get('/customer/orders', customerOrders);
publicRouter.get('/orders/:id', getOrder);
publicRouter.get('/orders/code/:code', trackOrder);

// ============================================================================
// SUBIDA DE RECETAS MÉDICAS
// ============================================================================
publicRouter.post('/prescriptions/temp', upload.single('recipe'), uploadTemporaryPrescription);
publicRouter.post('/orders/prescription', upload.single('recipe'), uploadPrescription);
