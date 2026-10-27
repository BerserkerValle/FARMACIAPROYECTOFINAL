import type { Portal } from '../types';

const portalsByRole: Record<string, readonly Portal[]> = {
  Administrador: ['public', 'pos', 'warehouse', 'delivery', 'admin'],
  Gerente: ['public', 'pos', 'warehouse', 'delivery', 'admin'],
  Cajero: ['public', 'pos'],
  Bodeguero: ['warehouse'],
  Repartidor: ['delivery']
};

const homePortalByRole: Record<string, Portal> = {
  Administrador: 'admin',
  Gerente: 'admin',
  Cajero: 'pos',
  Bodeguero: 'warehouse',
  Repartidor: 'delivery'
};

export function getEmployeePortals(role: string): readonly Portal[] {
  return portalsByRole[role] ?? [];
}

export function getEmployeeHomePortal(role: string): Portal {
  return homePortalByRole[role] ?? 'public';
}

export function canAccessEmployeePortal(role: string, portal: Portal): boolean {
  return getEmployeePortals(role).includes(portal);
}
