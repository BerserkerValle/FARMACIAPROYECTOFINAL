import { ApiError } from '../api';

export interface ValidationErrorDetail {
  validation?: string;
  code?: string;
  message?: string;
  path?: (string | number)[];
}

export function translateApiError(error: unknown): string {
  if (error instanceof ApiError) {
    return translateApiErrorByStatus(error.status, error.message);
  }
  
  if (error instanceof Error) {
    return translateGenericError(error.message);
  }
  
  if (typeof error === 'string') {
    return translateGenericError(error);
  }
  
  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>;
    if (Array.isArray(err.errors) || Array.isArray(err.details)) {
      return translateValidationErrors(err.errors || err.details);
    }
    if (typeof err.message === 'string') {
      return translateApiError(err.message);
    }
  }
  
  return 'Ocurrió un error inesperado. Intenta de nuevo.';
}

function translateApiErrorByStatus(status: number, message?: string): string {
  switch (status) {
    case 400:
      return translateValidationMessage(message);
    case 401:
      return 'Tu sesión ha expirado o los datos son incorrectos. Por favor, vuelve a ingresar.';
    case 403:
      return 'No tienes permisos para realizar esta acción en FARMACIA FJK.';
    case 404:
      return 'No pudimos encontrar lo que buscas en este momento. Intenta buscar otra opción.';
    case 409:
      return 'Ya existe un registro con estos datos. Verifica la información e intenta de nuevo.';
    case 422:
      return translateValidationMessage(message);
    case 429:
      return 'Demasiadas solicitudes. Por favor, espera un momento e intenta de nuevo.';
    case 500:
      return 'Algo salió mal en los sistemas de FARMACIA FJK. Por favor, danos un momento y vuelve a intentarlo.';
    case 502:
    case 503:
    case 504:
      return 'Los servicios de FARMACIA FJK están temporalmente no disponibles. Intenta más tarde.';
    default:
      return message || 'Ocurrió un error inesperado. Intenta de nuevo.';
  }
}

function translateValidationMessage(message?: string): string {
  if (!message) {
    return '¡Ups! Revisa los datos ingresados. Parece que el formato no es el correcto.';
  }
  
  const lowerMsg = message.toLowerCase();
  
  if (lowerMsg.includes('email') || lowerMsg.includes('correo')) {
    return '¡Ups! Revisa el correo electrónico. Parece que el formato no es el correcto.';
  }
  if (lowerMsg.includes('password') || lowerMsg.includes('contraseña') || lowerMsg.includes('contrasena')) {
    return 'Por tu seguridad en FARMACIA FJK, tu contraseña debe incluir al menos 8 caracteres, una mayúscula, un número y un símbolo.';
  }
  if (lowerMsg.includes('phone') || lowerMsg.includes('teléfono') || lowerMsg.includes('telefono')) {
    return '¡Ups! Revisa el número de teléfono. El formato no parece válido.';
  }
  if (lowerMsg.includes('nit') || lowerMsg.includes('documento')) {
    return '¡Ups! Revisa el NIT o documento. El formato no parece válido.';
  }
  if (lowerMsg.includes('required') || lowerMsg.includes('requerido') || lowerMsg.includes('obligatorio')) {
    return '¡Ups! Hay campos obligatorios sin completar. Por favor, revisa el formulario.';
  }
  if (lowerMsg.includes('unique') || lowerMsg.includes('duplicado') || lowerMsg.includes('ya existe')) {
    return 'Ya existe un registro con estos datos. Verifica la información e intenta de nuevo.';
  }
  
  return '¡Ups! Revisa los datos ingresados. Parece que el formato no es el correcto.';
}

function translateValidationErrors(errors: unknown[]): string {
  if (!errors.length) return '¡Ups! Revisa los datos ingresados.';
  
  const firstError = errors[0];
  if (firstError && typeof firstError === 'object') {
    const err = firstError as ValidationErrorDetail;
    if (err.message) {
      return translateValidationMessage(err.message);
    }
    if (err.path && err.path.length > 0) {
      const field = String(err.path[err.path.length - 1]);
      return `¡Ups! Revisa el campo "${field}". Parece que el formato no es el correcto.`;
    }
  }
  
  return '¡Ups! Revisa los datos ingresados. Parece que el formato no es el correcto.';
}

function translateGenericError(message: string): string {
  const lowerMsg = message.toLowerCase();
  
  if (lowerMsg.includes('network') || lowerMsg.includes('fetch') || lowerMsg.includes('connection') || lowerMsg.includes('conectar')) {
    return 'No pudimos conectar con FARMACIA FJK. Verifica tu conexión a internet e intenta de nuevo.';
  }
  if (lowerMsg.includes('timeout') || lowerMsg.includes('tiempo')) {
    return 'La solicitud tardó demasiado. Por favor, intenta de nuevo.';
  }
  if (lowerMsg.includes('unauthorized') || lowerMsg.includes('no autorizado') || lowerMsg.includes('token')) {
    return 'Tu sesión ha expirado. Por favor, vuelve a ingresar.';
  }
  if (lowerMsg.includes('forbidden') || lowerMsg.includes('prohibido') || lowerMsg.includes('permiso')) {
    return 'No tienes permisos para realizar esta acción en FARMACIA FJK.';
  }
  if (lowerMsg.includes('not found') || lowerMsg.includes('no encontrado') || lowerMsg.includes('404')) {
    return 'No pudimos encontrar lo que buscas en este momento. Intenta buscar otra opción.';
  }
  if (lowerMsg.includes('server') || lowerMsg.includes('servidor') || lowerMsg.includes('500')) {
    return 'Algo salió mal en los sistemas de FARMACIA FJK. Por favor, danos un momento y vuelve a intentarlo.';
  }
  
  return 'Ocurrió un error inesperado. Intenta de nuevo.';
}

export function translateInventoryError(error: unknown, context?: 'cart' | 'catalog' | 'checkout'): string {
  const baseMsg = translateApiError(error);
  
  if (context === 'cart') {
    if (baseMsg.includes('404') || baseMsg.includes('encontrar')) {
      return 'No pudimos encontrar el medicamento que buscas en este momento. Intenta buscar otro.';
    }
    if (baseMsg.includes('stock') || baseMsg.includes('existencia')) {
      return 'Este medicamento no tiene stock disponible en este momento.';
    }
  }
  
  if (context === 'checkout') {
    if (baseMsg.includes('payment') || baseMsg.includes('pago') || baseMsg.includes('stripe')) {
      return 'Hubo un problema con el pago. Por favor, verifica tus datos e intenta de nuevo.';
    }
    if (baseMsg.includes('prescription') || baseMsg.includes('receta')) {
      return 'Se requiere receta médica para completar esta compra. Por favor, adjunta la receta.';
    }
  }
  
  return baseMsg;
}
