import { Router } from 'express';
import { createSupplier, deleteSupplier, suppliers, updateSupplier } from '../../controllers/admin.controller.js';
import { authorize } from '../../middleware/auth.js';

export const suppliersRouter = Router();

suppliersRouter.use(authorize('Administrador'));

suppliersRouter.get('/suppliers', suppliers);
suppliersRouter.post('/suppliers', createSupplier);
suppliersRouter.put('/suppliers/:id', updateSupplier);
suppliersRouter.delete('/suppliers/:id', deleteSupplier);