import { describe, expect, it } from 'vitest';
import { resolveOperationalBranchScope } from '../utils/permissions.js';

describe('resolveOperationalBranchScope', () => {
  it.each(['Administrador', 'Gerente', 'Cajero', 'Bodeguero'])(
    '%s can select a branch different from their assigned branch',
    (role) => {
      expect(resolveOperationalBranchScope(role, 1, 4)).toBe(4);
    }
  );

  it('uses the assigned branch when no branch is selected', () => {
    expect(resolveOperationalBranchScope('Bodeguero', 2, null)).toBe(2);
    expect(resolveOperationalBranchScope('Cajero', 3, null)).toBe(3);
  });

  it('keeps branch restrictions for roles outside warehouse and POS operations', () => {
    expect(resolveOperationalBranchScope('Repartidor', 2, 4)).toBe(2);
  });
});
