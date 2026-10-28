import { Router } from 'express';
import multer from 'multer';
import { createProduct, deleteProduct, listProducts, updateProduct, uploadProductImage } from '../../controllers/warehouse.controller.js';
import { authorize } from '../../middleware/auth.js';

const upload = multer({ storage: multer.memoryStorage() });

export const productsRouter = Router();

productsRouter.use(authorize('Administrador'));

productsRouter.get('/products', listProducts);
productsRouter.post('/products', createProduct);
productsRouter.put('/products/:id', updateProduct);
productsRouter.delete('/products/:id', deleteProduct);
productsRouter.post('/products/upload-image', upload.single('image'), uploadProductImage);
