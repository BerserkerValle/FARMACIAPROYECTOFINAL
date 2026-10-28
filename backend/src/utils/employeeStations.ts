import type { Role } from '../domain.js';

export const EMPLOYEE_STATION_NUMBERS = [1, 2, 3, 4, 5, 6, 7] as const;

export type EmployeeStationAssignment = {
  id: number;
  role: Role | string;
  branchId: number | null;
  stationNumber?: number | null;
  active: boolean;
};

export function requiresEmployeeStation(role: Role | string): role is 'Cajero' | 'Repartidor' {
  return role === 'Cajero' || role === 'Repartidor';
}

export function getAvailableEmployeeStations(
  employees: readonly EmployeeStationAssignment[],
  role: Role | string,
  branchId: number | null,
  excludeEmployeeId?: number
) {
  if (!requiresEmployeeStation(role) || branchId == null) return [];
  const occupied = new Set(
    employees
      .filter((employee) =>
        employee.active
        && employee.id !== excludeEmployeeId
        && employee.role === role
        && employee.branchId === branchId
        && employee.stationNumber != null
      )
      .map((employee) => employee.stationNumber)
  );
  return EMPLOYEE_STATION_NUMBERS
    .map((stationNumber): number => stationNumber)
    .filter((stationNumber) => !occupied.has(stationNumber));
}
