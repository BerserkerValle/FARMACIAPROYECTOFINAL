import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export function getUploadsDir() {
  const cwd = process.cwd();
  // If running from backend folder or root folder, ensure consistent uploads dir
  const uploadsDir = cwd.endsWith('backend') ? resolve(cwd, 'uploads') : resolve(cwd, 'backend', 'uploads');
  if (!existsSync(uploadsDir)) {
    mkdirSync(uploadsDir, { recursive: true });
  }
  return uploadsDir;
}

export function jsonOk<T>(success: true, data: T) {
  return { success, data };
}

export function jsonError(message: string, details?: unknown) {
  return { success: false, message, details };
}

export function parseNumericParam(value: string | undefined) {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildPublicUrl(pathname: string) {
  const baseUrl = process.env.APP_BASE_URL ?? 'http://localhost:5173';
  return new URL(pathname, baseUrl).toString();
}

export function safeStripeKey() {
  return process.env.STRIPE_SECRET_KEY?.trim() ?? '';
}

