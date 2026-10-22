import { Router } from 'express';
import multer from 'multer';
import { createProduct, deleteProduct, listProducts, updateProduct, uploadProductImage } from '../../controllers/warehouse.controller.js';

const upload = multer({ storage: multer.memoryStorage() });

export const productsRouter = Router();

productsRouter.get('/products', listProducts);
productsRouter.post('/products', createProduct);
productsRouter.put('/products/:id', updateProduct);
productsRouter.delete('/products/:id', deleteProduct);
productsRouter.post('/products/upload-image', upload.single('image'), uploadProductImage);
