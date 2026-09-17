import { Router } from 'express';
import { createSupplier, deleteSupplier, suppliers, updateSupplier } from '../../controllers/admin.controller.js';

export const suppliersRouter = Router();

suppliersRouter.get('/suppliers', suppliers);
suppliersRouter.post('/suppliers', createSupplier);
suppliersRouter.put('/suppliers/:id', updateSupplier);
suppliersRouter.delete('/suppliers/:id', deleteSupplier);