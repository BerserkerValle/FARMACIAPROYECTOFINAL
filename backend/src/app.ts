/**
 * ============================================================================
 * PROYECTO FARMACIA - CONFIGURACIÓN DE LA APLICACIÓN EXPRESS
 * ============================================================================
 * Este archivo configura la tubería (pipeline) de middlewares y el enrutador
 * principal del servidor Express:
 * 1. Seguridad:
 *    - Helmet: Encabezados HTTP seguros (Cross-Origin Resource Policy).
 *    - CORS: Permite peticiones cruzadas desde el cliente frontend web.
 * 2. Registro y Diagnóstico:
 *    - Morgan: Registro de peticiones HTTP en consola en formato 'dev'.
 *    - Endpoint de salud (`/health`): Estado de la API y de PostgreSQL.
 * 3. Procesamiento de Cargas Útiles:
 *    - Webhooks de Stripe con `express.raw({ type: 'application/json' })` para validación de firma criptográfica.
 *    - Parseo de cuerpos JSON (`express.json({ limit: '10mb' })`) y URL-encoded.
 *    - Directorio estático (`/uploads`) para imágenes de medicamentos y recetas.
 * 4. Enrutamiento Modular:
 *    - `/api/auth`: Autenticación de empleados y clientes.
 *    - `/api/public`: Catálogo, checkout y seguimiento para clientes.
 *    - `/api/pos`: Ventas de mostrador y despacho motorizado.
 *    - `/api/warehouse`: Lotes, existencias y recepción de insumos.
 *    - `/api/admin`: Dashboard, reportes y CRUDs maestros.
 * 5. Manejo Centralizado de Errores (404 Not Found y Error Handler).
 * ============================================================================
 */

import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { rutasAdministracion, rutasAutenticacion, rutasBodega, rutasPublicas, rutasVentas } from './rutas/index.js';
import { errorHandler, notFound } from './middleware/error.js';
import { getUploadsDir } from './utils.js';
import { databaseHealth } from './db.js';
import { store } from './store.js';
import { stripeWebhook } from './controllers/public.controller.js';

// Carga las variables de entorno desde el archivo .env
dotenv.config();

const app = express();
const uploadsDir = getUploadsDir();

// ============================================================================
// MIDDLEWARES DE SEGURIDAD Y AUDITORÍA
// ============================================================================

// Protección de cabeceras HTTP con soporte de recursos cruzados para imágenes
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// Habilitación de CORS para permitir solicitudes del frontend (Vite/React)
app.use(cors({ origin: true, credentials: true }));

// Logger HTTP en consola para desarrollo
app.use(morgan('dev'));

// Servicio de archivos estáticos (imágenes de catálogo y recetas médicas)
app.use('/uploads', express.static(uploadsDir));

// ============================================================================
// WEBHOOKS Y PARSEO DE CUERPOS DE PETICIÓN
// ============================================================================

// El webhook de Stripe debe procesarse en formato crudo (raw buffer) para validar la firma digital
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhook);

// Parseo de solicitudes estándar en formato JSON (hasta 10MB) y URL encoded
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Previene el almacenamiento en caché de navegadores en respuestas de la API
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// ============================================================================
// ENDPOINT DE MONITOREO Y SALUD (HEALTH CHECK)
// ============================================================================

app.get('/health', async (_req, res, next) => {
  try {
    res.json({ 
      success: true, 
      service: 'derkas-farmacia-api', 
      status: 'ok', 
      persistence: store.getPersistenceMode(), 
      database: await databaseHealth() 
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// REGISTRO DE MÓDULOS DE RUTAS
// ============================================================================

app.use('/api/auth', rutasAutenticacion);
app.use('/api/public', rutasPublicas);
app.use('/api/pos', rutasVentas);
app.use('/api/warehouse', rutasBodega);
app.use('/api/admin', rutasAdministracion);

// ============================================================================
// CAPTURA Y MANEJO DE EXCEPCIONES
// ============================================================================

app.use(notFound);
app.use(errorHandler);

export default app;
