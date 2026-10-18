import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  createDatabaseDiscountCode,
  databaseEnabled,
  listDatabaseDiscountCodes,
  quoteDatabaseDiscountCode,
  setDatabaseDiscountCodeActive
} from '../db.js';
import type { DiscountCode } from '../domain.js';
import { store } from '../store.js';
import { quoteDiscountCodeSchema } from './discounts.schemas.js';

const discountCodeInputSchema = z.object({
  code: z.string().trim().toUpperCase().min(4).max(32).regex(/^[A-Z0-9][A-Z0-9-]*$/, 'Usa letras, números o guiones'),
  type: z.enum(['PERCENTAGE', 'FIXED']),
  value: z.number().positive(),
  maxUses: z.number().int().min(1).max(10000).default(100),
  startsAt: z.string().datetime().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional()
}).superRefine((value, context) => {
  if (value.type === 'PERCENTAGE' && value.value > 50) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'El descuento porcentual máximo es 50%' });
  }
  if (value.startsAt && value.expiresAt && new Date(value.expiresAt) <= new Date(value.startsAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: 'El vencimiento debe ser posterior al inicio' });
  }
});

const activeSchema = z.object({ active: z.boolean() });

export async function listDiscountCodes(_req: Request, res: Response) {
  const data = databaseEnabled ? await listDatabaseDiscountCodes() : store.getDiscountCodes();
  return res.json({ success: true, data });
}

export async function createDiscountCode(req: Request, res: Response) {
  try {
    const payload = discountCodeInputSchema.parse(req.body);
    const input: Omit<DiscountCode, 'id' | 'createdAt'> = {
      ...payload,
      startsAt: payload.startsAt ?? null,
      expiresAt: payload.expiresAt ?? null,
      active: true
    };
    const data = databaseEnabled
      ? await createDatabaseDiscountCode(input)
      : store.createDiscountCode(input);
    return res.status(201).json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo crear el código';
    return res.status(400).json({
      success: false,
      message: message.includes('duplicate key') ? 'Ya existe un código con ese nombre' : message
    });
  }
}

export async function updateDiscountCode(req: Request, res: Response) {
  try {
    const { active } = activeSchema.parse(req.body);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new Error('Identificador de código inválido');
    const data = databaseEnabled
      ? await setDatabaseDiscountCodeActive(id, active)
      : store.setDiscountCodeActive(id, active);
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : 'No se pudo actualizar el código'
    });
  }
}

export async function validateDiscountCode(req: Request, res: Response) {
  try {
    const payload = quoteDiscountCodeSchema.parse(req.body);
    const data = databaseEnabled
      ? await quoteDatabaseDiscountCode(payload)
      : store.quoteDiscountCode(payload.code, payload.email, payload.branchId, payload.items);
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error instanceof z.ZodError
        ? 'Código no válido'
        : error instanceof Error
          ? error.message
          : 'No se pudo validar el código'
    });
  }
}
