import { Router } from 'express';
import { dashboard, reports } from '../../controllers/admin.controller.js';
import { authorize } from '../../middleware/auth.js';
import { ADMIN_ROLES } from '../../utils/permissions.js';

export const dashboardRouter = Router();

dashboardRouter.use(authorize(...ADMIN_ROLES));
dashboardRouter.get('/dashboard', dashboard);
dashboardRouter.get('/reports', reports);