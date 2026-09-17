import { Router } from 'express';
import { dashboard, reports } from '../../controllers/admin.controller.js';

export const dashboardRouter = Router();

dashboardRouter.get('/dashboard', dashboard);
dashboardRouter.get('/reports', reports);