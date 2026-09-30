import type { NextFunction, Request, Response } from 'express';

export function notFound(req: Request, res: Response) {
  res.status(404).json({ success: false, message: `Ruta no encontrada: ${req.method} ${req.originalUrl}` });
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  const message = error instanceof Error ? error.message : 'Error interno del servidor';
  console.error(error);
  res.status(500).json({ success: false, message });
}
