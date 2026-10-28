import { describe, expect, it } from 'vitest';
import { getAvailableEmployeeStations } from '../utils/employeeStations.js';

describe('employee station assignments', () => {
  const employees = [
    { id: 1, role: 'Cajero', branchId: 1, stationNumber: 1, active: true },
    { id: 2, role: 'Cajero', branchId: 1, stationNumber: 2, active: true },
    { id: 3, role: 'Repartidor', branchId: 1, stationNumber: 1, active: true },
    { id: 4, role: 'Cajero', branchId: 2, stationNumber: 1, active: true },
    { id: 5, role: 'Cajero', branchId: 1, stationNumber: 3, active: false }
  ] as const;

  it('offers only free stations for the same role and branch', () => {
    expect(getAvailableEmployeeStations(employees, 'Cajero', 1)).toEqual([3, 4, 5, 6, 7]);
    expect(getAvailableEmployeeStations(employees, 'Repartidor', 1)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(getAvailableEmployeeStations(employees, 'Cajero', 2)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it('includes the employee current station when editing them', () => {
    expect(getAvailableEmployeeStations(employees, 'Cajero', 1, 1)).toEqual([1, 3, 4, 5, 6, 7]);
  });

  it('reserves all seven stations without offering an eighth', () => {
    const fullShift = Array.from({ length: 7 }, (_, index) => ({
      id: index + 10,
      role: 'Cajero',
      branchId: 3,
      stationNumber: index + 1,
      active: true
    }));
    expect(getAvailableEmployeeStations(fullShift, 'Cajero', 3)).toEqual([]);
  });

  it('offers no stations for roles without station assignments', () => {
    expect(getAvailableEmployeeStations(employees, 'Bodeguero', 1)).toEqual([]);
  });
});
