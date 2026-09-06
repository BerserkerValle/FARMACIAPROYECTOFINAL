function normalizeApiUrl(value: string | undefined) {
  const url = value?.trim();
  if (!url) return '';
  const withProtocol = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  return withProtocol.endsWith('/') ? withProtocol.slice(0, -1) : withProtocol;
}

export const API_URL = normalizeApiUrl(import.meta.env.VITE_API_URL) ||
  (import.meta.env.DEV ? 'http://localhost:4000' : '');

export async function apiRequest<T>(path: string, options: RequestInit = {}, token?: string | null): Promise<T> {
  const headers = new Headers(options.headers ?? {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
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

export async function uploadPrescription(file: File, orderId: number, kind: 'web' | 'delivery', token?: string | null) {
  const formData = new FormData();
  formData.append('recipe', file);
  formData.append('orderId', String(orderId));
  formData.append('kind', kind);

  const response = await fetch(`${API_URL}/api/public/orders/prescription`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData
  });
  const payload = await response.json();
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || 'No se pudo subir la receta');
  }
  return payload.data as { url: string; order: { id: number; code: string } };
}

export async function uploadTemporaryPrescription(file: File, token?: string | null) {
  const formData = new FormData();
  formData.append('recipe', file);

  const response = await fetch(`${API_URL}/api/public/prescriptions/temp`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData
  });
  const payload = await response.json();
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || 'No se pudo subir la receta');
  }
  return payload.data as { url: string };
}

export async function uploadProductImage(file: File, token?: string | null) {
  const formData = new FormData();
  formData.append('image', file);

  const response = await fetch(`${API_URL}/api/warehouse/products/upload-image`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData
  });
  const payload = await response.json();
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || 'No se pudo subir la imagen del medicamento');
  }
  return payload.data as { url: string; filename: string };
}

