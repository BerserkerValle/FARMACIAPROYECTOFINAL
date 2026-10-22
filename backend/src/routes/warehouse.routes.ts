

import { Router } from 'express';
import multer from 'multer';
import { authenticate, authorize } from '../middleware/auth.js';
import {
  categories,
  createProduct,
  deleteProduct,
  listProducts,
  lots,
  receive,
  suppliers,
  updateProduct,
  uploadProductImage
} from '../controllers/warehouse.controller.js';
import { WAREHOUSE_ROLES } from '../utils/permissions.js';


// CONFIGURACIÓN DE ALMACENAMIENTO DE IMÁGENES 

const upload = multer({ storage: multer.memoryStorage() });

export const warehouseRouter = Router();


// RESTRICCIÓN DE ACCESO PARA PERSONAL DE BODEGA Y ADMINISTRACIÓN

warehouseRouter.use(authenticate, authorize(...WAREHOUSE_ROLES));


// GESTIÓN DE LOTES Y RECEPCIÓN DE MERCADERÍA

warehouseRouter.get('/lots', lots);
warehouseRouter.post('/receive', receive);


// GESTIÓN DE CATÁLOGO DE MEDICAMENTOS E IMÁGENES

warehouseRouter.get('/products', listProducts);
warehouseRouter.post('/products', createProduct);
warehouseRouter.put('/products/:id', updateProduct);
warehouseRouter.delete('/products/:id', deleteProduct);
warehouseRouter.post('/products/upload-image', upload.single('image'), uploadProductImage);


// CATÁLOGOS AUXILIARES DE BODEGA

warehouseRouter.get('/categories', categories);
warehouseRouter.get('/suppliers', suppliers);
