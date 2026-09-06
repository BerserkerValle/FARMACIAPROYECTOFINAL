import { Router } from 'express';
import multer from 'multer';
import { extname } from 'node:path';
import { authenticate, authorize } from '../middleware/auth.js';
import { branches, categories, createBranch, createCategory, createEmployee, createSupplier, crosscheck, dashboard, deleteBranch, deleteCategory, deleteEmployee, deleteSupplier, employees, reports, returns, suppliers, updateBranch, updateCategory, updateEmployee, updateSupplier } from '../controllers/admin.controller.js';
import { createProduct, deleteProduct, listProducts, updateProduct, uploadProductImage } from '../controllers/warehouse.controller.js';
import { getUploadsDir } from '../utils.js';

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

export const adminRouter = Router();

adminRouter.use(authenticate, authorize('Administrador', 'Gerente'));
adminRouter.get('/dashboard', dashboard);
adminRouter.get('/reports', reports);
adminRouter.get('/employees', employees);
adminRouter.post('/employees', createEmployee);
adminRouter.put('/employees/:id', updateEmployee);
adminRouter.delete('/employees/:id', deleteEmployee);
adminRouter.get('/branches', branches);
adminRouter.post('/branches', createBranch);
adminRouter.put('/branches/:id', updateBranch);
adminRouter.delete('/branches/:id', deleteBranch);
adminRouter.get('/categories', categories);
adminRouter.post('/categories', createCategory);
adminRouter.put('/categories/:id', updateCategory);
adminRouter.delete('/categories/:id', deleteCategory);
adminRouter.get('/suppliers', suppliers);
adminRouter.post('/suppliers', createSupplier);
adminRouter.put('/suppliers/:id', updateSupplier);
adminRouter.delete('/suppliers/:id', deleteSupplier);
adminRouter.post('/orders/:id/crosscheck', crosscheck);
adminRouter.post('/orders/:id/returns', returns);
adminRouter.get('/products', listProducts);
adminRouter.post('/products', createProduct);
adminRouter.put('/products/:id', updateProduct);
adminRouter.delete('/products/:id', deleteProduct);
adminRouter.post('/products/upload-image', upload.single('image'), uploadProductImage);

