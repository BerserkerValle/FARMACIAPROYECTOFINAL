import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { branchesRouter } from './branches.routes.js';
import { categoriesRouter } from './categories.routes.js';
import { dashboardRouter } from './dashboard.routes.js';
import { employeesRouter } from './employees.routes.js';
import { ordersRouter } from './orders.routes.js';
import { productsRouter } from './products.routes.js';
import { suppliersRouter } from './suppliers.routes.js';

export const adminRouter = Router();

adminRouter.use(authenticate, authorize('Administrador', 'Gerente'));

adminRouter.use(dashboardRouter);
adminRouter.use(employeesRouter);
adminRouter.use(branchesRouter);
adminRouter.use(categoriesRouter);
adminRouter.use(suppliersRouter);
adminRouter.use(ordersRouter);
adminRouter.use(productsRouter);