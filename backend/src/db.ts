import dotenv from 'dotenv';
import { Pool } from 'pg';
import type { DataSnapshot } from './domain.js';

dotenv.config();

function connectionString() {
  if (process.env.DATABASE_URL?.trim()) {
    return process.env.DATABASE_URL.trim();
  }

  const host = process.env.PGHOST ?? process.env.DB_HOST;
  const user = process.env.PGUSER ?? process.env.DB_USER;
  const password = process.env.PGPASSWORD ?? process.env.DB_PASSWORD;
  const database = process.env.PGDATABASE ?? process.env.DB_NAME;
  if (host && user && password && database) {
    const port = process.env.PGPORT ?? process.env.DB_PORT ?? '5432';
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;
  }

  return null;
}

const url = connectionString();
export const databaseEnabled = Boolean(url);
const pool = url
  ? new Pool({
      connectionString: url,
      ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
      max: Number(process.env.PGPOOL_MAX ?? 5)
    })
  : null;

export interface DatabaseEmployee {
  employeeId: number;
  fullName: string;
  email: string;
  password: string;
  role: 'Administrador' | 'Gerente' | 'Cajero' | 'Bodeguero' | 'Repartidor' | 'Proveedor';
  branchId: number | null;
  supervisorId: number | null;
}

function mapEmployee(row: Record<string, unknown>): DatabaseEmployee {
  return {
    employeeId: Number(row.id_empleado),
    fullName: String(row.nombre_completo),
    email: String(row.correo_corporativo),
    password: String(row.contrasena ?? ''),
    role: row.rol_usuario as DatabaseEmployee['role'],
    branchId: row.id_sucursal == null ? null : Number(row.id_sucursal),
    supervisorId: row.id_supervisor == null ? null : Number(row.id_supervisor)
  };
}

export async function findDatabaseEmployeeByEmail(email: string) {
  if (!pool) return null;
  const result = await pool.query(
    `SELECT id_empleado, nombre_completo, correo_corporativo, contrasena,
            rol_usuario, id_sucursal, id_supervisor
       FROM Empleados
      WHERE LOWER(correo_corporativo) = LOWER($1)
        AND COALESCE(contrasena, '') <> ''
      LIMIT 1`,
    [email.trim()]
  );
  return result.rows[0] ? mapEmployee(result.rows[0]) : null;
}

export async function findDatabaseEmployeeById(id: number) {
  if (!pool) return null;
  const result = await pool.query(
    `SELECT id_empleado, nombre_completo, correo_corporativo, contrasena,
            rol_usuario, id_sucursal, id_supervisor
       FROM Empleados
      WHERE id_empleado = $1
        AND COALESCE(contrasena, '') <> ''
      LIMIT 1`,
    [id]
  );
  return result.rows[0] ? mapEmployee(result.rows[0]) : null;
}

export async function initializeDatabase() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pharmacy_state (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      snapshot JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function loadDatabaseSnapshot() {
  if (!pool) return null;
  const result = await pool.query<{ snapshot: DataSnapshot }>('SELECT snapshot FROM pharmacy_state WHERE id = 1');
  return result.rows[0]?.snapshot ?? null;
}

export async function saveDatabaseSnapshot(snapshot: DataSnapshot) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO pharmacy_state (id, snapshot, updated_at)
     VALUES (1, $1::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET snapshot = EXCLUDED.snapshot, updated_at = NOW()`,
    [JSON.stringify(snapshot)]
  );
}

export async function databaseHealth() {
  if (!pool) return { configured: false, connected: false };
  await pool.query('SELECT 1');
  return { configured: true, connected: true };
}
