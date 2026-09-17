import { Router } from 'express';
import { branches, createBranch, deleteBranch, updateBranch } from '../../controllers/admin.controller.js';

export const branchesRouter = Router();

branchesRouter.get('/branches', branches);
branchesRouter.post('/branches', createBranch);
branchesRouter.put('/branches/:id', updateBranch);
branchesRouter.delete('/branches/:id', deleteBranch);