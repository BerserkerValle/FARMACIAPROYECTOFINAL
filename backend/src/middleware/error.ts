/**
 * ============================================================================
 * PROYECTO FARMACIA - MIDDLEWARES GLOBALES DE MANEJO DE ERRORES
 * ============================================================================
 * Este archivo centraliza la captura de rutas no encontradas (404) y excepciones
 * no controladas o errores arrojados en los controladores (400 / 500).
 *
 * MÉTODOS Y PATRONES:
 * - Middleware 404 Catch-All para rutas inexistentes.
 * - Middleware de error de 4 parámetros de Express (err, req, res, next)
 *   que garantiza que la API siempre devuelva un JSON estructurado y nunca se caiga.
 * ============================================================================
 */

import type { NextFunction, Request, Response } from 'express';

// ============================================================================
// MANEJADOR DE RUTA NO ENCONTRADA (HTTP 404)
// ============================================================================

/**
 * Middleware que intercepta cualquier petición a rutas o verbos HTTP no registrados.
 * 
 * ¿CÓMO FUNCIONA?
 * Se registra al final de la cadena de rutas en Express (`app.use(notFound)`).
 * Si ninguna ruta coincidió previamente, este manejador toma el control y devuelve
 * una respuesta JSON con código 404 indicando el método y la URL solicitada.
 *
 * @param {Request} req Objeto de petición HTTP.
 * @param {Response} res Objeto de respuesta HTTP.
 */
export function notFound(req: Request, res: Response) {
  res.status(404).json({ 
    success: false, 
    message: `Ruta no encontrada: ${req.method} ${req.originalUrl}` 
  });
}

// ============================================================================
// MANEJADOR GLOBAL DE EXCEPCIONES Y ERRORES DE APLICACIÓN (HTTP 400)
// ============================================================================

/**
 * Middleware global de captura de errores para Express.
 * 
 * ¿CÓMO FUNCIONA?
 * Cuando cualquier controlador invoca `next(error)` o arroja una excepción no capturada,
 * Express redirige inmediatamente la ejecución a este middleware debido a su firma
 * de 4 parámetros: (error, req, res, next).
 * 
 * Extrae el mensaje de la instancia de `Error` y devuelve una respuesta HTTP uniforme,
 * impidiendo fugas de trazas internas al cliente y manteniendo la estabilidad del servidor.
 *
 * @param {unknown} error Excepción o error interceptado.
 * @param {Request} _req Objeto de petición HTTP.
 * @param {Response} res Objeto de respuesta HTTP.
 * @param {NextFunction} _next Función de transferencia de middleware.
 */
export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  const message = error instanceof Error ? error.message : 'Error interno';
  res.status(400).json({ 
    success: false, 
    message 
  });
}
