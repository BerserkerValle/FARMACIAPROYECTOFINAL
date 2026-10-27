import type { Portal } from '../types';

const PORTALS_BY_ROLE: Record<string, Portal[]> = {
  cajero: ['public', 'pos'],
  bodeguero: ['warehouse'],
  repartidor: ['delivery'],
  gerente: ['public', 'pos', 'warehouse', 'delivery', 'admin'],
  administrador: ['public', 'pos', 'warehouse', 'delivery', 'admin']
};

function normalizeRole(role: string): string {
  return role
    .trim()
    .replace(/\s/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function getAllowedPortals(role: string | null): Portal[] {
  if (!role) return [];
  const portals = PORTALS_BY_ROLE[normalizeRole(role)];
  return Array.isArray(portals) ? portals : [];
}

export function getDefaultPortal(role: string | null): Portal | null {
  const normalizedRole = role ? normalizeRole(role) : '';
  if (normalizedRole === 'administrador' || normalizedRole === 'gerente') return 'admin';
  if (normalizedRole === 'cajero') return 'pos';
  if (normalizedRole === 'bodeguero') return 'warehouse';
  if (normalizedRole === 'repartidor') return 'delivery';
  return null;
}
