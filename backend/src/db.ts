import dotenv from 'dotenv';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import type { CreateProductInput, DataSnapshot, PublicCheckoutInput } from './domain.js';

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

function mapEmployeeForAdmin(row: Record<string, unknown>) {
  return {
    id: Number(row.id_empleado),
    fullName: String(row.nombre_completo),
    email: String(row.correo_corporativo),
    role: String(row.rol_usuario),
    branchId: row.id_sucursal == null ? null : Number(row.id_sucursal),
    supervisorId: row.id_supervisor == null ? null : Number(row.id_supervisor),
    active: row.contrasena != null
  };
}

export async function listDatabaseEmployees() {
  if (!pool) return null;
  const result = await pool.query(
    `SELECT id_empleado, nombre_completo, correo_corporativo, rol_usuario,
            id_sucursal, id_supervisor, contrasena
       FROM Empleados
      ORDER BY id_empleado`
  );
  return result.rows.map(mapEmployeeForAdmin);
}

export async function createDatabaseEmployee(input: {
  fullName: string;
  email: string;
  password: string;
  role: string;
  branchId: number | null;
  supervisorId: number | null;
}) {
  const database = requirePool();
  const result = await database.query(
    `INSERT INTO Empleados
      (nombre_completo, correo_corporativo, contrasena, rol_usuario,
       id_sucursal, id_supervisor, usuario_modifico)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id_empleado, nombre_completo, correo_corporativo, rol_usuario,
        id_sucursal, id_supervisor, contrasena`,
    [
      input.fullName.trim(),
      input.email.trim().toLowerCase(),
      bcrypt.hashSync(input.password, 12),
      input.role,
      input.branchId,
      input.supervisorId,
      input.email.trim()
    ]
  );
  return mapEmployeeForAdmin(result.rows[0]);
}

export async function updateDatabaseEmployee(id: number, input: Record<string, unknown>) {
  const database = requirePool();
  const fields: Array<[string, unknown]> = [];
  const mappings: Array<[string, string]> = [
    ['fullName', 'nombre_completo'],
    ['email', 'correo_corporativo'],
    ['role', 'rol_usuario'],
    ['branchId', 'id_sucursal'],
    ['supervisorId', 'id_supervisor']
  ];
  for (const [key, column] of mappings) {
    if (key in input) fields.push([column, input[key]]);
  }
  if (input.password) fields.push(['contrasena', bcrypt.hashSync(String(input.password), 12)]);
  if (fields.length === 0) throw new Error('No hay campos para actualizar');
  const assignments = fields.map(([column], index) => `${column} = $${index + 2}`).join(', ');
  const result = await database.query(
    `UPDATE Empleados
        SET ${assignments}, ultima_modificacion = CURRENT_TIMESTAMP
      WHERE id_empleado = $1
      RETURNING id_empleado, nombre_completo, correo_corporativo, rol_usuario,
                id_sucursal, id_supervisor, contrasena`,
    [id, ...fields.map(([, value]) => value)]
  );
  if (!result.rows[0]) throw new Error(`Empleado #${id} no encontrado`);
  return mapEmployeeForAdmin(result.rows[0]);
}

export async function deactivateDatabaseEmployee(id: number) {
  const database = requirePool();
  const result = await database.query(
    `UPDATE Empleados
        SET contrasena = NULL, ultima_modificacion = CURRENT_TIMESTAMP
      WHERE id_empleado = $1
      RETURNING id_empleado, nombre_completo, correo_corporativo, rol_usuario,
                id_sucursal, id_supervisor, contrasena`,
    [id]
  );
  if (!result.rows[0]) throw new Error(`Empleado #${id} no encontrado`);
  return mapEmployeeForAdmin(result.rows[0]);
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

export async function listDatabaseLots(branchId?: number, productId?: number) {
  if (!pool) return null;
  const result = await pool.query(
    `SELECT l.id_lote AS id,
            l.id_producto AS "productId",
            ss.id_sucursal AS "branchId",
            l.id_proveedor AS "supplierId",
            l.codigo_lote_fabricante AS "batchCode",
            l.fecha_vencimiento AS "expirationDate",
            l.precio_costo AS "costPrice",
            l.precio_venta AS "salePrice",
            ss.cantidad_disponible AS "quantityAvailable"
       FROM Lotes l
       LEFT JOIN Stock_Sucursal ss ON ss.id_lote = l.id_lote
      WHERE ($1::integer IS NULL OR ss.id_sucursal = $1)
        AND ($2::integer IS NULL OR l.id_producto = $2)
      ORDER BY l.fecha_vencimiento`
    , [branchId ?? null, productId ?? null]
  );
  return result.rows;
}

export async function receiveDatabaseLot(input: {
  branchId: number;
  supplierId: number;
  employeeId: number;
  productId: number;
  batchCode: string;
  expirationDate: string;
  productionDate: string;
  quantity: number;
  costPrice: number;
  salePrice: number;
}) {
  const database = requirePool();
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const lotResult = await client.query(
      `INSERT INTO Lotes
        (codigo_lote_fabricante, id_producto, fecha_vencimiento,
         precio_costo, precio_venta, id_proveedor)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id_lote`,
      [input.batchCode.trim(), input.productId, input.expirationDate, input.costPrice, input.salePrice, input.supplierId]
    );
    const lotId = Number(lotResult.rows[0].id_lote);
    await client.query(
      `INSERT INTO Stock_Sucursal (id_sucursal, id_lote, cantidad_disponible, usuario_modifico)
       VALUES ($1, $2, $3, $4)`,
      [input.branchId, lotId, input.quantity, String(input.employeeId)]
    );
    await client.query(
      `INSERT INTO MovimientoInventario (id_lote, tipo_movimiento, cantidad, id_usuario, motivo)
       VALUES ($1, 'ENTRADA', $2, $3, 'Recepción de lote')`,
      [lotId, input.quantity, input.employeeId]
    );
    await client.query('COMMIT');
    return { id: lotId, productId: input.productId, branchId: input.branchId, supplierId: input.supplierId, batchCode: input.batchCode, expirationDate: input.expirationDate, quantityAvailable: input.quantity, costPrice: input.costPrice, salePrice: input.salePrice };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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

export async function updateDatabaseProduct(id: number, input: Record<string, unknown>) {
  const database = requirePool();
  const fields: Array<[string, unknown]> = [];
  const mappings: Array<[string, string]> = [
    ['sku', 'sku_codigo'],
    ['name', 'nombre_producto'],
    ['categoryId', 'id_categoria'],
    ['requiresPrescription', 'requiere_receta'],
    ['brand', 'marca'],
    ['laboratory', 'laboratorio'],
    ['presentation', 'presentacion'],
    ['unitMeasure', 'unidad_medida'],
    ['sanitaryRegistry', 'registro_sanitario']
  ];
  for (const [inputKey, column] of mappings) {
    if (inputKey in input) fields.push([column, input[inputKey]]);
  }
  if (fields.length === 0) throw new Error('No hay campos para actualizar');
  const assignments = fields.map(([column], index) => `${column} = $${index + 2}`).join(', ');
  const result = await database.query(
    `UPDATE Productos
        SET ${assignments}, ultima_modificacion = CURRENT_TIMESTAMP
      WHERE id_producto = $1
      RETURNING id_producto AS id, sku_codigo AS sku, nombre_producto AS name,
                id_categoria AS "categoryId", requiere_receta AS "requiresPrescription",
                marca AS brand, laboratorio AS laboratory, presentacion AS presentation,
                unidad_medida AS "unitMeasure", registro_sanitario AS "sanitaryRegistry"`,
    [id, ...fields.map(([, value]) => value)]
  );
  if (!result.rows[0]) throw new Error(`Producto #${id} no encontrado`);
  return result.rows[0];
}

export async function createDatabaseCheckout(input: PublicCheckoutInput) {
  const database = requirePool();
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const customerResult = await client.query(
      `INSERT INTO Clientes (nombre, correo, nit, telefono)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (nit) DO UPDATE SET nombre = EXCLUDED.nombre, correo = EXCLUDED.correo, telefono = EXCLUDED.telefono,
                                       ultima_modificacion = CURRENT_TIMESTAMP
       RETURNING id_cliente, nombre, correo, nit, telefono`,
      [input.customer.name, input.customer.email, input.customer.nit, input.customer.phone]
    );
    const customer = customerResult.rows[0];
    const items: Array<{ product: Record<string, unknown>; quantity: number; subtotal: number; lots: Array<{ id: number; quantity: number; price: number }> }> = [];
    for (const item of input.items) {
      const productResult = await client.query(
        `SELECT id_producto, sku_codigo, nombre_producto, requiere_receta, COALESCE(marca, '') AS marca,
                COALESCE(laboratorio, '') AS laboratorio, COALESCE(presentacion, '') AS presentacion
           FROM Productos WHERE id_producto = $1`,
        [item.productId]
      );
      const product = productResult.rows[0];
      if (!product) throw new Error(`Producto no encontrado: ${item.productId}`);
      const stockResult = await client.query(
        `SELECT l.id_lote, l.precio_venta, ss.cantidad_disponible
           FROM Lotes l JOIN Stock_Sucursal ss ON ss.id_lote = l.id_lote
          WHERE l.id_producto = $1 AND ss.id_sucursal = $2 AND ss.cantidad_disponible > 0
          ORDER BY l.fecha_vencimiento ASC, l.id_lote ASC`,
        [item.productId, input.branchId]
      );
      const available = stockResult.rows.reduce((sum: number, row: { cantidad_disponible: number }) => sum + Number(row.cantidad_disponible), 0);
      if (available < item.quantity) throw new Error(`Stock insuficiente para ${product.nombre_producto}`);
      let remaining = item.quantity;
      const lots: Array<{ id: number; quantity: number; price: number }> = [];
      for (const row of stockResult.rows) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, Number(row.cantidad_disponible));
        await client.query('UPDATE Stock_Sucursal SET cantidad_disponible = cantidad_disponible - $1, ultima_modificacion = CURRENT_TIMESTAMP WHERE id_lote = $2 AND id_sucursal = $3', [take, row.id_lote, input.branchId]);
        await client.query(`INSERT INTO MovimientoInventario (id_lote, tipo_movimiento, cantidad, motivo) VALUES ($1, 'VENTA', $2, 'Reserva de venta web')`, [row.id_lote, take]);
        lots.push({ id: Number(row.id_lote), quantity: take, price: Number(row.precio_venta) });
        remaining -= take;
      }
      const price = Number(stockResult.rows[0].precio_venta);
      items.push({ product, quantity: item.quantity, subtotal: price * item.quantity, lots });
    }
    const total = items.reduce((sum, item) => sum + item.subtotal, 0);
    const invoiceResult = await client.query(
      `INSERT INTO Facturas (id_cliente, id_sucursal, fecha_emision, correlativo_sat, total_neto)
       VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4) RETURNING id_factura`,
      [customer.id_cliente, input.branchId, `WEB-${Date.now()}`, total]
    );
    const invoiceId = Number(invoiceResult.rows[0].id_factura);
    for (const item of items) {
      for (const lot of item.lots) {
        await client.query(`INSERT INTO Detalle_Facturas (id_factura, id_lote, cantidad_vendida, precio_venta_aplicado, subtotal) VALUES ($1, $2, $3, $4, $5)`, [invoiceId, lot.id, lot.quantity, lot.price, lot.quantity * lot.price]);
      }
    }
    await client.query('COMMIT');
    return { order: { id: invoiceId, code: `WEB-${String(invoiceId).padStart(6, '0')}`, total, deliveryMode: input.deliveryMode, status: 'AWAITING_PAYMENT', paymentStatus: 'PENDING' }, customer, items: items.map((item) => ({ product: { id: Number(item.product.id_producto), name: String(item.product.nombre_producto), description: `${String(item.product.marca)} ${String(item.product.presentacion)}`, price: item.subtotal / item.quantity }, quantity: item.quantity, subtotal: item.subtotal })) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function registerDatabasePayment(invoiceId: number, transactionId: string, amount: number) {
  const database = requirePool();
  const method = await database.query(`INSERT INTO MetodosPago (nombre_metodo) VALUES ('Stripe') ON CONFLICT DO NOTHING RETURNING id_metodo_pago`);
  let methodId = method.rows[0]?.id_metodo_pago;
  if (!methodId) methodId = (await database.query(`SELECT id_metodo_pago FROM MetodosPago WHERE LOWER(nombre_metodo) = 'stripe' LIMIT 1`)).rows[0]?.id_metodo_pago;
  await database.query(`INSERT INTO Pagos (id_factura, id_metodo_pago, transaccion_pasarela_id, monto_pagado) VALUES ($1, $2, $3, $4)`, [invoiceId, methodId, transactionId, amount]);
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
