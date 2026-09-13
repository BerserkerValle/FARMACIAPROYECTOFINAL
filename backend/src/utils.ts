/**
 * ============================================================================
 * PROYECTO FARMACIA - UTILIDADES DEL SERVIDOR BACKEND
 * ============================================================================
 * Este módulo contiene funciones auxiliares y utilitarias compartidas por
 * los controladores y middlewares de la aplicación:
 * - Localización y creación del directorio de subida de archivos (recetas, imágenes).
 * - Estandarización de respuestas JSON de éxito y error.
 * - Parseo y validación segura de parámetros numéricos.
 * - Construcción de URLs públicas.
 * - Obtención de claves secretas del entorno (Stripe).
 * ============================================================================
 */

import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// ============================================================================
// GESTIÓN DEL SISTEMA DE ARCHIVOS Y CARPETA DE SUBIDAS
// ============================================================================

/**
 * Obtiene la ruta absoluta del directorio de subidas (`uploads`).
 * 
 * ¿CÓMO FUNCIONA?
 * 1. Primero verifica si existe una variable de entorno `UPLOADS_DIR`.
 * 2. Si no está configurada, detecta el directorio de trabajo actual (`process.cwd()`).
 * 3. Si el proceso se ejecuta desde la carpeta `backend`, usa `uploads`.
 * 4. Si se ejecuta desde la raíz del proyecto monorepo, usa `backend/uploads`.
 * 5. Si la carpeta física no existe, la crea de forma recursiva con `mkdirSync`.
 *
 * @returns {string} Ruta absoluta a la carpeta de uploads.
 */
export function getUploadsDir(): string {
  const configuredUploadsDir = process.env.UPLOADS_DIR?.trim();
  if (configuredUploadsDir) {
    if (!existsSync(configuredUploadsDir)) {
      mkdirSync(configuredUploadsDir, { recursive: true });
    }
    return configuredUploadsDir;
  }

  const cwd = process.cwd();
  // Asegura la consistencia del directorio independientemente de dónde se invoque npm run
  const uploadsDir = cwd.endsWith('backend') ? resolve(cwd, 'uploads') : resolve(cwd, 'backend', 'uploads');
  if (!existsSync(uploadsDir)) {
    mkdirSync(uploadsDir, { recursive: true });
  }
  return uploadsDir;
}

// ============================================================================
// FORMATEADORES DE RESPUESTAS JSON ESTÁNDAR
// ============================================================================

/**
 * Genera un objeto de respuesta exitosa estandarizado para la API.
 * 
 * @template T Tipo de los datos devueltos en la propiedad `data`.
 * @param {true} success Siempre true para indicar éxito.
 * @param {T} data Datos o carga útil a devolver al cliente.
 * @returns {{ success: true, data: T }} Objeto con contrato estándar de la API.
 */
export function jsonOk<T>(success: true, data: T) {
  return { success, data };
}

/**
 * Genera un objeto de error estandarizado para las respuestas de la API.
 * 
 * @param {string} message Mensaje descriptivo del error en español.
 * @param {unknown} [details] Información técnica adicional o errores de validación.
 * @returns {{ success: false, message: string, details?: unknown }}
 */
export function jsonError(message: string, details?: unknown) {
  return { success: false, message, details };
}

// ============================================================================
// UTILIDADES DE CONVERSIÓN Y VALIDACIÓN
// ============================================================================

/**
 * Parsea un parámetro de cadena a número entero o flotante finito.
 * Evita inyecciones de valores `NaN`, cadenas corruptas o parámetros indefinidos.
 * 
 * @param {string | undefined} value Cadena proveniente de req.params o req.query.
 * @returns {number | null} Número válido o null si la entrada no es un número finito.
 */
export function parseNumericParam(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Construye una URL pública completa concatenando la ruta con la URL base de la aplicación.
 * 
 * @param {string} pathname Ruta relativa (ej: '/tracking/ORD-12345').
 * @returns {string} URL absoluta resultante.
 */
export function buildPublicUrl(pathname: string): string {
  const baseUrl = process.env.APP_BASE_URL ?? 'http://localhost:5173';
  return new URL(pathname, baseUrl).toString();
}

/**
 * Obtiene de manera segura la clave secreta de Stripe desde las variables de entorno.
 * Si no está configurada, retorna una cadena vacía en lugar de undefined para evitar excepciones.
 * 
 * @returns {string} Clave secreta de Stripe o cadena vacía.
 */
export function safeStripeKey(): string {
  return process.env.STRIPE_SECRET_KEY?.trim() ?? '';
}
