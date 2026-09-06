import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { login, me } from '../controllers/auth.controller.js';

export const authRouter = Router();

authRouter.post('/login', login);
authRouter.get('/me', authenticate, me);
