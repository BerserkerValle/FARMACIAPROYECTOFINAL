import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { rutasAdministracion, rutasAutenticacion, rutasBodega, rutasPublicas, rutasVentas } from './rutas/index.js';
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
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.get('/health', async (_req, res, next) => {
  try {
    res.json({ success: true, service: 'derkas-farmacia-api', status: 'ok', persistence: store.getPersistenceMode(), database: await databaseHealth() });
  } catch (error) {
    next(error);
  }
});

app.use('/api/auth', rutasAutenticacion);
app.use('/api/public', rutasPublicas);
app.use('/api/pos', rutasVentas);
app.use('/api/warehouse', rutasBodega);
app.use('/api/admin', rutasAdministracion);

app.use(notFound);
app.use(errorHandler);

export default app;
