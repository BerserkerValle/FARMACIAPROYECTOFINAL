import { z } from 'zod';

export const quoteDiscountCodeSchema = z.object({
  code: z.string().trim().toUpperCase().min(1).max(32),
  email: z.string().trim().email('Ingresa un correo válido'),
  branchId: z.number().int().positive(),
  items: z.array(z.object({
    productId: z.number().int().positive(),
    quantity: z.number().int().positive()
  })).min(1)
});
