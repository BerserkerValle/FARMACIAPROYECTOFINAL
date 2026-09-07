import jwt from 'jsonwebtoken';

const JWT_ISSUER = 'derkas-api';
const DEVELOPMENT_SECRET = 'derkas-development-secret-change-me';

function getJwtSecret() {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET es obligatorio en producción');
  }
  return secret || DEVELOPMENT_SECRET;
}

function getJwtExpiresIn(): jwt.SignOptions['expiresIn'] {
  return (process.env.JWT_EXPIRES_IN || '8h') as jwt.SignOptions['expiresIn'];
}

export function createEmployeeToken(employeeId: number) {
  return jwt.sign({}, getJwtSecret(), {
    subject: String(employeeId),
    issuer: JWT_ISSUER,
    expiresIn: getJwtExpiresIn()
  });
}

export function getEmployeeIdFromToken(token: string) {
  try {
    const payload = jwt.verify(token, getJwtSecret(), { issuer: JWT_ISSUER });
    if (typeof payload === 'string' || !payload.sub) return null;
    const employeeId = Number(payload.sub);
    return Number.isInteger(employeeId) && employeeId > 0 ? employeeId : null;
  } catch {
    return null;
  }
}
