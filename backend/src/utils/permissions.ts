import type { Role } from '../domain.js';

export const ROLES: readonly Role[] = [
  'Administrador',
  'Gerente',
  'Cajero',
  'Bodeguero',
  'Repartidor',
  'Proveedor'
];

export const ADMIN_ROLES: Role[] = ['Administrador', 'Gerente'];

export const POS_ROLES: Role[] = ['Administrador', 'Gerente', 'Cajero'];

export const WAREHOUSE_ROLES: Role[] = ['Administrador', 'Gerente', 'Bodeguero'];

export const DELIVERY_ROLES: Role[] = ['Administrador', 'Gerente', 'Repartidor'];

export const ORDER_READ_ROLES: Role[] = [
  'Administrador',
  'Gerente',
  'Cajero',
  'Bodeguero',
  'Repartidor'
];

export const ACCESS_DENIED_MESSAGE = 'Acceso denegado. No tienes permisos para acceder a esta sección.';

export const FORBIDDEN_MESSAGE = 'No tiene permisos para esta acción';

export function hasAnyRole(role: Role | null | undefined, allowed: readonly Role[]): boolean {
  return typeof role === 'string' && allowed.includes(role);
}

export function isSupervisorRole(role: Role | null | undefined): boolean {
  return role === 'Administrador' || role === 'Gerente';
}

export function isDeliveryRole(role: Role | null | undefined): boolean {
  return hasAnyRole(role, DELIVERY_ROLES);
}

export function canGrantRole(actorRole: Role, targetRole: Role): boolean {
  if (actorRole === 'Administrador') return targetRole !== 'Administrador';
  if (actorRole === 'Gerente') return targetRole !== 'Administrador';
  return false;
}

export function canManageEmployee(actorRole: Role, targetRole: Role): boolean {
  if (actorRole === 'Administrador') return true;
  if (actorRole === 'Gerente') return targetRole !== 'Administrador';
  return false;
}

export interface DeliveryOwnership {
  branchId: number | null;
  assignedEmployeeId?: number | null;
}

export interface DeliveryActor {
  employeeId: number;
  role: Role;
  branchId: number | null;
}

export function canReadDelivery(actor: DeliveryActor, delivery: DeliveryOwnership): boolean {
  if (isSupervisorRole(actor.role)) return true;
  if (actor.role !== 'Repartidor') return false;
  return delivery.assignedEmployeeId != null && delivery.assignedEmployeeId === actor.employeeId;
}

export function canUpdateDelivery(actor: DeliveryActor, delivery: DeliveryOwnership): boolean {
  return canReadDelivery(actor, delivery);
}

export function canClaimDelivery(actor: DeliveryActor, delivery: DeliveryOwnership): boolean {
  if (actor.role !== 'Repartidor') return false;
  if (delivery.assignedEmployeeId != null) return false;
  return delivery.branchId != null && actor.branchId != null && delivery.branchId === actor.branchId;
}

export function resolveBranchScope(actorBranchId: number | null, requestedBranchId: number | null): number | null {
  if (actorBranchId != null) return actorBranchId;
  return requestedBranchId;
}