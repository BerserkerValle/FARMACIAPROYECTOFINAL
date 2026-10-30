import { describe, expect, it } from 'vitest';
import { ADMIN_ROLES, canAccessBranch, canGrantRole, canManageEmployee, canReadDelivery, canClaimDelivery, resolveBranchScope, resolveWarehouseBranchScope } from '../utils/permissions.js';
import { getNextEmployeeId, getUniqueActiveEmployeeById } from '../store.js';
import { createEmployeeToken, getEmployeeIdentityFromToken } from '../utils/jwt.js';
import { guatemalaPhoneSchema, hasSanitaryRegistryChanged } from '../utils.js';

const employee = (id: number, email: string) => ({
  id,
  email,
  fullName: email,
  password: 'hash',
  role: 'Bodeguero' as const,
  branchId: 1,
  supervisorId: null,
  active: true
});

describe('warehouse branch scope', () => {
  it('lets warehouse staff read and receive stock at the selected branch', () => {
    expect(resolveWarehouseBranchScope('Bodeguero', 1, 3)).toBe(3);
  });

  it('uses the assigned branch when warehouse staff did not select one', () => {
    expect(resolveWarehouseBranchScope('Bodeguero', 2, null)).toBe(2);
  });

  it('preserves the assigned branch restriction for other staff roles', () => {
    expect(resolveWarehouseBranchScope('Cajero', 2, 3)).toBe(2);
    expect(resolveBranchScope('Cajero', 2, 3)).toBe(2);
    expect(resolveBranchScope('Repartidor', 2, 3)).toBe(2);
  });

  it('does not let cashiers or delivery staff without an assigned branch choose one', () => {
    expect(resolveBranchScope('Cajero', null, 3)).toBeNull();
    expect(resolveBranchScope('Repartidor', null, 3)).toBeNull();
  });

  it('keeps supervisors able to use the requested branch', () => {
    expect(resolveWarehouseBranchScope('Gerente', 1, 3)).toBe(1);
    expect(resolveBranchScope('Administrador', 1, 3)).toBe(3);
    expect(resolveBranchScope('Administrador', null, null)).toBeNull();
    expect(resolveBranchScope('Gerente', 1, 3)).toBe(1);
  });

  it('lets managers access only their assigned branch while administrators remain global', () => {
    expect(canAccessBranch('Administrador', null, 3)).toBe(true);
    expect(canAccessBranch('Gerente', 2, 2)).toBe(true);
    expect(canAccessBranch('Gerente', 2, 3)).toBe(false);
    expect(canAccessBranch('Gerente', null, 2)).toBe(false);
  });
});

describe('employee role assignment', () => {
  it('allows managers to enter the administrative panel without granting administrator access', () => {
    expect(ADMIN_ROLES).toContain('Gerente');
    expect(ADMIN_ROLES).not.toContain('Cajero');
    expect(ADMIN_ROLES).not.toContain('Bodeguero');
  });

  it('lets an administrator grant every role, including administrator and manager', () => {
    expect(canGrantRole('Administrador', 'Administrador')).toBe(true);
    expect(canGrantRole('Administrador', 'Gerente')).toBe(true);
  });

  it('does not let a manager grant the administrator role', () => {
    expect(canGrantRole('Gerente', 'Administrador')).toBe(false);
    expect(canGrantRole('Gerente', 'Gerente')).toBe(true);
  });

  it('lets managers manage employees only within their branch', () => {
    expect(canManageEmployee('Gerente', 'Cajero')).toBe(true);
    expect(canManageEmployee('Gerente', 'Administrador')).toBe(false);
    expect(canAccessBranch('Gerente', 2, 2)).toBe(true);
    expect(canAccessBranch('Gerente', 2, 3)).toBe(false);
  });
});

describe('employee identity in local storage', () => {
  it('does not resolve an ambiguous employee ID to another employee', () => {
    const employees = [employee(1, 'admin@example.com'), employee(1, 'warehouse@example.com')];
    expect(getUniqueActiveEmployeeById(employees, 1)).toBeNull();
  });

  it('allocates new employee IDs above the highest existing ID', () => {
    expect(getNextEmployeeId(1, [employee(1, 'admin@example.com'), employee(4, 'warehouse@example.com')])).toBe(5);
  });

  it('keeps the employee email in new session tokens to resolve colliding local IDs safely', () => {
    const token = createEmployeeToken(1, 'Warehouse@Example.com');
    expect(getEmployeeIdentityFromToken(token)).toEqual({
      employeeId: 1,
      email: 'warehouse@example.com'
    });
  });
});

describe('Guatemalan phone number validation', () => {
  const phoneSchema = guatemalaPhoneSchema();

  it('accepts exactly eight numeric digits', () => {
    expect(phoneSchema.safeParse('42501265').success).toBe(true);
  });

  it.each(['4250126', '425012650', '4250-1265', '4250abcd'])('rejects invalid phone number %s', (phone) => {
    expect(phoneSchema.safeParse(phone).success).toBe(false);
  });
});

describe('delivery visibility and claiming', () => {
  const rider = { employeeId: 7, role: 'Repartidor' as const, branchId: 1 };

  it('shows unassigned deliveries from the rider branch', () => {
    const unassigned = { branchId: 1, assignedEmployeeId: null };
    expect(canReadDelivery(rider, unassigned)).toBe(true);
    expect(canClaimDelivery(rider, unassigned)).toBe(true);
  });

  it('keeps deliveries assigned to another rider private', () => {
    expect(canReadDelivery(rider, { branchId: 1, assignedEmployeeId: 8 })).toBe(false);
  });

  it('does not expose unassigned deliveries from a different branch', () => {
    const otherBranch = { branchId: 2, assignedEmployeeId: null };
    expect(canReadDelivery(rider, otherBranch)).toBe(false);
    expect(canClaimDelivery(rider, otherBranch)).toBe(false);
  });
});

describe('sanitary registry validation', () => {
  it('allows editing a product when its unchanged registry is shared by legacy products', () => {
    expect(hasSanitaryRegistryChanged('MSPAS-TEST', 'MSPAS-TEST')).toBe(false);
  });

  it('still checks uniqueness when a registry is changed', () => {
    expect(hasSanitaryRegistryChanged('MSPAS-TEST', 'MSPAS-NEW')).toBe(true);
  });
});
