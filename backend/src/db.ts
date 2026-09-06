import dotenv from 'dotenv';
import { Pool } from 'pg';
import type { CreateProductInput, DataSnapshot } from './domain.js';

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

function requirePool() {
  if (!pool) throw new Error('PostgreSQL no está configurado');
  return pool;
}

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

export async function getDatabaseBranches() {
  if (!pool) return null;
  const result = await pool.query(
    `SELECT id_sucursal AS id,
            nombre_sucursal AS name,
            ''::text AS city,
            ''::text AS address
       FROM Sucursales
      ORDER BY id_sucursal`
  );
  return result.rows;
}

export async function getDatabaseCategories() {
  if (!pool) return null;
  const result = await pool.query(
    `SELECT id_categoria AS id,
            nombre_categoria AS name,
            id_categoria_padre AS "parentId"
       FROM Categorias
      ORDER BY id_categoria`
  );
  return result.rows;
}

export async function getDatabaseSuppliers() {
  if (!pool) return null;
  const result = await pool.query(
    `SELECT id_proveedor AS id,
            nombre_proveedor AS name,
            nit,
            correo AS email,
            telefono AS phone,
            direccion AS address,
            LOWER(COALESCE(estado, 'Activo')) = 'activo' AS active
       FROM Proveedores
      ORDER BY id_proveedor`
  );
  return result.rows;
}

export async function searchDatabaseCatalog(query: string, branchId?: number) {
  if (!pool) return null;
  const result = await pool.query(
    `SELECT p.id_producto AS id,
            p.sku_codigo AS sku,
            p.nombre_producto AS name,
            p.id_categoria AS "categoryId",
            COALESCE(p.marca, '') AS brand,
            COALESCE(p.laboratorio, '') AS laboratory,
            COALESCE(p.presentacion, '') AS presentation,
            COALESCE(p.unidad_medida, '') AS "unitMeasure",
            COALESCE(p.registro_sanitario, '') AS "sanitaryRegistry",
            COALESCE(p.requiere_receta, false) AS "requiresPrescription",
            true AS active,
            ''::text AS description,
            COALESCE(MIN(l.precio_venta), 0) AS price,
            COALESCE(SUM(ss.cantidad_disponible), 0) AS stock,
            COALESCE(
              jsonb_agg(
                DISTINCT jsonb_build_object(
                  'id', l.id_lote,
                  'batchCode', l.codigo_lote_fabricante,
                  'expirationDate', l.fecha_vencimiento,
                  'quantityAvailable', ss.cantidad_disponible,
                  'branchId', ss.id_sucursal,
                  'salePrice', l.precio_venta
                )
              ) FILTER (WHERE l.id_lote IS NOT NULL AND ss.id_sucursal IS NOT NULL),
              '[]'::jsonb
            ) AS lots
       FROM Productos p
       LEFT JOIN Lotes l ON l.id_producto = p.id_producto
       LEFT JOIN Stock_Sucursal ss
         ON ss.id_lote = l.id_lote
        AND ($2::integer IS NULL OR ss.id_sucursal = $2)
      WHERE ($1 = '' OR p.nombre_producto ILIKE '%' || $1 || '%'
                    OR p.sku_codigo ILIKE '%' || $1 || '%'
                    OR COALESCE(p.marca, '') ILIKE '%' || $1 || '%'
                    OR COALESCE(p.laboratorio, '') ILIKE '%' || $1 || '%')
      GROUP BY p.id_producto
      ORDER BY p.nombre_producto`,
    [query.trim(), branchId ?? null]
  );
  return result.rows;
}

export async function listDatabaseProducts() {
  if (!pool) return null;
  const result = await pool.query(
    `SELECT p.id_producto AS id,
            p.sku_codigo AS sku,
            p.nombre_producto AS name,
            p.id_categoria AS "categoryId",
            COALESCE(p.marca, '') AS brand,
            COALESCE(p.laboratorio, '') AS laboratory,
            COALESCE(p.presentacion, '') AS presentation,
            COALESCE(p.unidad_medida, '') AS "unitMeasure",
            COALESCE(p.registro_sanitario, '') AS "sanitaryRegistry",
            COALESCE(p.requiere_receta, false) AS "requiresPrescription",
            true AS active,
            ''::text AS description,
            COALESCE(MIN(l.precio_venta), 0) AS price,
            COALESCE(MIN(l.precio_costo), 0) AS cost
       FROM Productos p
       LEFT JOIN Lotes l ON l.id_producto = p.id_producto
      GROUP BY p.id_producto
      ORDER BY p.id_producto DESC`
  );
  return result.rows;
}

export async function createDatabaseProduct(input: CreateProductInput) {
  const database = requirePool();
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const productResult = await client.query(
      `INSERT INTO Productos
        (sku_codigo, nombre_producto, id_categoria, requiere_receta, marca,
         laboratorio, presentacion, unidad_medida, registro_sanitario)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id_producto`,
      [
        input.sku.trim().toUpperCase(),
        input.name.trim(),
        input.categoryId == null ? null : Number(input.categoryId),
        Boolean(input.requiresPrescription),
        input.brand.trim(),
        input.laboratory.trim(),
        input.presentation.trim(),
        input.unitMeasure.trim(),
        input.sanitaryRegistry.trim()
      ]
    );
    const productId = Number(productResult.rows[0].id_producto);
    let initialLot = null;
    if (input.initialStock && input.initialStock.quantity > 0) {
      const lotResult = await client.query(
        `INSERT INTO Lotes
          (codigo_lote_fabricante, id_producto, fecha_vencimiento,
           precio_costo, precio_venta, id_proveedor)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id_lote`,
        [
          input.initialStock.batchCode.trim(),
          productId,
          input.initialStock.expirationDate,
          Number(input.cost),
          Number(input.price),
          Number(input.initialStock.supplierId)
        ]
      );
      const lotId = Number(lotResult.rows[0].id_lote);
      await client.query(
        `INSERT INTO Stock_Sucursal (id_sucursal, id_lote, cantidad_disponible)
         VALUES ($1, $2, $3)`,
        [Number(input.initialStock.branchId), lotId, Number(input.initialStock.quantity)]
      );
      initialLot = { id: lotId, productId, branchId: Number(input.initialStock.branchId), supplierId: Number(input.initialStock.supplierId), batchCode: input.initialStock.batchCode, expirationDate: input.initialStock.expirationDate, productionDate: input.initialStock.productionDate, costPrice: Number(input.cost), salePrice: Number(input.price), quantityAvailable: Number(input.initialStock.quantity) };
    }
    await client.query('COMMIT');
    return { product: { id: productId, sku: input.sku.trim().toUpperCase(), name: input.name.trim(), categoryId: input.categoryId == null ? 0 : Number(input.categoryId), brand: input.brand.trim(), laboratory: input.laboratory.trim(), presentation: input.presentation.trim(), unitMeasure: input.unitMeasure.trim(), sanitaryRegistry: input.sanitaryRegistry.trim(), requiresPrescription: Boolean(input.requiresPrescription), active: true, description: input.description.trim(), price: Number(input.price), cost: Number(input.cost), imageUrl: input.imageUrl?.trim() || null }, initialLot };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteDatabaseProduct(id: number) {
  const database = requirePool();
  const result = await database.query(
    'DELETE FROM Productos WHERE id_producto = $1 RETURNING id_producto AS id',
    [id]
  );
  if (!result.rows[0]) throw new Error(`Producto #${id} no encontrado`);
  return { id: Number(result.rows[0].id), deleted: true };
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
