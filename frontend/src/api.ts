/**
 * ============================================================================
 * PROYECTO FARMACIA - CLIENTE DE COMUNICACIÓN HTTP CON LA API REST (FETCH)
 * ============================================================================
 * Este módulo centraliza todas las llamadas de red entre el frontend y el backend:
 * 1. Normalización dinámica de la URL del servidor API (`API_URL`):
 *    - Detección de variable de entorno `VITE_API_URL`.
 *    - Fallback a localhost (puerto 4000) en entorno de desarrollo.
 *    - Fallback a la URL pública de producción en Render.
 * 2. Cliente genérico tipado `apiRequest<T>`:
 *    - Inyección automática del header de autenticación `X-Employee-Id`.
 *    - Asignación de cabecera `Content-Type: application/json` cuando no es FormData.
 *    - Desactivación de caché del navegador (`cache: 'no-store'`) para datos en tiempo real.
 *    - Transformación y control de excepciones JSON.
 * 3. Manejo de Cargas Multimedia (Multipart / FormData):
 *    - `uploadPrescription`: Receta médica vinculada a una orden existente.
 *    - `uploadTemporaryPrescription`: Receta temporal previa al checkout.
 *    - `uploadProductImage`: Fotografía de medicamento para catálogo de bodega.
 * ============================================================================
 */

/**
 * Limpia y normaliza la URL de la API asegurando protocolo y eliminando diagonales finales.
 * 
 * @param {string | undefined} value URL configurada en el entorno.
 * @returns {string} URL formateada (ej: 'https://farmaciaproyectofinalweb.onrender.com').
 */
function normalizeApiUrl(value: string | undefined): string {
  const url = value?.trim();
  if (!url) return '';
  const withProtocol = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  return withProtocol.endsWith('/') ? withProtocol.slice(0, -1) : withProtocol;
}

/** URL base del backend resuelta para el entorno actual */
export const API_URL = normalizeApiUrl(import.meta.env.VITE_API_URL) ||
  (import.meta.env.DEV ? 'http://localhost:4000' : 'https://farmaciaproyectofinalweb.onrender.com');

// ============================================================================
// CLIENTE HTTP PRINCIPAL (FETCH API GENÉRICA)
// ============================================================================

/**
 * Ejecuta una petición HTTP genérica hacia los endpoints de la API.
 * 
 * ¿CÓMO FUNCIONA?
 * 1. Clona o inicializa los encabezados (`Headers`).
 * 2. Si se proporciona `token` (ID de sesión del empleado), agrega el header `X-Employee-Id`.
 * 3. Si el cuerpo de la petición no es un `FormData`, define `Content-Type: application/json`.
 * 4. Ejecuta `fetch` con la opción `cache: 'no-store'` para evitar respuestas desactualizadas.
 * 5. Parsea la respuesta JSON y evalúa `payload.success`. Si es false, arroja un `Error`.
 * 6. Retorna la propiedad `payload.data` fuertemente tipada como `T`.
 *
 * @template T Tipo de retorno esperado en `payload.data`.
 * @param {string} path Ruta relativa del endpoint (ej: '/api/public/catalog').
 * @param {RequestInit} [options={}] Opciones estándar de la Fetch API (método, body, etc.).
 * @param {string | null} [token] Token de sesión del empleado (ID numérico).
 * @returns {Promise<T>} Promesa con los datos devueltos por el backend.
 */
export async function apiRequest<T>(path: string, options: RequestInit = {}, token?: string | null): Promise<T> {
  const headers = new Headers(options.headers ?? {});
  
  if (token) {
    headers.set('X-Employee-Id', token);
  }
  
  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      cache: 'no-store',
      headers
    });
  } catch {
    throw new Error(
      API_URL
        ? `No se pudo conectar con la API en ${API_URL}. Revisa que el backend esté activo y que VITE_API_URL sea correcto.`
        : 'La API no está configurada. Define VITE_API_URL en las variables del frontend y vuelve a desplegar.'
    );
  }

  const payload = await response.json().catch(() => ({ success: false, message: 'Respuesta inválida' }));
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || 'No se pudo completar la operación');
  }
  return payload.data as T;
}

// ============================================================================
// FUNCIONES DE SUBIDA MULTIMEDIA (RECETAS MÉDICAS E IMÁGENES)
// ============================================================================

/**
 * Sube un archivo de receta médica y la asocia a una orden existente.
 * Envía un formulario multipart/form-data al endpoint `/api/public/orders/prescription`.
 *
 * @param {File} file Archivo físico seleccionado por el usuario (JPG, PNG o PDF).
 * @param {number} orderId Identificador de la orden.
 * @param {'web' | 'delivery'} kind Tipo de receta (cargada en web o validada en entrega).
 * @param {string | null} [token] Token de sesión en caso de ser subida por repartidor/cajero.
 */
export async function uploadPrescription(file: File, orderId: number, kind: 'web' | 'delivery', token?: string | null) {
  const formData = new FormData();
  formData.append('recipe', file);
  formData.append('orderId', String(orderId));
  formData.append('kind', kind);

  const response = await fetch(`${API_URL}/api/public/orders/prescription`, {
    method: 'POST',
    headers: token ? { 'X-Employee-Id': token } : undefined,
    body: formData
  });
  const payload = await response.json();
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || 'No se pudo subir la receta');
  }
  return payload.data as { url: string; order: { id: number; code: string } };
}

/**
 * Sube una receta médica temporal antes de confirmar la orden de compra en el checkout.
 * Retorna la URL pública temporal del archivo subido.
 *
 * @param {File} file Archivo seleccionado en el carrito.
 * @param {string | null} [token] Token opcional.
 */
export async function uploadTemporaryPrescription(file: File, token?: string | null) {
  const formData = new FormData();
  formData.append('recipe', file);

  const response = await fetch(`${API_URL}/api/public/prescriptions/temp`, {
    method: 'POST',
    headers: token ? { 'X-Employee-Id': token } : undefined,
    body: formData
  });
  const payload = await response.json();
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || 'No se pudo subir la receta');
  }
  return payload.data as { url: string };
}

/**
 * Sube una fotografía de medicamento al catálogo desde el módulo de bodega o administración.
 * Envía el archivo multipart al endpoint `/api/warehouse/products/upload-image`.
 *
 * @param {File} file Imagen del medicamento.
 * @param {string | null} [token] Token de sesión con permisos de bodeguero o administrador.
 */
export async function uploadProductImage(file: File, token?: string | null) {
  const formData = new FormData();
  formData.append('image', file);

  const response = await fetch(`${API_URL}/api/warehouse/products/upload-image`, {
    method: 'POST',
    headers: token ? { 'X-Employee-Id': token } : undefined,
    body: formData
  });
  const payload = await response.json().catch(() => ({ success: false, message: 'Respuesta inválida del servidor' }));
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || 'No se pudo subir la imagen del medicamento');
  }
  return payload.data as { url: string; filename: string };
}
