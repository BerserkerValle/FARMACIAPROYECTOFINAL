

import { Router } from 'express';
import multer from 'multer';
import { extname } from 'node:path';
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
import { getUploadsDir } from '../utils.js';


// CONFIGURACIÓN DE ALMACENAMIENTO DE IMÁGENES 

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, getUploadsDir());
  },
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase() || '.jpg';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `med-${uniqueSuffix}${ext}`);
  }
});
const upload = multer({ storage });

export const warehouseRouter = Router();


// RESTRICCIÓN DE ACCESO PARA PERSONAL DE BODEGA Y ADMINISTRACIÓN

warehouseRouter.use(authenticate, authorize('Administrador', 'Gerente', 'Bodeguero'));


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
