import type { Role } from '../domain.js';

declare global {
  namespace Express {
    interface Request {
      user?: {
        employeeId: number;
        role: Role;
        branchId: number | null;
        fullName: string;
        email: string;
      };
    }
  }
}

export {};
