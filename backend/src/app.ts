import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { adminRouter } from './routes/admin.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { posRouter } from './routes/pos.routes.js';
import { publicRouter } from './routes/public.routes.js';
import { warehouseRouter } from './routes/warehouse.routes.js';
import { errorHandler, notFound } from './middleware/error.js';
import { getUploadsDir } from './utils.js';
import { databaseHealth } from './db.js';
import { store } from './store.js';
import { stripeWebhook } from './controllers/public.controller.js';

dotenv.config();

const app = express();
const uploadsDir = getUploadsDir();

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(cors({ origin: true, credentials: true }));
app.use(morgan('dev'));
app.use('/uploads', express.static(uploadsDir));
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhook);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/health', async (_req, res, next) => {
  try {
    res.json({ success: true, service: 'derkas-farmacia-api', status: 'ok', persistence: store.getPersistenceMode(), database: await databaseHealth() });
  } catch (error) {
    next(error);
  }
});

app.use('/api/auth', authRouter);
app.use('/api/public', publicRouter);
app.use('/api/pos', posRouter);
app.use('/api/warehouse', warehouseRouter);
app.use('/api/admin', adminRouter);

app.use(notFound);
app.use(errorHandler);

export default app;
