import { Router } from 'express';
import { crosscheck, returns } from '../../controllers/admin.controller.js';

export const ordersRouter = Router();

ordersRouter.post('/orders/:id/crosscheck', crosscheck);
ordersRouter.post('/orders/:id/returns', returns);