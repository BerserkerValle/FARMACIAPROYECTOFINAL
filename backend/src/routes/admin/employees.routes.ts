import { Router } from 'express';
import { createEmployee, customerAccounts, deleteCustomerAccount, deleteEmployee, employees, updateEmployee } from '../../controllers/admin.controller.js';
import { authorize } from '../../middleware/auth.js';
import { ADMIN_ROLES } from '../../utils/permissions.js';

export const employeesRouter = Router();

employeesRouter.use(authorize(...ADMIN_ROLES));
employeesRouter.get('/employees', employees);
employeesRouter.post('/employees', createEmployee);
employeesRouter.put('/employees/:id', updateEmployee);
employeesRouter.delete('/employees/:id', deleteEmployee);
employeesRouter.get('/customers', customerAccounts);
employeesRouter.delete('/customers/:id', deleteCustomerAccount);