import type { Branch } from '../types';

const knownBranchAddresses = {
  jocotenango: 'H7F6+JG3, C. Ricardo Arjona, Antigua Guatemala, Sacatepéquez, Guatemala',
  antigua: 'G7X4+RJ, Antigua Guatemala, Sacatepéquez, Guatemala',
  pastores: 'H6VW+HJF, Pastores, Sacatepéquez, Guatemala'
};

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

export function getDeliveryOrigin(branch: Branch): string | null {
  const name = normalize(`${branch.name} ${branch.city}`);
  if (name.includes('jocotenango')) return knownBranchAddresses.jocotenango;
  if (name.includes('antigua')) return knownBranchAddresses.antigua;
  if (name.includes('pastores')) return knownBranchAddresses.pastores;
  return branch.address.trim() || null;
}

export function getGoogleDirectionsUrl(origin: string, destination: string): string {
  const params = new URLSearchParams({
    api: '1',
    origin,
    destination,
    travelmode: 'driving'
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
