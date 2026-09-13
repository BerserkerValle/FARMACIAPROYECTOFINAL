/**
 * ============================================================================
 * PROYECTO FARMACIA - RUTAS DEL MÓDULO DE ADMINISTRACIÓN (/api/admin)
 * ============================================================================
 * Define los endpoints protegidos para la administración general del sistema:
 * - Indicadores clave (KPIs) y dashboard
 * - Reportes gerenciales y analítica de ventas
 * - Mantenimiento de personal (Empleados)
 * - Mantenimiento de Sucursales, Categorías y Proveedores
 * - Control de calidad (Doble chequeo / Crosscheck) y Devoluciones
 * - Catálogo maestro de productos y carga de imágenes
 *
 * SEGURIDAD Y PERMISOS:
 * - Requiere autenticación de sesión de empleado (`authenticate`).
 * - Restringido exclusivamente a los roles 'Administrador' y 'Gerente' (`authorize`).
 * ============================================================================
 */

import { Router } from 'express';
import multer from 'multer';
import { extname } from 'node:path';
import { authenticate, authorize } from '../middleware/auth.js';
import { 
  branches, 
  categories, 
  createBranch, 
  createCategory, 
  createEmployee, 
  createSupplier, 
  crosscheck, 
  dashboard, 
  deleteBranch, 
  deleteCategory, 
  deleteEmployee, 
  deleteSupplier, 
  employees, 
  reports, 
  returns, 
  suppliers, 
  updateBranch, 
  updateCategory, 
  updateEmployee, 
  updateSupplier 
} from '../controllers/admin.controller.js';
import { 
  createProduct, 
  deleteProduct, 
  listProducts, 
  updateProduct, 
  uploadProductImage 
} from '../controllers/warehouse.controller.js';
import { getUploadsDir } from '../utils.js';

// ============================================================================
// CONFIGURACIÓN DE ALMACENAMIENTO MULTIMEDIA (MULTER)
// ============================================================================

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

// ============================================================================
// APLICACIÓN DE MIDDLEWARES GLOBALES DE SEGURIDAD PARA ADMINISTRACIÓN
// ============================================================================
adminRouter.use(authenticate, authorize('Administrador', 'Gerente'));

// ============================================================================
// 1. DASHBOARD Y REPORTES
// ============================================================================
adminRouter.get('/dashboard', dashboard);
adminRouter.get('/reports', reports);

// ============================================================================
// 2. GESTIÓN DE EMPLEADOS / COLABORADORES
// ============================================================================
adminRouter.get('/employees', employees);
adminRouter.post('/employees', createEmployee);
adminRouter.put('/employees/:id', updateEmployee);
adminRouter.delete('/employees/:id', deleteEmployee);

// ============================================================================
// 3. GESTIÓN DE SUCURSALES
// ============================================================================
adminRouter.get('/branches', branches);
adminRouter.post('/branches', createBranch);
adminRouter.put('/branches/:id', updateBranch);
adminRouter.delete('/branches/:id', deleteBranch);

// ============================================================================
// 4. GESTIÓN DE CATEGORÍAS
// ============================================================================
adminRouter.get('/categories', categories);
adminRouter.post('/categories', createCategory);
adminRouter.put('/categories/:id', updateCategory);
adminRouter.delete('/categories/:id', deleteCategory);

// ============================================================================
// 5. GESTIÓN DE PROVEEDORES
// ============================================================================
adminRouter.get('/suppliers', suppliers);
adminRouter.post('/suppliers', createSupplier);
adminRouter.put('/suppliers/:id', updateSupplier);
adminRouter.delete('/suppliers/:id', deleteSupplier);

// ============================================================================
// 6. CONTROL DE CALIDAD Y DEVOLUCIONES
// ============================================================================
adminRouter.post('/orders/:id/crosscheck', crosscheck);
adminRouter.post('/orders/:id/returns', returns);

// ============================================================================
// 7. GESTIÓN MAESTRA DE PRODUCTOS E IMÁGENES
// ============================================================================
adminRouter.get('/products', listProducts);
adminRouter.post('/products', createProduct);
adminRouter.put('/products/:id', updateProduct);
adminRouter.delete('/products/:id', deleteProduct);
adminRouter.post('/products/upload-image', upload.single('image'), uploadProductImage);
