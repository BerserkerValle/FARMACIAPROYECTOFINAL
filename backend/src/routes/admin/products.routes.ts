import { Router } from 'express';
import multer from 'multer';
import { extname } from 'node:path';
import { createProduct, deleteProduct, listProducts, updateProduct, uploadProductImage } from '../../controllers/warehouse.controller.js';
import { getUploadsDir } from '../../utils.js';

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

export const productsRouter = Router();

productsRouter.get('/products', listProducts);
productsRouter.post('/products', createProduct);
productsRouter.put('/products/:id', updateProduct);
productsRouter.delete('/products/:id', deleteProduct);
productsRouter.post('/products/upload-image', upload.single('image'), uploadProductImage);