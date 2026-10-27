import type { Branch } from '../types';

const knownBranchAddresses = {
  jocotenango: 'Calle Ricardo Arjona, Finca Lizardi, Zona 4, Centro Comercial Plaza Jocotenango, Jocotenango, Sacatepéquez, 03002',
  antigua: 'Finca Las Victorias, Kilómetro 46, Carretera a Ciudad Vieja, Antigua Guatemala, Sacatepéquez, 03001',
  pastores: 'Calle Real de Pastores 2-12, Zona 6, Pastores, Sacatepéquez, 03003'
};

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

export function getDeliveryOrigin(branch: Branch): string | null {
  const name = normalize(`${branch.name} ${branch.city}`);
  if (name.includes('jocotenango')) return knownBranchAddresses.jocotenango;
  if (name.includes('antigua')) return knownBranchAddresses.antigua;
  if (name.includes('pastores') || name.includes('ciudad vieja')) return knownBranchAddresses.pastores;
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
