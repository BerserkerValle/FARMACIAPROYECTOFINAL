import { Router } from 'express';
import { createDiscountCode, listDiscountCodes, updateDiscountCode } from '../../controllers/discounts.controller.js';
import { authorize } from '../../middleware/auth.js';

export const discountsRouter = Router();

discountsRouter.use(authorize('Administrador', 'Gerente'));
discountsRouter.get('/discount-codes', listDiscountCodes);
discountsRouter.post('/discount-codes', createDiscountCode);
discountsRouter.patch('/discount-codes/:id', updateDiscountCode);
