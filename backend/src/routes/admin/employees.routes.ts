import { Router } from 'express';
import { createEmployee, deleteEmployee, employees, updateEmployee } from '../../controllers/admin.controller.js';

export const employeesRouter = Router();

employeesRouter.get('/employees', employees);
employeesRouter.post('/employees', createEmployee);
employeesRouter.put('/employees/:id', updateEmployee);
employeesRouter.delete('/employees/:id', deleteEmployee);