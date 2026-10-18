import type { DiscountCode, DiscountRedemption } from './domain.js';

export function calculateDiscountAmount(subtotal: number, type: DiscountCode['type'], value: number): number {
  const amount = type === 'PERCENTAGE' ? subtotal * value / 100 : value;
  const roundedAmount = Math.min(subtotal, Math.round((amount + Number.EPSILON) * 100) / 100);
  if (roundedAmount >= subtotal) {
    throw new Error('El descuento no puede cubrir el total completo de la compra');
  }
  return roundedAmount;
}

export function assertDiscountCodeUsable(
  discount: DiscountCode,
  email: string,
  redemptions: DiscountRedemption[],
  now = new Date()
) {
  if (!discount.active) throw new Error('El código de descuento está inactivo');
  if (discount.startsAt && new Date(discount.startsAt) > now) throw new Error('El código de descuento todavía no está vigente');
  if (discount.expiresAt && new Date(discount.expiresAt) <= now) throw new Error('El código de descuento venció');

  const activeRedemptions = redemptions.filter((redemption) =>
    redemption.discountCodeId === discount.id &&
    (redemption.status === 'RESERVED' || redemption.status === 'REDEEMED')
  );
  if (activeRedemptions.length >= discount.maxUses) throw new Error('El código alcanzó su límite de usos');
  if (activeRedemptions.some((redemption) => redemption.customerEmail.toLowerCase() === email.trim().toLowerCase())) {
    throw new Error('Este código ya fue utilizado por este correo');
  }
}
