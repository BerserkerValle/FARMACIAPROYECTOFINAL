export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
  score: number;
}

export interface PasswordRules {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSpecial: boolean;
}

export const FARMACIA_FJK_PASSWORD_RULES: PasswordRules = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: true,
};

export const SPECIAL_CHARS = '!@#$%^&*';

export const FARMACIA_FJK_PASSWORD_MESSAGE = 
  'Por tu seguridad en FARMACIA FJK, tu contraseña debe incluir al menos 8 caracteres, una mayúscula, un número y un símbolo.';

export function validatePassword(password: string, rules: PasswordRules = FARMACIA_FJK_PASSWORD_RULES): PasswordValidationResult {
  const errors: string[] = [];
  
  if (password.length < rules.minLength) {
    errors.push(`Mínimo ${rules.minLength} caracteres`);
  }
  if (rules.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Al menos una mayúscula');
  }
  if (rules.requireLowercase && !/[a-z]/.test(password)) {
    errors.push('Al menos una minúscula');
  }
  if (rules.requireNumber && !/[0-9]/.test(password)) {
    errors.push('Al menos un número');
  }
  if (rules.requireSpecial && !new RegExp(`[${SPECIAL_CHARS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]`).test(password)) {
    errors.push(`Al menos un símbolo (${SPECIAL_CHARS})`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
    score: calculateScore(password, rules),
  };
}

function calculateScore(password: string, rules: PasswordRules): number {
  let score = 0;
  if (password.length >= rules.minLength) score++;
  if (rules.requireUppercase && /[A-Z]/.test(password)) score++;
  if (rules.requireLowercase && /[a-z]/.test(password)) score++;
  if (rules.requireNumber && /[0-9]/.test(password)) score++;
  if (rules.requireSpecial && new RegExp(`[${SPECIAL_CHARS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]`).test(password)) score++;
  return score;
}

export function getPasswordStrength(password: string): 'weak' | 'medium' | 'strong' | null {
  if (!password) return null;
  const result = validatePassword(password);
  if (result.score <= 2) return 'weak';
  if (result.score <= 4) return 'medium';
  return 'strong';
}

export function getPasswordStrengthLabel(strength: 'weak' | 'medium' | 'strong' | null): string {
  switch (strength) {
    case 'weak': return 'Débil: agrega mayúsculas, números y símbolos';
    case 'medium': return 'Media: casi cumple los requisitos';
    case 'strong': return 'Fuerte: contraseña segura';
    default: return '';
  }
}

export function getPasswordRequirements(rules: PasswordRules = FARMACIA_FJK_PASSWORD_RULES): string[] {
  const reqs: string[] = [];
  reqs.push(`Mínimo ${rules.minLength} caracteres`);
  if (rules.requireUppercase) reqs.push('Una mayúscula (A-Z)');
  if (rules.requireLowercase) reqs.push('Una minúscula (a-z)');
  if (rules.requireNumber) reqs.push('Un número (0-9)');
  if (rules.requireSpecial) reqs.push(`Un símbolo (${SPECIAL_CHARS})`);
  return reqs;
}

export function validateEmail(email: string): { valid: boolean; error?: string } {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { valid: false, error: 'Formato de correo electrónico no válido' };
  }
  return { valid: true };
}

export function validateRequired(value: string, fieldName: string): { valid: boolean; error?: string } {
  if (!value || !value.trim()) {
    return { valid: false, error: `${fieldName} es requerido` };
  }
  return { valid: true };
}