import { Router } from 'express';
import { categories, createCategory, deleteCategory, updateCategory } from '../../controllers/admin.controller.js';

export const categoriesRouter = Router();

categoriesRouter.get('/categories', categories);
categoriesRouter.post('/categories', createCategory);
categoriesRouter.put('/categories/:id', updateCategory);
categoriesRouter.delete('/categories/:id', deleteCategory);