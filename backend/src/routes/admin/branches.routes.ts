import { Router } from 'express';
import { branches, createBranch, deleteBranch, updateBranch } from '../../controllers/admin.controller.js';
import { authorize } from '../../middleware/auth.js';
import { ADMIN_ROLES } from '../../utils/permissions.js';

export const branchesRouter = Router();

branchesRouter.use(authorize(...ADMIN_ROLES));
branchesRouter.get('/branches', branches);
branchesRouter.post('/branches', createBranch);
branchesRouter.put('/branches/:id', updateBranch);
branchesRouter.delete('/branches/:id', deleteBranch);