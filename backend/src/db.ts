/**
 * ============================================================================
 * PROYECTO FARMACIA - CAPA DE PERSISTENCIA Y ACCESO A DATOS (POSTGRESQL)
 * ============================================================================
 * Este mÃ³dulo implementa la interacciÃ³n con la base de datos relacional PostgreSQL:
 * 1. Conectividad y Pool de Conexiones:
 *    - InicializaciÃ³n de `pg.Pool` con soporte SSL y lÃ­mite de conexiones concurrentes.
 *    - DetecciÃ³n automÃ¡tica de variables de entorno (DATABASE_URL o PGHOST/PGUSER/etc.).
 * 2. Cuentas de Clientes y TelemetrÃ­a:
 *    - CreaciÃ³n y autenticaciÃ³n de cuentas e-commerce con hash bcrypt.
 *    - Tabla `pharmacy_delivery_tracking` para seguimiento geogrÃ¡fico en tiempo real.
 * 3. GestiÃ³n de Personal (Empleados):
 *    - Consulta con filtros, creaciÃ³n, actualizaciÃ³n y baja lÃ³gica (`deactivateDatabaseEmployee`).
 * 4. CatÃ¡logos Maestros (CRUDs):
 *    - Sucursales, CategorÃ­as jerÃ¡rquicas y Proveedores.
 * 5. Control de Medicamentos e Inventario FEFO:
 *    - CatÃ¡logo con bÃºsqueda textual (`ILIKE`), cÃ¡lculo de existencias en tiempo real.
 *    - Alta transaccional de productos con lote inicial opcional.
 *    - RecepciÃ³n formal de lotes (`receiveDatabaseLot`) y registro de kardex / movimientos.
 *    - EliminaciÃ³n inteligente: borrado fÃ­sico si no tiene historial; baja lÃ³gica (soft delete) si tiene ventas.
 * 6. Checkout y FacturaciÃ³n Transaccional:
 *    - OperaciÃ³n atÃ³mica (`BEGIN ... COMMIT / ROLLBACK`) que reserva stock segÃºn caducidad (FEFO),
 *      registra el cliente, emite factura legal y asocia detalle de lotes.
 * 7. InicializaciÃ³n y Respaldo (Fallback State):
 *    - Tablas de estado `pharmacy_state` para snapshots JSONB sincronizados.
 * ============================================================================
 */

import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import type { Branch, CreateProductInput, Customer, DashboardMetrics, DataSnapshot, DiscountCode, DiscountRedemption, Invoice, Order, OrderItem, Payment, Product, PublicCheckoutInput, Supplier } from './domain.js';
import { assertDiscountCodeUsable, calculateDiscountAmount } from './discounts.js';
import { hasSanitaryRegistryChanged } from './utils.js';

dotenv.config();
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env') });

// ============================================================================
// CONFIGURACIÃ“N DEL POOL DE CONEXIONES POSTGRESQL
// ============================================================================

/**
 * Construye la cadena de conexiÃ³n de PostgreSQL a partir de variables de entorno.
 * Soporta DATABASE_URL completa o variables individuales estÃ¡ndar de PG.
 */
function connectionString(): string | null {
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

/** Bandera que indica si la base de datos PostgreSQL estÃ¡ habilitada y configurada */
export const databaseEnabled = Boolean(url);

/** Instancia del pool de conexiones `pg.Pool` */
const pool = url
  ? new Pool({
      connectionString: url,
      ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
      max: Number(process.env.PGPOOL_MAX ?? 5),
      // Las fechas operativas deben representar el día de la farmacia,
      // independientemente de la zona horaria por defecto del proveedor.
      options: '-c timezone=America/Guatemala'
    })
  : null;

/**
 * Asegura que el pool estÃ© disponible antes de ejecutar una consulta obligatoria.
 * Lanza un error si PostgreSQL no estÃ¡ configurado.
 */
function requirePool(): Pool {
  if (!pool) throw new Error('PostgreSQL no estÃ¡ configurado');
  return pool;
}

// ============================================================================
// MODELOS Y MAPEADORES DE CLIENTES Y TELEMETRÃA
// ============================================================================

export interface DatabaseEmployee {
  employeeId: number;
  fullName: string;
  email: string;
  password: string;
  role: 'Administrador' | 'Gerente' | 'Cajero' | 'Bodeguero' | 'Repartidor' | 'Proveedor';
  branchId: number | null;
  stationNumber: number | null;
  supervisorId: number | null;
}

export interface DatabaseCustomerAccount {
  customerId: number;
  fullName: string;
  email: string;
  phone: string;
  nit: string;
  address: string;
}

/** Transforma una fila de PostgreSQL al modelo de cuenta de cliente en memoria */
function mapCustomerAccount(row: Record<string, unknown>): DatabaseCustomerAccount {
  return {
    customerId: Number(row.id),
    fullName: String(row.full_name),
    email: String(row.email),
    phone: String(row.phone ?? ''),
    nit: String(row.nit ?? ''),
    address: String(row.address ?? '')
  };
}

/** Crea una nueva cuenta de cliente con contraseÃ±a encriptada (bcrypt 12 rondas) */
export async function createDatabaseCustomerAccount(input: { fullName: string; email: string; password: string; phone: string; nit: string }) {
  const database = requirePool();
  const result = await database.query(
    `INSERT INTO pharmacy_customer_accounts (full_name, email, password_hash, phone, nit, address)
     VALUES ($1, LOWER($2), $3, $4, $5, $6)
     RETURNING id, full_name, email, phone, nit, address`,
    [input.fullName.trim(), input.email.trim(), bcrypt.hashSync(input.password, 12), input.phone.trim(), input.nit.trim(), '']
  );
  return mapCustomerAccount(result.rows[0]);
}

/** Busca una cuenta de cliente por correo y valida opcionalmente la contraseÃ±a con bcrypt */
export async function findDatabaseCustomerAccount(email: string, password?: string) {
  const database = requirePool();
  const result = await database.query(
    'SELECT id, full_name, email, password_hash, phone, nit, address FROM pharmacy_customer_accounts WHERE LOWER(email) = LOWER($1) LIMIT 1',
    [email.trim()]
  );
  const row = result.rows[0];
  if (!row) return null;
  if (password !== undefined && !(await bcrypt.compare(password, String(row.password_hash)))) return null;
  return mapCustomerAccount(row);
}

/** Recupera una cuenta de cliente por su ID primario */
export async function findDatabaseCustomerAccountById(id: number) {
  const database = requirePool();
  const result = await database.query('SELECT id, full_name, email, phone, nit, address FROM pharmacy_customer_accounts WHERE id = $1', [id]);
  return result.rows[0] ? mapCustomerAccount(result.rows[0]) : null;
}

/** Actualiza los datos fiscales y de direcciÃ³n de un cliente */
export async function updateDatabaseCustomerAccount(id: number, input: { fullName: string; phone: string; nit: string; address: string }) {
  const database = requirePool();
  const result = await database.query(
    `UPDATE pharmacy_customer_accounts
        SET full_name = $2, phone = $3, nit = $4, address = $5
      WHERE id = $1
      RETURNING id, full_name, email, phone, nit, address`,
    [id, input.fullName.trim(), input.phone.trim(), input.nit.trim(), input.address.trim()]
  );
  if (!result.rows[0]) throw new Error('Cuenta de cliente no encontrada');
  return mapCustomerAccount(result.rows[0]);
}

/** Lista las cuentas de clientes sin exponer sus hashes de contraseña */
export async function listDatabaseCustomerAccounts(branchId?: number) {
  if (!pool) return null;
  const result = await pool.query(
    `SELECT id, full_name, email, phone, nit, address
       FROM pharmacy_customer_accounts
      WHERE $1::integer IS NULL
         OR EXISTS (
              SELECT 1
                FROM pharmacy_delivery_tracking tracking
               WHERE tracking.customer_account_id = pharmacy_customer_accounts.id
                 AND tracking.branch_id = $1
            )
      ORDER BY full_name, id`,
    [branchId ?? null]
  );
  return result.rows.map(mapCustomerAccount);
}

/** Elimina la cuenta de acceso y conserva el historial de entregas y pedidos */
export async function deleteDatabaseCustomerAccount(id: number) {
  const database = requirePool();
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE pharmacy_delivery_tracking SET customer_account_id = NULL WHERE customer_account_id = $1',
      [id]
    );
    const result = await client.query(
      `DELETE FROM pharmacy_customer_accounts
        WHERE id = $1
        RETURNING id, full_name, email, phone, nit, address`,
      [id]
    );
    if (!result.rows[0]) throw new Error('Cuenta de cliente no encontrada');
    await client.query('COMMIT');
    return mapCustomerAccount(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Registra el seguimiento GPS y telemetrÃ­a de una orden de entrega a domicilio */
export async function createDatabaseDeliveryTracking(input: { orderCode: string; customerId: number | null; branchId: number; address: string; latitude: number | null; longitude: number | null; total: number; deliveryMode: string }) {
  if (input.deliveryMode !== 'DELIVERY') return;
  const database = requirePool();
  await database.query(
    `INSERT INTO pharmacy_delivery_tracking (order_code, customer_account_id, branch_id, address, latitude, longitude, total, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'CREATED')
     ON CONFLICT (order_code) DO UPDATE SET
       customer_account_id = EXCLUDED.customer_account_id,
       branch_id = EXCLUDED.branch_id,
       address = EXCLUDED.address,
       latitude = EXCLUDED.latitude,
       longitude = EXCLUDED.longitude,
       total = EXCLUDED.total`,
    [input.orderCode, input.customerId, input.branchId, input.address, input.latitude, input.longitude, input.total]
  );
}

/** Lista los pedidos en seguimiento asociados a un cliente */
export async function listDatabaseCustomerOrders(customerId: number) {
  const database = requirePool();
  const result = await database.query(
    `SELECT id, order_code AS code, branch_id AS "branchId", address, status,
            rider_latitude AS latitude, rider_longitude AS longitude, updated_at AS "updatedAt"
       FROM pharmacy_delivery_tracking
      WHERE customer_account_id = $1
      ORDER BY created_at DESC`,
    [customerId]
  );
  return result.rows;
}

/** Lista los pedidos pendientes de entrega de una sucursal, aplicando alcance por repartidor */
export async function listDatabaseDeliveries(branchId: number, scope?: { employeeId?: number; restrictToAssignee?: boolean; includeDelivered?: boolean }) {
  const database = requirePool();
  const restrictToAssignee = Boolean(scope?.restrictToAssignee);
  const result = await database.query(
    `SELECT tracking.id, tracking.order_code AS code, tracking.branch_id AS "branchId",
            branch.nombre_sucursal AS "branchName",
            tracking.address, tracking.status, tracking.latitude, tracking.longitude,
            tracking.total, customer.id AS "customerId", customer.full_name AS "customerName",
            tracking.rider_latitude AS "riderLatitude", tracking.rider_longitude AS "riderLongitude",
            tracking.assigned_employee_id AS "assignedEmployeeId",
            tracking.updated_at AS "updatedAt"
       FROM pharmacy_delivery_tracking tracking
       LEFT JOIN Sucursales branch ON branch.id_sucursal = tracking.branch_id
       LEFT JOIN pharmacy_customer_accounts customer ON customer.id = tracking.customer_account_id
      WHERE tracking.branch_id = $1
        AND tracking.status <> 'CANCELLED'
        AND ($2::boolean = true OR tracking.status <> 'DELIVERED')
        AND ($3::boolean = false OR tracking.assigned_employee_id IS NULL OR tracking.assigned_employee_id = $4)
      ORDER BY tracking.created_at`,
    [branchId, Boolean(scope?.includeDelivered), restrictToAssignee, scope?.employeeId ?? null]
  );
  return result.rows;
}

/** Recupera la sucursal y el repartidor asignado de una entrega para validar propiedad */
export async function findDatabaseDeliveryOwnership(id: number) {
  const database = requirePool();
  const result = await database.query(
    `SELECT branch_id AS "branchId", assigned_employee_id AS "assignedEmployeeId"
       FROM pharmacy_delivery_tracking
      WHERE id = $1
      LIMIT 1`,
    [id]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    branchId: Number(row.branchId),
    assignedEmployeeId: row.assignedEmployeeId == null ? null : Number(row.assignedEmployeeId)
  };
}

/** Reclama una entrega sin asignar para el repartidor indicado (idempotente) */
export async function claimDatabaseDelivery(id: number, employeeId: number) {
  const database = requirePool();
  const result = await database.query(
    `UPDATE pharmacy_delivery_tracking
        SET assigned_employee_id = $2, updated_at = NOW()
      WHERE id = $1
        AND assigned_employee_id IS NULL
      RETURNING id, assigned_employee_id AS "assignedEmployeeId"`,
    [id, employeeId]
  );
  return result.rows[0] ?? null;
}

/** Actualiza el estado y las coordenadas GPS en tiempo real de una entrega */
export async function updateDatabaseDeliveryTracking(id: number, input: { status?: string; riderLatitude?: number; riderLongitude?: number }) {
  const database = requirePool();
  const fields: Array<[string, unknown]> = [];
  if (input.status !== undefined) fields.push(['status', input.status]);
  if (input.riderLatitude !== undefined) fields.push(['rider_latitude', input.riderLatitude]);
  if (input.riderLongitude !== undefined) fields.push(['rider_longitude', input.riderLongitude]);
  if (fields.length === 0) throw new Error('No hay datos de seguimiento para actualizar');
  const assignments = fields.map(([column], index) => `${column} = $${index + 2}`).join(', ');
  const result = await database.query(
    `UPDATE pharmacy_delivery_tracking SET ${assignments}, updated_at = NOW()
      WHERE id = $1
      RETURNING id, order_code AS code, branch_id AS "branchId", address, status,
                latitude, longitude, rider_latitude AS "riderLatitude", rider_longitude AS "riderLongitude",
                assigned_employee_id AS "assignedEmployeeId", updated_at AS "updatedAt"`,
    [id, ...fields.map(([, value]) => value)]
  );
  if (!result.rows[0]) throw new Error('Seguimiento no encontrado');
  return result.rows[0];
}

// ============================================================================
// GESTIÃ“N DE EMPLEADOS (PERSONAL DE FARMACIA)
// ============================================================================

function mapEmployee(row: Record<string, unknown>): DatabaseEmployee {
  return {
    employeeId: Number(row.id_empleado),
    fullName: String(row.nombre_completo),
    email: String(row.correo_corporativo),
    password: String(row.contrasena ?? ''),
    role: row.rol_usuario as DatabaseEmployee['role'],
    branchId: row.id_sucursal == null ? null : Number(row.id_sucursal),
    stationNumber: row.puesto == null ? null : Number(row.puesto),
    supervisorId: row.id_supervisor == null ? null : Number(row.id_supervisor)
  };
}

/** Busca un empleado activo por correo electrÃ³nico para autenticaciÃ³n */
export async function findDatabaseEmployeeByEmail(email: string) {
  if (!pool) return null;
  const result = await pool.query(
    `SELECT id_empleado, nombre_completo, correo_corporativo, contrasena,
            rol_usuario, id_sucursal, puesto, id_supervisor
       FROM Empleados
      WHERE LOWER(correo_corporativo) = LOWER($1)
        AND COALESCE(activo, true) = true
        AND COALESCE(contrasena, '') <> ''
      LIMIT 1`,
    [email.trim()]
  );
  return result.rows[0] ? mapEmployee(result.rows[0]) : null;
}

/** Recupera un empleado por su ID primario */
export async function findDatabaseEmployeeById(id: number) {
  if (!pool) return null;
  const result = await pool.query(
    `SELECT id_empleado, nombre_completo, correo_corporativo, contrasena,
            rol_usuario, id_sucursal, puesto, id_supervisor
       FROM Empleados
      WHERE id_empleado = $1
        AND COALESCE(activo, true) = true
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
    stationNumber: row.puesto == null ? null : Number(row.puesto),
    supervisorId: row.id_supervisor == null ? null : Number(row.id_supervisor),
    active: row.activo === false ? false : String(row.contrasena ?? '') !== ''
  };
}

/** Lista todos los empleados para el panel de administraciÃ³n */
export async function listDatabaseEmployees() {
  if (!pool) return null;
  const result = await pool.query(
    `SELECT id_empleado, nombre_completo, correo_corporativo, rol_usuario,
            id_sucursal, puesto, id_supervisor, contrasena, activo
       FROM Empleados
      ORDER BY id_empleado`
  );
  return result.rows.map(mapEmployeeForAdmin);
}

/** Crea un nuevo empleado en la base de datos con contraseÃ±a encriptada con bcrypt */
export async function createDatabaseEmployee(input: {
  fullName: string;
  email: string;
  password: string;
  role: string;
  branchId: number | null;
  stationNumber?: number | null;
  supervisorId: number | null;
}) {
  const database = requirePool();
  try {
    const result = await database.query(
      `INSERT INTO Empleados
        (nombre_completo, correo_corporativo, contrasena, rol_usuario,
         id_sucursal, puesto, id_supervisor, usuario_modifico)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id_empleado, nombre_completo, correo_corporativo, rol_usuario,
          id_sucursal, puesto, id_supervisor, contrasena`,
      [
        input.fullName.trim(),
        input.email.trim().toLowerCase(),
        bcrypt.hashSync(input.password, 12),
        input.role,
        input.branchId,
        input.stationNumber ?? null,
        input.supervisorId,
        input.email.trim()
      ]
    );
    return mapEmployeeForAdmin(result.rows[0]);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
      && 'constraint' in error && error.constraint === 'ux_empleados_sucursal_rol_puesto_activo') {
      throw new Error('Ese puesto ya está ocupado en esta sucursal');
    }
    throw error;
  }
}

/** Actualiza datos y rol de un empleado */
export async function updateDatabaseEmployee(id: number, input: Record<string, unknown>) {
  const database = requirePool();
  if (input.active === true && !input.password) {
    const current = await database.query('SELECT contrasena FROM Empleados WHERE id_empleado = $1', [id]);
    if (!current.rows[0]) throw new Error(`Empleado #${id} no encontrado`);
    if (String(current.rows[0].contrasena ?? '') === '') {
      throw new Error('No se puede activar este usuario sin establecer una nueva contraseña');
    }
  }
  const fields: Array<[string, unknown]> = [];
  const mappings: Array<[string, string]> = [
    ['fullName', 'nombre_completo'],
    ['email', 'correo_corporativo'],
    ['role', 'rol_usuario'],
    ['branchId', 'id_sucursal'],
    ['stationNumber', 'puesto'],
      ['supervisorId', 'id_supervisor'],
      ['active', 'activo']
  ];
  for (const [key, column] of mappings) {
    if (key in input) fields.push([column, input[key]]);
  }
  if (input.password) fields.push(['contrasena', bcrypt.hashSync(String(input.password), 12)]);
  if (fields.length === 0) throw new Error('No hay campos para actualizar');
  const assignments = fields.map(([column], index) => `${column} = $${index + 2}`).join(', ');
  try {
    const result = await database.query(
      `UPDATE Empleados
          SET ${assignments}, ultima_modificacion = CURRENT_TIMESTAMP
        WHERE id_empleado = $1
        RETURNING id_empleado, nombre_completo, correo_corporativo, rol_usuario,
                  id_sucursal, puesto, id_supervisor, contrasena, activo`,
      [id, ...fields.map(([, value]) => value)]
    );
    if (!result.rows[0]) throw new Error(`Empleado #${id} no encontrado`);
    if (input.active === true && String(result.rows[0].contrasena ?? '') === '') {
      throw new Error('No se puede activar este usuario sin establecer una nueva contraseÃ±a');
    }
    return mapEmployeeForAdmin(result.rows[0]);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
      && 'constraint' in error && error.constraint === 'ux_empleados_sucursal_rol_puesto_activo') {
      throw new Error('Ese puesto ya está ocupado en esta sucursal');
    }
    throw error;
  }
}

/** Desactiva a un empleado removiendo su contraseÃ±a de acceso */
export async function deactivateDatabaseEmployee(id: number) {
  const database = requirePool();
  const result = await database.query(
    `UPDATE Empleados
        SET activo = false, ultima_modificacion = CURRENT_TIMESTAMP
      WHERE id_empleado = $1
      RETURNING id_empleado, nombre_completo, correo_corporativo, rol_usuario,
                id_sucursal, puesto, id_supervisor, contrasena, activo`,
    [id]
  );
  if (!result.rows[0]) throw new Error(`Empleado #${id} no encontrado`);
  return mapEmployeeForAdmin(result.rows[0]);
}

// ============================================================================
// GESTIÃ“N DE SUCURSALES (SUCURSALES)
// ============================================================================

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

export async function createDatabaseBranch(input: { name: string; city?: string; address?: string }) {
  const database = requirePool();
  const result = await database.query(
    `INSERT INTO Sucursales (nombre_sucursal) VALUES ($1)
     RETURNING id_sucursal AS id, nombre_sucursal AS name`,
    [input.name.trim()]
  );
  return { ...result.rows[0], city: input.city ?? '', address: input.address ?? '' };
}

export async function updateDatabaseBranch(id: number, input: { name?: string; city?: string; address?: string }) {
  const database = requirePool();
  if (input.name === undefined) throw new Error('El nombre de la sucursal es obligatorio');
  const result = await database.query(
    `UPDATE Sucursales SET nombre_sucursal = $2 WHERE id_sucursal = $1
     RETURNING id_sucursal AS id, nombre_sucursal AS name`,
    [id, input.name.trim()]
  );
  if (!result.rows[0]) throw new Error(`Sucursal #${id} no encontrada`);
  return { ...result.rows[0], city: input.city ?? '', address: input.address ?? '' };
}

export async function deleteDatabaseBranch(id: number) {
  const database = requirePool();
  const used = await database.query(
    `SELECT EXISTS (SELECT 1 FROM Compras WHERE id_sucursal = $1) AS purchases_used,
            EXISTS (SELECT 1 FROM Facturas WHERE id_sucursal = $1) AS invoices_used`,
    [id]
  );
  if (used.rows[0]?.purchases_used || used.rows[0]?.invoices_used) {
    throw new Error('No se puede eliminar una sucursal con compras o facturas asociadas');
  }
  const result = await database.query('DELETE FROM Sucursales WHERE id_sucursal = $1 RETURNING id_sucursal AS id, nombre_sucursal AS name', [id]);
  if (!result.rows[0]) throw new Error(`Sucursal #${id} no encontrada`);
  return result.rows[0];
}

// ============================================================================
// GESTIÃ“N DE CATEGORÃAS (CATEGORIAS)
// ============================================================================

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

export async function createDatabaseCategory(input: { name: string; parentId: number | null }) {
  const database = requirePool();
  const result = await database.query(
    `INSERT INTO Categorias (nombre_categoria, id_categoria_padre)
     VALUES ($1, $2)
     RETURNING id_categoria AS id, nombre_categoria AS name, id_categoria_padre AS "parentId"`,
    [input.name.trim(), input.parentId]
  );
  return result.rows[0];
}

export async function updateDatabaseCategory(id: number, input: { name?: string; parentId?: number | null }) {
  const database = requirePool();
  const fields: Array<[string, unknown]> = [];
  if (input.name !== undefined) fields.push(['nombre_categoria', input.name.trim()]);
  if (input.parentId !== undefined) fields.push(['id_categoria_padre', input.parentId]);
  if (fields.length === 0) throw new Error('No hay campos para actualizar');
  const assignments = fields.map(([column], index) => `${column} = $${index + 2}`).join(', ');
  const result = await database.query(
    `UPDATE Categorias
        SET ${assignments}
      WHERE id_categoria = $1
      RETURNING id_categoria AS id, nombre_categoria AS name, id_categoria_padre AS "parentId"`,
    [id, ...fields.map(([, value]) => value)]
  );
  if (!result.rows[0]) throw new Error(`CategorÃ­a #${id} no encontrada`);
  return result.rows[0];
}

export async function deleteDatabaseCategory(id: number) {
  const database = requirePool();
  const used = await database.query(
    `SELECT EXISTS (SELECT 1 FROM Productos WHERE id_categoria = $1) AS product_used,
            EXISTS (SELECT 1 FROM Categorias WHERE id_categoria_padre = $1) AS child_used`,
    [id]
  );
  if (used.rows[0]?.product_used || used.rows[0]?.child_used) {
    throw new Error('No se puede eliminar una categorÃ­a que tiene productos o subcategorÃ­as');
  }
  const result = await database.query(
    'DELETE FROM Categorias WHERE id_categoria = $1 RETURNING id_categoria AS id, nombre_categoria AS name, id_categoria_padre AS "parentId"',
    [id]
  );
  if (!result.rows[0]) throw new Error(`CategorÃ­a #${id} no encontrada`);
  return result.rows[0];
}

// ============================================================================
// GESTIÃ“N DE PROVEEDORES (PROVEEDORES)
// ============================================================================

export async function getDatabaseSuppliers() {
  if (!pool) return null;
  const result = await pool.query(
    `SELECT id_proveedor AS id,
            nombre_proveedor AS name,
            COALESCE(nombre_contacto, '') AS "contactName",
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

export async function createDatabaseSupplier(input: Omit<Supplier, 'id'>) {
  const database = requirePool();
  const duplicate = await database.query(
    'SELECT 1 FROM Proveedores WHERE nit = $1 OR LOWER(correo) = LOWER($2) LIMIT 1',
    [input.nit.trim(), input.email.trim()]
  );
  if (duplicate.rows[0]) throw new Error('Ya existe un proveedor con ese NIT o correo');
  const result = await database.query(
    `INSERT INTO Proveedores (nombre_proveedor, nombre_contacto, nit, correo, telefono, direccion, estado)
     VALUES ($1, $2, $3, LOWER($4), $5, $6, $7)
     RETURNING id_proveedor AS id, nombre_proveedor AS name,
               COALESCE(nombre_contacto, '') AS "contactName", nit, correo AS email,
               telefono AS phone, direccion AS address,
               LOWER(COALESCE(estado, 'Activo')) = 'activo' AS active`,
    [input.name.trim(), input.contactName?.trim() ?? '', input.nit.trim(), input.email.trim(), input.phone.trim(), input.address.trim(), input.active ? 'Activo' : 'Inactivo']
  );
  return result.rows[0];
}

export async function updateDatabaseSupplier(id: number, input: Partial<Omit<Supplier, 'id'>>) {
  const database = requirePool();
  const fields: Array<[string, unknown]> = [];
  const mappings: Array<[keyof Omit<Supplier, 'id'>, string]> = [
    ['name', 'nombre_proveedor'],
    ['contactName', 'nombre_contacto'],
    ['nit', 'nit'],
    ['email', 'correo'],
    ['phone', 'telefono'],
    ['address', 'direccion']
  ];
  for (const [key, column] of mappings) {
    if (key in input && input[key] !== undefined) fields.push([column, key === 'email' ? String(input[key]).trim().toLowerCase() : String(input[key]).trim()]);
  }
  if (input.active !== undefined) fields.push(['estado', input.active ? 'Activo' : 'Inactivo']);
  if (fields.length === 0) throw new Error('No hay campos para actualizar');
  if (input.nit !== undefined || input.email !== undefined) {
    const duplicate = await database.query(
      `SELECT 1 FROM Proveedores WHERE id_proveedor <> $1 AND (nit = COALESCE($2, nit) OR LOWER(correo) = LOWER(COALESCE($3, correo))) LIMIT 1`,
      [id, input.nit?.trim() ?? null, input.email?.trim() ?? null]
    );
    if (duplicate.rows[0]) throw new Error('Ya existe otro proveedor con ese NIT o correo');
  }
  const assignments = fields.map(([column], index) => `${column} = $${index + 2}`).join(', ');
  const result = await database.query(
    `UPDATE Proveedores SET ${assignments}
      WHERE id_proveedor = $1
      RETURNING id_proveedor AS id, nombre_proveedor AS name,
                COALESCE(nombre_contacto, '') AS "contactName", nit, correo AS email,
                telefono AS phone, direccion AS address,
                LOWER(COALESCE(estado, 'Activo')) = 'activo' AS active`,
    [id, ...fields.map(([, value]) => value)]
  );
  if (!result.rows[0]) throw new Error(`Proveedor #${id} no encontrado`);
  return result.rows[0];
}

export async function deleteDatabaseSupplier(id: number) {
  const database = requirePool();
  const used = await database.query('SELECT EXISTS (SELECT 1 FROM Lotes WHERE id_proveedor = $1) AS used', [id]);
  if (used.rows[0]?.used) throw new Error('No se puede eliminar un proveedor con lotes asociados');
  const result = await database.query('DELETE FROM Proveedores WHERE id_proveedor = $1 RETURNING id_proveedor AS id, nombre_proveedor AS name', [id]);
  if (!result.rows[0]) throw new Error(`Proveedor #${id} no encontrado`);
  return result.rows[0];
}

export async function getDatabaseDashboard(filters?: { branchId?: number }): Promise<DashboardMetrics> {
  const database = requirePool();
  const branchId = filters?.branchId;
  const hasBranchFilter = branchId != null;
  const dashboardParams = hasBranchFilter ? [branchId] : [];
  const branchInvoiceFilter = hasBranchFilter ? ' AND f.id_sucursal = $1' : '';
  const branchStockFilter = hasBranchFilter ? ' AND ss.id_sucursal = $1' : '';
  const activeProductsMetric = hasBranchFilter
    ? `(SELECT COUNT(DISTINCT l.id_producto)
         FROM Lotes l
         JOIN Stock_Sucursal ss ON ss.id_lote = l.id_lote
         JOIN Productos p ON p.id_producto = l.id_producto
        WHERE COALESCE(p.activo, true) = true${branchStockFilter})`
    : `(SELECT COUNT(*) FROM Productos WHERE COALESCE(activo, true) = true)`;
  const supplierCountMetric = hasBranchFilter
    ? `(SELECT COUNT(DISTINCT l.id_proveedor)
         FROM Lotes l
         JOIN Stock_Sucursal ss ON ss.id_lote = l.id_lote${branchStockFilter})`
    : `(SELECT COUNT(*) FROM Proveedores)`;
  const customerCountMetric = hasBranchFilter
    ? `(SELECT COUNT(DISTINCT tracking.customer_account_id)
         FROM pharmacy_delivery_tracking tracking
        WHERE tracking.customer_account_id IS NOT NULL
          AND tracking.branch_id = $1)`
    : `(SELECT COUNT(*) FROM Clientes)`;
  const employeeCountMetric = hasBranchFilter
    ? `(SELECT COUNT(*) FROM Empleados WHERE COALESCE(activo, true) = true AND COALESCE(contrasena, '') <> '' AND id_sucursal = $1)`
    : `(SELECT COUNT(*) FROM Empleados WHERE COALESCE(activo, true) = true AND COALESCE(contrasena, '') <> '')`;
  const branchCountMetric = hasBranchFilter
    ? `(SELECT COUNT(*) FROM Sucursales WHERE id_sucursal = $1)`
    : `(SELECT COUNT(*) FROM Sucursales)`;
  const result = await database.query(`
    WITH paid_sales AS (
      SELECT COALESCE(SUM(f.total_neto) FILTER (WHERE f.fecha_emision >= CURRENT_DATE), 0) AS total,
             COALESCE(SUM(f.total_neto) FILTER (WHERE f.fecha_emision >= CURRENT_DATE - INTERVAL '1 day' AND f.fecha_emision < CURRENT_DATE), 0) AS yesterday_total,
             COALESCE(SUM(f.total_neto) FILTER (WHERE f.fecha_emision >= DATE_TRUNC('month', CURRENT_TIMESTAMP)), 0) AS month_total
        FROM Facturas f
       WHERE EXISTS (SELECT 1 FROM Pagos p WHERE p.id_factura = f.id_factura)${branchInvoiceFilter}
    ),
    low_stock AS (
      SELECT COUNT(*) AS total
        FROM (
          SELECT l.id_producto AS product_id, ss.id_sucursal
            FROM Lotes l
            JOIN Stock_Sucursal ss ON ss.id_lote = l.id_lote
            JOIN Productos p ON p.id_producto = l.id_producto
           WHERE COALESCE(p.activo, true) = true${branchStockFilter}
           GROUP BY l.id_producto, ss.id_sucursal
          HAVING COALESCE(SUM(ss.cantidad_disponible), 0) <= 10
        ) stock
    ),
    low_stock_products AS (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'productId', stock.product_id,
        'name', stock.name,
        'sku', stock.sku,
        'branchId', stock.branch_id,
        'branchName', stock.branch_name,
        'stock', stock.stock,
        'severity', CASE WHEN stock.stock <= 0 THEN 'critical' WHEN stock.stock <= 5 THEN 'urgent' ELSE 'low' END
      ) ORDER BY stock.stock, stock.name), '[]'::jsonb) AS products
      FROM (
        SELECT p.id_producto AS product_id,
               p.nombre_producto AS name,
               p.sku_codigo AS sku,
               ss.id_sucursal AS branch_id,
               COALESCE(s.nombre_sucursal, CONCAT('Sucursal #', ss.id_sucursal)) AS branch_name,
               COALESCE(SUM(ss.cantidad_disponible), 0) AS stock
          FROM Productos p
          JOIN Lotes l ON l.id_producto = p.id_producto
          JOIN Stock_Sucursal ss ON ss.id_lote = l.id_lote
          LEFT JOIN Sucursales s ON s.id_sucursal = ss.id_sucursal
         WHERE COALESCE(p.activo, true) = true${branchStockFilter}
         GROUP BY p.id_producto, p.nombre_producto, p.sku_codigo, ss.id_sucursal, s.nombre_sucursal
        HAVING COALESCE(SUM(ss.cantidad_disponible), 0) <= 10
      ) stock
    ),
    out_of_stock AS (
      SELECT COUNT(*) AS total
        FROM (
          SELECT l.id_producto AS product_id, ss.id_sucursal
            FROM Lotes l
            JOIN Stock_Sucursal ss ON ss.id_lote = l.id_lote
            JOIN Productos p ON p.id_producto = l.id_producto
           WHERE COALESCE(p.activo, true) = true${branchStockFilter}
           GROUP BY l.id_producto, ss.id_sucursal
          HAVING COALESCE(SUM(ss.cantidad_disponible), 0) <= 0
        ) stock
    ),
    pending_orders AS (
      SELECT COUNT(*) AS total
        FROM Facturas f
       WHERE (NOT EXISTS (SELECT 1 FROM Pagos p WHERE p.id_factura = f.id_factura)
          AND 1 = 1${branchInvoiceFilter})
          OR EXISTS (
            SELECT 1 FROM pharmacy_delivery_tracking d
             WHERE d.order_code = CONCAT('WEB-', LPAD(f.id_factura::text, 6, '0'))
               AND d.status <> 'DELIVERED'${hasBranchFilter ? ' AND d.branch_id = $1' : ''}
          )
    ),
    expiring_lots AS (
      SELECT COUNT(*) AS total
        FROM Lotes l
       WHERE l.fecha_vencimiento < CURRENT_DATE + INTERVAL '90 days'
         AND COALESCE(l.fecha_vencimiento, CURRENT_DATE) >= CURRENT_DATE
         AND EXISTS (SELECT 1 FROM Stock_Sucursal ss WHERE ss.id_lote = l.id_lote AND ss.cantidad_disponible > 0${branchStockFilter})
    ),
    inventory_value AS (
      SELECT COALESCE(SUM(ss.cantidad_disponible * l.precio_costo), 0) AS cost,
             COALESCE(SUM(ss.cantidad_disponible * l.precio_venta), 0) AS retail
        FROM Lotes l
        JOIN Stock_Sucursal ss ON ss.id_lote = l.id_lote
       WHERE 1 = 1${branchStockFilter}
    )
    SELECT (SELECT total FROM paid_sales) AS "salesToday",
           (SELECT yesterday_total FROM paid_sales) AS "salesYesterday",
           (SELECT month_total FROM paid_sales) AS "salesMonth",
           (SELECT total FROM low_stock) AS "lowStockCount",
           ${activeProductsMetric} AS "activeProducts",
           (SELECT total FROM out_of_stock) AS "outOfStockCount",
           ${employeeCountMetric} AS "activeEmployees",
           ${branchCountMetric} AS "activeBranches",
           (SELECT total FROM expiring_lots) AS "expiringLotsCount",
           (SELECT total FROM pending_orders) AS "pendingOrders",
           ${supplierCountMetric} AS "suppliersCount",
           ${customerCountMetric} AS "registeredCustomers",
           (SELECT cost FROM inventory_value) AS "inventoryCost",
           (SELECT retail FROM inventory_value) AS "inventoryRetailValue",
           (SELECT products FROM low_stock_products) AS "lowStockProducts"
  `, dashboardParams);
  return {
    salesToday: Number(result.rows[0]?.salesToday ?? 0),
    salesYesterday: Number(result.rows[0]?.salesYesterday ?? 0),
    salesMonth: Number(result.rows[0]?.salesMonth ?? 0),
    lowStockCount: Number(result.rows[0]?.lowStockCount ?? 0),
    expiringLotsCount: Number(result.rows[0]?.expiringLotsCount ?? 0),
    registeredCustomers: Number(result.rows[0]?.registeredCustomers ?? 0),
    pendingOrders: Number(result.rows[0]?.pendingOrders ?? 0),
    suppliersCount: Number(result.rows[0]?.suppliersCount ?? 0),
    activeProducts: Number(result.rows[0]?.activeProducts ?? 0),
    outOfStockCount: Number(result.rows[0]?.outOfStockCount ?? 0),
    activeEmployees: Number(result.rows[0]?.activeEmployees ?? 0),
    activeBranches: Number(result.rows[0]?.activeBranches ?? 0),
    inventoryCost: Number(result.rows[0]?.inventoryCost ?? 0),
    inventoryRetailValue: Number(result.rows[0]?.inventoryRetailValue ?? 0),
    lowStockProducts: result.rows[0]?.lowStockProducts ?? []
  };
}

export async function getDatabaseReports(filters?: { branchId?: number; from?: string; to?: string }) {
  const database = requirePool();
  const params: Array<number | string> = [];
  const conditions: string[] = [];
  if (filters?.branchId) { params.push(filters.branchId); conditions.push(`f.id_sucursal = $${params.length}`); }
  if (filters?.from) { params.push(filters.from); conditions.push(`f.fecha_emision >= $${params.length}::date`); }
  if (filters?.to) { params.push(filters.to); conditions.push(`f.fecha_emision < ($${params.length}::date + INTERVAL '1 day')`); }
  const reportFilter = conditions.length ? ` AND ${conditions.join(' AND ')}` : '';
  const purchaseBranchParams = [filters?.branchId ?? null];
  const [monthlyResult, branchResult, productResult, profitResult, purchasesResult, dailyBranchResult, employeeSalesResult] = await Promise.all([
    database.query(`
      SELECT TO_CHAR(DATE_TRUNC('month', f.fecha_emision), 'YYYY-MM') AS month,
             COALESCE(SUM(f.total_neto), 0) AS total
        FROM Facturas f
       WHERE EXISTS (SELECT 1 FROM Pagos p WHERE p.id_factura = f.id_factura)${reportFilter}
       GROUP BY DATE_TRUNC('month', f.fecha_emision)
       ORDER BY DATE_TRUNC('month', f.fecha_emision)
    `, params),
    database.query(`
      SELECT COALESCE(s.nombre_sucursal, CONCAT('Sucursal #', f.id_sucursal)) AS branch,
             COALESCE(SUM(f.total_neto), 0) AS total
        FROM Facturas f
        LEFT JOIN Sucursales s ON s.id_sucursal = f.id_sucursal
       WHERE EXISTS (SELECT 1 FROM Pagos p WHERE p.id_factura = f.id_factura)${reportFilter}
        GROUP BY f.id_sucursal, s.nombre_sucursal
       ORDER BY total DESC
    `, params),
    database.query(`
      SELECT p.nombre_producto AS name,
             COALESCE(SUM(df.cantidad_vendida), 0) AS quantity,
             COALESCE(SUM(df.subtotal * COALESCE(f.total_neto / NULLIF(f.subtotal_bruto, 0), 1)), 0) AS total
        FROM Detalle_Facturas df
        JOIN Facturas f ON f.id_factura = df.id_factura
        JOIN Lotes l ON l.id_lote = df.id_lote
        JOIN Productos p ON p.id_producto = l.id_producto
       WHERE EXISTS (SELECT 1 FROM Pagos pago WHERE pago.id_factura = f.id_factura)${reportFilter}
       GROUP BY p.id_producto, p.nombre_producto
       ORDER BY total DESC
       LIMIT 10
    `, params),
    database.query(`
      SELECT TO_CHAR(DATE_TRUNC('month', f.fecha_emision), 'YYYY-MM') AS month,
             COALESCE(SUM(
               (df.subtotal * COALESCE(f.total_neto / NULLIF(f.subtotal_bruto, 0), 1))
               - (df.cantidad_vendida * l.precio_costo)
             ), 0) AS total
        FROM Detalle_Facturas df
        JOIN Facturas f ON f.id_factura = df.id_factura
        JOIN Lotes l ON l.id_lote = df.id_lote
       WHERE EXISTS (SELECT 1 FROM Pagos pago WHERE pago.id_factura = f.id_factura)${reportFilter}
       GROUP BY DATE_TRUNC('month', f.fecha_emision)
       ORDER BY DATE_TRUNC('month', f.fecha_emision)
    `, params),
    database.query(`
      SELECT COALESCE(pr.nombre_proveedor, CONCAT('Proveedor #', l.id_proveedor)) AS supplier,
             COALESCE(SUM(ss.cantidad_disponible * l.precio_costo), 0) AS total
        FROM Lotes l
        LEFT JOIN Proveedores pr ON pr.id_proveedor = l.id_proveedor
        LEFT JOIN Stock_Sucursal ss ON ss.id_lote = l.id_lote
       WHERE $1::integer IS NULL OR ss.id_sucursal = $1
        GROUP BY l.id_proveedor, pr.nombre_proveedor
       ORDER BY total DESC
    `, purchaseBranchParams),
    database.query(`
      SELECT TO_CHAR(DATE_TRUNC('day', f.fecha_emision), 'YYYY-MM-DD') AS date,
             COALESCE(s.nombre_sucursal, CONCAT('Sucursal #', f.id_sucursal)) AS branch,
             f.id_sucursal AS "branchId",
             COALESCE(SUM(f.total_neto), 0) AS total,
             COUNT(*) AS orders
        FROM Facturas f
        LEFT JOIN Sucursales s ON s.id_sucursal = f.id_sucursal
       WHERE EXISTS (SELECT 1 FROM Pagos p WHERE p.id_factura = f.id_factura)${reportFilter}
       GROUP BY DATE_TRUNC('day', f.fecha_emision), f.id_sucursal, s.nombre_sucursal
       ORDER BY DATE_TRUNC('day', f.fecha_emision), branch
    `, params),
    database.query(`
      SELECT e.nombre_completo AS employee,
             COALESCE(f.puesto_cajero, e.puesto) AS "stationNumber",
             f.id_sucursal AS "branchId",
             COALESCE(s.nombre_sucursal, CONCAT('Sucursal #', f.id_sucursal)) AS branch,
             COALESCE(SUM(f.total_neto), 0) AS total
        FROM Facturas f
        JOIN Empleados e ON e.id_empleado = f.id_empleado
        LEFT JOIN Sucursales s ON s.id_sucursal = f.id_sucursal
       WHERE e.rol_usuario = 'Cajero'
         AND EXISTS (SELECT 1 FROM Pagos p WHERE p.id_factura = f.id_factura)${reportFilter}
       GROUP BY e.id_empleado, e.nombre_completo, COALESCE(f.puesto_cajero, e.puesto), f.id_sucursal, s.nombre_sucursal
       ORDER BY total DESC, e.nombre_completo
    `, params)
  ]);

  return {
    monthlySales: monthlyResult.rows.map((row) => ({ month: String(row.month), total: Number(row.total) })),
    salesByBranch: branchResult.rows.map((row) => ({ branch: String(row.branch), total: Number(row.total) })),
    topProducts: productResult.rows.map((row) => ({
      name: String(row.name),
      quantity: Number(row.quantity),
      total: Number(row.total)
    })),
    salesByEmployee: employeeSalesResult.rows.map((row) => ({
      employee: String(row.employee),
      stationNumber: row.stationNumber == null ? null : Number(row.stationNumber),
      branchId: Number(row.branchId),
      branch: String(row.branch),
      total: Number(row.total)
    })),
    profitMonthly: profitResult.rows.map((row) => ({ month: String(row.month), total: Number(row.total) })),
    purchasesBySupplier: purchasesResult.rows.map((row) => ({ supplier: String(row.supplier), total: Number(row.total) })),
    dailySalesByBranch: dailyBranchResult.rows.map((row) => ({ date: String(row.date), branch: String(row.branch), branchId: Number(row.branchId), total: Number(row.total), orders: Number(row.orders) }))
  };
}

// ============================================================================
// CATÃLOGO DE PRODUCTOS Y BÃšSQUEDA AVANZADA CON LOTES
// ============================================================================

/**
 * Realiza bÃºsqueda en catÃ¡logo consolidando lotes disponibles en sucursal mediante `jsonb_agg`.
 */
export async function searchDatabaseCatalog(query: string, branchId?: number, categoryId?: number, minPrice?: number, maxPrice?: number) {
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
             COALESCE(p.producto_controlado, false) AS "controlledProduct",
             COALESCE(p.uso_cronico, false) AS "chronicUse",
             COALESCE(p.evitar_embarazo, false) AS "avoidPregnancy",
             COALESCE(p.requiere_refrigeracion, false) AS "requiresRefrigeration",
             COALESCE((SELECT jsonb_agg(jsonb_build_object('ingredient', i.ingredient, 'quantity', i.quantity, 'concentration', i.concentration, 'principal', i.principal) ORDER BY i.id) FROM pharmacy_product_ingredients i WHERE i.product_id = p.id_producto), '[]'::jsonb) AS ingredients,
             p.imagen_url AS "imageUrl",
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
       LEFT JOIN Categorias cat ON cat.id_categoria = p.id_categoria
       LEFT JOIN Lotes l ON l.id_producto = p.id_producto
       LEFT JOIN Stock_Sucursal ss
         ON ss.id_lote = l.id_lote
        AND ($2::integer IS NULL OR ss.id_sucursal = $2)
     WHERE COALESCE(p.activo, true) = true
       AND ($1 = '' OR p.nombre_producto ILIKE '%' || $1 || '%'
                   OR p.sku_codigo ILIKE '%' || $1 || '%'
                   OR COALESCE(p.marca, '') ILIKE '%' || $1 || '%'
                   OR COALESCE(p.laboratorio, '') ILIKE '%' || $1 || '%'
                   OR COALESCE(cat.nombre_categoria, '') ILIKE '%' || $1 || '%')
        AND ($3::integer IS NULL OR p.id_categoria = $3 OR cat.id_categoria_padre = $3)
      GROUP BY p.id_producto
      HAVING ($4::numeric IS NULL OR COALESCE(MIN(l.precio_venta), 0) >= $4)
         AND ($5::numeric IS NULL OR COALESCE(MIN(l.precio_venta), 0) <= $5)
      ORDER BY p.nombre_producto`,
    [query.trim(), branchId ?? null, categoryId ?? null, minPrice ?? null, maxPrice ?? null]
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
             COALESCE(p.producto_controlado, false) AS "controlledProduct",
             COALESCE(p.uso_cronico, false) AS "chronicUse",
             COALESCE(p.evitar_embarazo, false) AS "avoidPregnancy",
             COALESCE(p.requiere_refrigeracion, false) AS "requiresRefrigeration",
             COALESCE((SELECT jsonb_agg(jsonb_build_object('ingredient', i.ingredient, 'quantity', i.quantity, 'concentration', i.concentration, 'principal', i.principal) ORDER BY i.id) FROM pharmacy_product_ingredients i WHERE i.product_id = p.id_producto), '[]'::jsonb) AS ingredients,
             p.imagen_url AS "imageUrl",
            COALESCE(p.activo, true) AS active,
            ''::text AS description,
            COALESCE(MIN(l.precio_venta), 0) AS price,
            COALESCE(MIN(l.precio_costo), 0) AS cost
       FROM Productos p
       LEFT JOIN Lotes l ON l.id_producto = p.id_producto
      WHERE COALESCE(p.activo, true) = true
      GROUP BY p.id_producto
      ORDER BY p.id_producto DESC`
  );
  return result.rows;
}

// ============================================================================
// CONTROL DE LOTES Y MOVIMIENTOS DE BODEGA
// ============================================================================

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
       JOIN Productos p ON p.id_producto = l.id_producto
       LEFT JOIN Stock_Sucursal ss ON ss.id_lote = l.id_lote
      WHERE COALESCE(p.activo, true) = true
        AND ($1::integer IS NULL OR ss.id_sucursal = $1)
        AND ($2::integer IS NULL OR l.id_producto = $2)
      ORDER BY l.fecha_vencimiento`,
    [branchId ?? null, productId ?? null]
  );
  return result.rows;
}

/**
 * Registra la recepciÃ³n formal de un lote de medicamentos con transacciÃ³n ACID.
 * Inserta en `Lotes`, actualiza `Stock_Sucursal` y registra en `MovimientoInventario`.
 */
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
       VALUES ($1, 'ENTRADA', $2, $3, 'RecepciÃ³n de lote')`,
      [lotId, input.quantity, input.employeeId]
    );
    await client.query('COMMIT');
    return {
      id: lotId,
      productId: input.productId,
      branchId: input.branchId,
      supplierId: input.supplierId,
      batchCode: input.batchCode,
      expirationDate: input.expirationDate,
      quantityAvailable: input.quantity,
      costPrice: input.costPrice,
      salePrice: input.salePrice
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Crea un producto en PostgreSQL y opcionalmente su primer lote de inventario inicial.
 */
export async function createDatabaseProduct(input: CreateProductInput) {
  const database = requirePool();
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const normalizedSku = input.sku.trim().toUpperCase();
    const duplicateSku = await client.query(
      'SELECT 1 FROM Productos WHERE UPPER(TRIM(sku_codigo)) = $1 LIMIT 1',
      [normalizedSku]
    );
    if (duplicateSku.rowCount) throw new Error(`Ya existe un medicamento con el SKU ${normalizedSku}`);
    const duplicate = await client.query('SELECT 1 FROM Productos WHERE registro_sanitario = $1 LIMIT 1', [input.sanitaryRegistry.trim()]);
    if (duplicate.rowCount) throw new Error('Ya existe un medicamento con ese registro sanitario');
    const productResult = await client.query(
      `INSERT INTO Productos
        (sku_codigo, nombre_producto, id_categoria, requiere_receta, marca,
         laboratorio, presentacion, unidad_medida, registro_sanitario, imagen_url,
         producto_controlado, uso_cronico, evitar_embarazo, requiere_refrigeracion)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id_producto`,
      [
         normalizedSku,
        input.name.trim(),
        input.categoryId == null ? null : Number(input.categoryId),
        Boolean(input.requiresPrescription),
        input.brand.trim(),
        input.laboratory.trim(),
        input.presentation.trim(),
        input.unitMeasure.trim(),
        input.sanitaryRegistry.trim(),
         input.imageUrl?.trim() || null,
         Boolean(input.controlledProduct), Boolean(input.chronicUse), Boolean(input.avoidPregnancy), Boolean(input.requiresRefrigeration)
      ]
    );
    const productId = Number(productResult.rows[0].id_producto);
    for (const ingredient of input.ingredients ?? []) {
      if (ingredient.ingredient.trim()) await client.query(
        `INSERT INTO pharmacy_product_ingredients (product_id, ingredient, quantity, concentration, principal) VALUES ($1, $2, $3, $4, $5)`,
        [productId, ingredient.ingredient.trim(), ingredient.quantity.trim(), ingredient.concentration.trim(), Boolean(ingredient.principal)]
      );
    }
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
      initialLot = {
        id: lotId,
        productId,
        branchId: Number(input.initialStock.branchId),
        supplierId: Number(input.initialStock.supplierId),
        batchCode: input.initialStock.batchCode,
        expirationDate: input.initialStock.expirationDate,
        productionDate: input.initialStock.productionDate,
        costPrice: Number(input.cost),
        salePrice: Number(input.price),
        quantityAvailable: Number(input.initialStock.quantity)
      };
    }

    await client.query('COMMIT');
    return {
      product: {
        id: productId,
        sku: input.sku.trim().toUpperCase(),
        name: input.name.trim(),
        categoryId: input.categoryId == null ? 0 : Number(input.categoryId),
        brand: input.brand.trim(),
        laboratory: input.laboratory.trim(),
        presentation: input.presentation.trim(),
        unitMeasure: input.unitMeasure.trim(),
        sanitaryRegistry: input.sanitaryRegistry.trim(),
        requiresPrescription: Boolean(input.requiresPrescription),
        active: true,
        description: (input.description || '').trim(),
        price: Number(input.price),
        cost: Number(input.cost),
        imageUrl: input.imageUrl?.trim() || null
      },
      initialLot
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function mapDatabaseDiscountCode(row: Record<string, unknown>): DiscountCode {
  return {
    id: Number(row.id),
    code: String(row.code),
    type: row.discount_type as DiscountCode['type'],
    value: Number(row.discount_value),
    maxUses: Number(row.max_uses),
    startsAt: row.starts_at ? new Date(String(row.starts_at)).toISOString() : null,
    expiresAt: row.expires_at ? new Date(String(row.expires_at)).toISOString() : null,
    active: Boolean(row.active),
    createdAt: new Date(String(row.created_at)).toISOString()
  };
}

export async function listDatabaseDiscountCodes() {
  const database = requirePool();
  const result = await database.query('SELECT * FROM pharmacy_discount_codes ORDER BY created_at DESC, id DESC');
  return result.rows.map(mapDatabaseDiscountCode);
}

export async function createDatabaseDiscountCode(input: Omit<DiscountCode, 'id' | 'createdAt'>) {
  const database = requirePool();
  const result = await database.query(
    `INSERT INTO pharmacy_discount_codes (code, discount_type, discount_value, max_uses, starts_at, expires_at, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [input.code, input.type, input.value, input.maxUses, input.startsAt, input.expiresAt, input.active]
  );
  return mapDatabaseDiscountCode(result.rows[0]);
}

export async function setDatabaseDiscountCodeActive(id: number, active: boolean) {
  const database = requirePool();
  const result = await database.query(
    'UPDATE pharmacy_discount_codes SET active = $2 WHERE id = $1 RETURNING *',
    [id, active]
  );
  if (!result.rows[0]) throw new Error('CÃ³digo de descuento no encontrado');
  return mapDatabaseDiscountCode(result.rows[0]);
}

export async function quoteDatabaseDiscountCode(input: {
  code: string;
  email: string;
  branchId: number;
  items: Array<{ productId: number; quantity: number }>;
}) {
  const database = requirePool();
  const codeResult = await database.query('SELECT * FROM pharmacy_discount_codes WHERE code = $1', [input.code.trim().toUpperCase()]);
  const row = codeResult.rows[0];
  if (!row) throw new Error('El cÃ³digo de descuento no existe');
  const discount = mapDatabaseDiscountCode(row);
  const redemptionResult = await database.query(
    `SELECT discount_code_id AS "discountCodeId", order_id AS "orderId", customer_email AS "customerEmail",
            status, created_at AS "createdAt"
       FROM pharmacy_discount_redemptions
      WHERE discount_code_id = $1 AND status IN ('RESERVED', 'REDEEMED')`,
    [discount.id]
  );
  const redemptions = redemptionResult.rows.map((redemption) => ({
    discountCodeId: Number(redemption.discountCodeId),
    orderId: Number(redemption.orderId),
    customerEmail: String(redemption.customerEmail),
    status: redemption.status as DiscountRedemption['status'],
    createdAt: new Date(String(redemption.createdAt)).toISOString()
  }));
  assertDiscountCodeUsable(discount, input.email, redemptions);

  let subtotal = 0;
  const quantitiesByProduct = new Map<number, number>();
  for (const item of input.items) {
    quantitiesByProduct.set(item.productId, (quantitiesByProduct.get(item.productId) ?? 0) + item.quantity);
  }
  for (const [productId, quantity] of quantitiesByProduct) {
    const lotsResult = await database.query(
      `SELECT l.precio_venta, ss.cantidad_disponible
         FROM Lotes l JOIN Stock_Sucursal ss ON ss.id_lote = l.id_lote
        WHERE l.id_producto = $1 AND ss.id_sucursal = $2 AND ss.cantidad_disponible > 0
        ORDER BY l.fecha_vencimiento ASC, l.id_lote ASC`,
      [productId, input.branchId]
    );
    let remaining = quantity;
    let productSubtotal = 0;
    for (const row of lotsResult.rows) {
      const taken = Math.min(remaining, Number(row.cantidad_disponible));
      productSubtotal += taken * Number(row.precio_venta);
      remaining -= taken;
      if (remaining <= 0) break;
    }
    if (remaining > 0) {
      throw new Error(`Existencias insuficientes en la sucursal para el producto ${productId}`);
    }
    subtotal += productSubtotal;
  }
  if (subtotal <= 0) throw new Error('El carrito estÃ¡ vacÃ­o');
  const discountAmount = calculateDiscountAmount(subtotal, discount.type, discount.value);
  return { code: discount.code, subtotal, discountAmount, total: subtotal - discountAmount };
}

/**
 * Elimina un producto. Si ya posee historial de ventas registradas, aplica una baja lÃ³gica
 * marcÃ¡ndolo como inactivo y poniendo su stock a cero para preservar la integridad referencial.
 */
export async function deleteDatabaseProduct(id: number) {
  const database = requirePool();
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE Productos ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true');

    const check = await client.query('SELECT id_producto FROM Productos WHERE id_producto = $1', [id]);
    if (!check.rows[0]) {
      throw new Error(`Producto #${id} no encontrado`);
    }

    let hasSales = false;
    try {
      const salesCheck = await client.query(
        `SELECT 1 FROM Detalle_Facturas df
           JOIN Lotes l ON l.id_lote = df.id_lote
          WHERE l.id_producto = $1
          LIMIT 1`,
        [id]
      );
      if (salesCheck.rows.length > 0) {
        hasSales = true;
      }
    } catch {
      // Ignora si la tabla no existe
    }

    if (hasSales) {
      await client.query(
        `UPDATE Productos
            SET activo = false, ultima_modificacion = CURRENT_TIMESTAMP
          WHERE id_producto = $1`,
        [id]
      );
      await client.query(
        `UPDATE Stock_Sucursal
            SET cantidad_disponible = 0, ultima_modificacion = CURRENT_TIMESTAMP
          WHERE id_lote IN (SELECT id_lote FROM Lotes WHERE id_producto = $1)`,
        [id]
      );
      await client.query('COMMIT');
      return { id, deleted: true, softDeleted: true };
    }

    try {
      await client.query(
        `DELETE FROM Stock_Sucursal
          WHERE id_lote IN (SELECT id_lote FROM Lotes WHERE id_producto = $1)`,
        [id]
      );
      await client.query('DELETE FROM Lotes WHERE id_producto = $1', [id]);
      const result = await client.query(
        'DELETE FROM Productos WHERE id_producto = $1 RETURNING id_producto AS id',
        [id]
      );
      await client.query('COMMIT');
      return { id: Number(result.rows[0].id), deleted: true };
    } catch {
      await client.query('ROLLBACK');
      await client.query('BEGIN');
      await client.query(
        `UPDATE Productos
            SET activo = false, ultima_modificacion = CURRENT_TIMESTAMP
          WHERE id_producto = $1`,
        [id]
      );
      await client.query(
        `UPDATE Stock_Sucursal
            SET cantidad_disponible = 0, ultima_modificacion = CURRENT_TIMESTAMP
          WHERE id_lote IN (SELECT id_lote FROM Lotes WHERE id_producto = $1)`,
        [id]
      );
      await client.query('COMMIT');
      return { id, deleted: true, softDeleted: true };
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Actualiza los atributos de un producto y opcionalmente sus lotes de inventario */
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
    ['sanitaryRegistry', 'registro_sanitario'],
    ['controlledProduct', 'producto_controlado'],
    ['chronicUse', 'uso_cronico'],
    ['avoidPregnancy', 'evitar_embarazo'],
    ['requiresRefrigeration', 'requiere_refrigeracion']
  ];
  if (input.sanitaryRegistry !== undefined) {
    const current = await database.query('SELECT registro_sanitario AS "sanitaryRegistry" FROM Productos WHERE id_producto = $1 LIMIT 1', [id]);
    if (!current.rows[0]) throw new Error(`Producto #${id} no encontrado`);
    const nextRegistry = String(input.sanitaryRegistry).trim();
    if (hasSanitaryRegistryChanged(current.rows[0].sanitaryRegistry, nextRegistry)) {
      const duplicate = await database.query('SELECT 1 FROM Productos WHERE registro_sanitario = $1 AND id_producto <> $2 LIMIT 1', [nextRegistry, id]);
      if (duplicate.rowCount) throw new Error('Ya existe otro medicamento con ese registro sanitario');
    }
  }
  if ('imageUrl' in input) fields.push(['imagen_url', input.imageUrl]);
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
                producto_controlado AS "controlledProduct", uso_cronico AS "chronicUse",
                evitar_embarazo AS "avoidPregnancy", requiere_refrigeracion AS "requiresRefrigeration",
                marca AS brand, laboratorio AS laboratory, presentacion AS presentation,
                unidad_medida AS "unitMeasure", registro_sanitario AS "sanitaryRegistry",
                imagen_url AS "imageUrl"`,
    [id, ...fields.map(([, value]) => value)]
  );
  if (!result.rows[0]) throw new Error(`Producto #${id} no encontrado`);
  if (input.ingredients !== undefined) {
    await database.query('DELETE FROM pharmacy_product_ingredients WHERE product_id = $1', [id]);
    for (const ingredient of input.ingredients as Array<Record<string, unknown>>) {
      const name = String(ingredient.ingredient ?? '').trim();
      if (name) await database.query(
        `INSERT INTO pharmacy_product_ingredients (product_id, ingredient, quantity, concentration, principal) VALUES ($1, $2, $3, $4, $5)`,
        [id, name, String(ingredient.quantity ?? '').trim(), String(ingredient.concentration ?? '').trim(), Boolean(ingredient.principal)]
      );
    }
  }

  if (input.price !== undefined || input.cost !== undefined) {
    const lotUpdates: string[] = [];
    const lotParams: unknown[] = [id];
    if (input.price !== undefined && !Number.isNaN(Number(input.price))) {
      lotParams.push(Number(input.price));
      lotUpdates.push(`precio_venta = $${lotParams.length}`);
    }
    if (input.cost !== undefined && !Number.isNaN(Number(input.cost))) {
      lotParams.push(Number(input.cost));
      lotUpdates.push(`precio_costo = $${lotParams.length}`);
    }
    if (lotUpdates.length > 0) {
      await database.query(
        `UPDATE Lotes SET ${lotUpdates.join(', ')} WHERE id_producto = $1`,
        lotParams
      );
    }
  }

  return {
    ...result.rows[0],
    price: input.price !== undefined ? Number(input.price) : 0,
    cost: input.cost !== undefined ? Number(input.cost) : 0,
    description: typeof input.description === 'string' ? input.description : '',
    ingredients: input.ingredients ?? []
  };
}

// ============================================================================
// CHECKOUT Y PROCESAMIENTO DE COMPRAS (TRANSACCIÃ“N ATÃ“MICA FEFO)
// ============================================================================

/**
 * Realiza el proceso de compra completo dentro de una transacciÃ³n PostgreSQL aislada:
 * 1. Upsert del cliente por NIT.
 * 2. DeducciÃ³n de inventario respetando FEFO (`ORDER BY fecha_vencimiento ASC`).
 * 3. InserciÃ³n de movimientos de kardex.
 * 4. GeneraciÃ³n de factura fiscal electrÃ³nica y sus partidas detalladas.
 */
export async function createDatabaseCheckout(input: PublicCheckoutInput, options: { source: 'POS'; employeeId: number; stationNumber?: number | null; cashReceived?: number; paymentPending?: boolean } | null = null) {
  const database = requirePool();
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const normalizedDiscountCode = input.discountCode?.trim().toUpperCase() || null;
    let discount: DiscountCode | null = null;
    if (normalizedDiscountCode) {
      const discountResult = await client.query(
        'SELECT * FROM pharmacy_discount_codes WHERE code = $1 FOR UPDATE',
        [normalizedDiscountCode]
      );
      if (!discountResult.rows[0]) throw new Error('El cÃ³digo de descuento no existe');
      discount = mapDatabaseDiscountCode(discountResult.rows[0]);
      const redemptionsResult = await client.query(
        `SELECT discount_code_id AS "discountCodeId", order_id AS "orderId", customer_email AS "customerEmail",
                status, created_at AS "createdAt"
           FROM pharmacy_discount_redemptions
          WHERE discount_code_id = $1 AND status IN ('RESERVED', 'REDEEMED')`,
        [discount.id]
      );
      const redemptions = redemptionsResult.rows.map((redemption) => ({
        discountCodeId: Number(redemption.discountCodeId),
        orderId: Number(redemption.orderId),
        customerEmail: String(redemption.customerEmail),
        status: redemption.status as DiscountRedemption['status'],
        createdAt: new Date(String(redemption.createdAt)).toISOString()
      }));
      assertDiscountCodeUsable(discount, input.customer.email, redemptions);
    }
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

      // Consulta de lotes disponibles ordenados por vencimiento mÃ¡s prÃ³ximo (FEFO)
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
        const reason = options?.source === 'POS' ? 'Venta POS' : 'Reserva de venta web';
        await client.query(`INSERT INTO MovimientoInventario (id_lote, tipo_movimiento, cantidad, motivo) VALUES ($1, 'VENTA', $2, $3)`, [row.id_lote, take, reason]);
        lots.push({ id: Number(row.id_lote), quantity: take, price: Number(row.precio_venta) });
        remaining -= take;
      }
      const itemSubtotal = lots.reduce((sum, lot) => sum + lot.price * lot.quantity, 0);
      items.push({ product, quantity: item.quantity, subtotal: itemSubtotal, lots });
    }

    const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
    const discountAmount = discount ? calculateDiscountAmount(subtotal, discount.type, discount.value) : 0;
    const total = subtotal - discountAmount;
    if (options?.source === 'POS' && options.cashReceived !== undefined && options.cashReceived < total) {
      throw new Error(`El pago es insuficiente. Debe recibir al menos Q${total.toFixed(2)}.`);
    }
    const invoiceResult = await client.query(
      `INSERT INTO Facturas (id_cliente, id_sucursal, id_empleado, puesto_cajero, fecha_emision, correlativo_sat, total_neto,
                             subtotal_bruto, descuento_aplicado, codigo_descuento)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5, $6, $7, $8, $9) RETURNING id_factura`,
      [customer.id_cliente, input.branchId, options?.employeeId ?? null, options?.stationNumber ?? null, `${options?.source ?? 'WEB'}-${Date.now()}`, total, subtotal, discountAmount, discount?.code ?? null]
    );
    const invoiceId = Number(invoiceResult.rows[0].id_factura);
    if (discount) {
      await client.query(
        `INSERT INTO pharmacy_discount_redemptions (discount_code_id, order_id, customer_email, status)
         VALUES ($1, $2, LOWER($3), $4)`,
        [discount.id, invoiceId, input.customer.email.trim(), input.paymentMethod === 'CASH' ? 'REDEEMED' : 'RESERVED']
      );
    }
    for (const item of items) {
      for (const lot of item.lots) {
        await client.query(`INSERT INTO Detalle_Facturas (id_factura, id_lote, cantidad_vendida, precio_venta_aplicado, subtotal) VALUES ($1, $2, $3, $4, $5)`, [invoiceId, lot.id, lot.quantity, lot.price, lot.quantity * lot.price]);
      }
    }
    if (options?.source === 'POS' && !options.paymentPending) {
      const methodResult = await client.query(
        `INSERT INTO MetodosPago (nombre_metodo) VALUES ('Efectivo') ON CONFLICT DO NOTHING RETURNING id_metodo_pago`
      );
      const methodId = methodResult.rows[0]?.id_metodo_pago
        ?? (await client.query(`SELECT id_metodo_pago FROM MetodosPago WHERE LOWER(nombre_metodo) = 'efectivo' LIMIT 1`)).rows[0]?.id_metodo_pago;
      if (!methodId) throw new Error('No se pudo registrar el método de pago en efectivo');
      await client.query(
        `INSERT INTO Pagos (id_factura, id_metodo_pago, transaccion_pasarela_id, monto_pagado)
         VALUES ($1, $2, $3, $4)`,
        [invoiceId, methodId, `cash-${invoiceId}`, total]
      );
    }
    await client.query('COMMIT');
    return {
      order: {
        id: invoiceId,
        code: `${options?.source ?? 'WEB'}-${String(invoiceId).padStart(6, '0')}`,
        source: options?.source ?? 'WEB',
        employeeId: options?.employeeId ?? null,
        stationNumber: options?.stationNumber ?? null,
        subtotal,
        discountAmount,
        discountCode: discount?.code ?? null,
        total,
        deliveryMode: input.deliveryMode,
        status: options?.source === 'POS' && !options.paymentPending ? 'PAID' : 'AWAITING_PAYMENT',
        paymentStatus: options?.source === 'POS' && !options.paymentPending ? 'PAID' : 'PENDING'
      },
      customer,
      items: items.map((item) => ({
        product: {
          id: Number(item.product.id_producto),
          name: String(item.product.nombre_producto),
          description: `${String(item.product.marca)} ${String(item.product.presentacion)}`,
          price: item.subtotal / item.quantity
        },
        quantity: item.quantity,
        subtotal: item.subtotal
      }))
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Registra el comprobante de pago vinculado a una factura (idempotente por transactionId) */
export async function registerDatabasePayment(invoiceId: number, transactionId: string, amount: number) {
  const database = requirePool();
  const method = await database.query(`INSERT INTO MetodosPago (nombre_metodo) VALUES ('Stripe') ON CONFLICT DO NOTHING RETURNING id_metodo_pago`);
  let methodId = method.rows[0]?.id_metodo_pago;
  if (!methodId) methodId = (await database.query(`SELECT id_metodo_pago FROM MetodosPago WHERE LOWER(nombre_metodo) = 'stripe' LIMIT 1`)).rows[0]?.id_metodo_pago;
  // Idempotencia: evita pagos duplicados por mismo transactionId (reintentos de webhook Stripe)
  await database.query(
    `INSERT INTO Pagos (id_factura, id_metodo_pago, transaccion_pasarela_id, monto_pagado)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (transaccion_pasarela_id) DO NOTHING`,
    [invoiceId, methodId, transactionId, amount]
  );
  // Marcar redenciones de descuento como REDEEMED (idempotente por WHERE status=RESERVED)
  await database.query(
    `UPDATE pharmacy_discount_redemptions SET status = 'REDEEMED'
      WHERE order_id = $1 AND status = 'RESERVED'`,
    [invoiceId]
  );
  // Actualizar estado de pago en tracking de delivery (para órdenes web)
  await database.query(
    `UPDATE pharmacy_delivery_tracking SET payment_status = 'PAID', updated_at = NOW()
      WHERE order_code = (SELECT CONCAT('WEB-', LPAD(id_factura::text, 6, '0')) FROM Facturas WHERE id_factura = $1)`,
    [invoiceId]
  );
}

export interface DatabaseInvoiceDataForEmail {
  invoice: Invoice;
  order: Order;
  items: Array<OrderItem & { product: Product }>;
  customer: Customer;
  branch: Branch;
  payment: Payment | null;
  paymentMethod: string;
}

/** Recupera desde PostgreSQL todos los datos que necesita el PDF de una factura. */
export async function getDatabaseInvoiceDataForEmail(invoiceId: number): Promise<DatabaseInvoiceDataForEmail | null> {
  const database = requirePool();
  const invoiceResult = await database.query(
    `SELECT f.id_factura, f.id_cliente, f.id_sucursal, f.id_empleado, f.puesto_cajero, f.fecha_emision, f.correlativo_sat,
            f.total_neto, f.subtotal_bruto, f.descuento_aplicado, f.codigo_descuento,
            c.nombre AS customer_name, c.correo AS customer_email, c.nit AS customer_nit,
            c.telefono AS customer_phone, s.nombre_sucursal
       FROM Facturas f
       JOIN Clientes c ON c.id_cliente = f.id_cliente
       JOIN Sucursales s ON s.id_sucursal = f.id_sucursal
      WHERE f.id_factura = $1
      LIMIT 1`,
    [invoiceId]
  );
  const row = invoiceResult.rows[0];
  if (!row) return null;

  const detailResult = await database.query(
    `SELECT df.id_detalle_factura, df.id_lote, l.id_producto, df.cantidad_vendida,
            df.precio_venta_aplicado, df.subtotal,
            p.sku_codigo, p.nombre_producto, p.id_categoria,
            COALESCE(p.marca, '') AS marca, COALESCE(p.laboratorio, '') AS laboratorio,
            COALESCE(p.presentacion, '') AS presentacion, COALESCE(p.unidad_medida, '') AS unidad_medida,
            COALESCE(p.registro_sanitario, '') AS registro_sanitario,
            COALESCE(p.requiere_receta, false) AS requiere_receta,
            COALESCE(p.producto_controlado, false) AS producto_controlado,
            COALESCE(p.uso_cronico, false) AS uso_cronico,
            COALESCE(p.evitar_embarazo, false) AS evitar_embarazo,
            COALESCE(p.requiere_refrigeracion, false) AS requiere_refrigeracion,
            p.imagen_url
       FROM Detalle_Facturas df
       JOIN Lotes l ON l.id_lote = df.id_lote
       JOIN Productos p ON p.id_producto = l.id_producto
      WHERE df.id_factura = $1
      ORDER BY df.id_detalle_factura`,
    [invoiceId]
  );
  if (!detailResult.rows.length) return null;

  const paymentResult = await database.query(
    `SELECT p.id_pago, p.id_factura, p.transaccion_pasarela_id, p.monto_pagado,
            p.fecha_pago, mp.nombre_metodo
       FROM Pagos p
       LEFT JOIN MetodosPago mp ON mp.id_metodo_pago = p.id_metodo_pago
      WHERE p.id_factura = $1
      ORDER BY p.id_pago DESC
      LIMIT 1`,
    [invoiceId]
  );
  const paymentRow = paymentResult.rows[0];
  const isPosInvoice = String(row.correlativo_sat ?? '').startsWith('POS-');
  const orderCode = `${isPosInvoice ? 'POS' : 'WEB'}-${String(invoiceId).padStart(6, '0')}`;
  const trackingResult = await database.query(
    `SELECT email_status, email_sent_at, email_error, email_attempt_at
       FROM pharmacy_delivery_tracking
      WHERE order_code = $1
      LIMIT 1`,
    [orderCode]
  );
  const tracking = trackingResult.rows[0];
  const issuedAt = new Date(String(row.fecha_emision)).toISOString();
  const total = Number(row.total_neto ?? 0);
  const subtotal = Number(row.subtotal_bruto ?? total);
  const discountAmount = Number(row.descuento_aplicado ?? 0);
  const customer: Customer = {
    id: Number(row.id_cliente), name: String(row.customer_name ?? ''), nit: String(row.customer_nit ?? ''),
    email: String(row.customer_email ?? ''), phone: String(row.customer_phone ?? ''), address: '',
    createdAt: issuedAt, updatedAt: issuedAt
  };
  const invoice: Invoice = {
    id: invoiceId, orderId: invoiceId, invoiceNumber: orderCode,
    satCorrelative: String(row.correlativo_sat ?? ''), issuedAt, total, subtotal, discountAmount,
    discountCode: row.codigo_descuento == null ? null : String(row.codigo_descuento),
    emailStatus: tracking?.email_status, emailSentAt: tracking?.email_sent_at ? new Date(tracking.email_sent_at).toISOString() : null,
    emailError: tracking?.email_error ?? null, emailAttemptAt: tracking?.email_attempt_at ? new Date(tracking.email_attempt_at).toISOString() : null
  };
  const order: Order = {
    id: invoiceId, code: invoice.invoiceNumber, source: isPosInvoice ? 'POS' : 'WEB', branchId: Number(row.id_sucursal), customerId: customer.id,
    customerEmail: customer.email, employeeId: row.id_empleado == null ? null : Number(row.id_empleado),
    stationNumber: row.puesto_cajero == null ? null : Number(row.puesto_cajero),
    deliveryMode: 'PICKUP', address: null, assignedEmployeeId: null,
    deliveryLatitude: null, deliveryLongitude: null, status: paymentRow ? 'PAID' : 'AWAITING_PAYMENT',
    paymentStatus: paymentRow ? 'PAID' : 'PENDING', requiresPrescription: false, prescriptionWebUrl: null,
    prescriptionDeliveryUrl: null, subtotal, discountAmount, discountCode: invoice.discountCode, total,
    createdAt: issuedAt, paidAt: paymentRow?.fecha_pago ? new Date(paymentRow.fecha_pago).toISOString() : null, releasedAt: null
  };
  const items = detailResult.rows.map((item): OrderItem & { product: Product } => ({
    id: Number(item.id_detalle_factura), orderId: invoiceId, productId: Number(item.id_producto),
    quantity: Number(item.cantidad_vendida), unitPrice: Number(item.precio_venta_aplicado), subtotal: Number(item.subtotal), assignedLotIds: [Number(item.id_lote)],
    product: {
      id: Number(item.id_producto), sku: String(item.sku_codigo ?? ''), name: String(item.nombre_producto ?? ''), categoryId: item.id_categoria == null ? null : Number(item.id_categoria),
      brand: String(item.marca), laboratory: String(item.laboratorio), presentation: String(item.presentacion), unitMeasure: String(item.unidad_medida),
      sanitaryRegistry: String(item.registro_sanitario), requiresPrescription: Boolean(item.requiere_receta), controlledProduct: Boolean(item.producto_controlado),
      chronicUse: Boolean(item.uso_cronico), avoidPregnancy: Boolean(item.evitar_embarazo), requiresRefrigeration: Boolean(item.requiere_refrigeracion),
      ingredients: [], active: true, description: '', price: Number(item.precio_venta_aplicado), cost: 0, imageUrl: item.imagen_url == null ? null : String(item.imagen_url)
    }
  }));
  const payment: Payment | null = paymentRow ? {
    id: Number(paymentRow.id_pago), orderId: invoiceId, provider: String(paymentRow.nombre_metodo ?? '').toLowerCase() === 'stripe' ? 'stripe' : String(paymentRow.nombre_metodo ?? '').toLowerCase() === 'efectivo' ? 'cash' : 'demo',
    transactionId: String(paymentRow.transaccion_pasarela_id ?? ''), amount: Number(paymentRow.monto_pagado ?? total), status: 'PAID',
    createdAt: paymentRow.fecha_pago ? new Date(paymentRow.fecha_pago).toISOString() : issuedAt
  } : null;
  return { invoice, order, items, customer, branch: { id: Number(row.id_sucursal), name: String(row.nombre_sucursal ?? ''), city: '', address: '' }, payment, paymentMethod: String(paymentRow?.nombre_metodo ?? 'No especificado') };
}

export async function releaseDatabaseDiscountRedemption(invoiceId: number) {
  const database = requirePool();
  await database.query(
    `UPDATE pharmacy_discount_redemptions SET status = 'RELEASED'
      WHERE order_id = $1 AND status = 'RESERVED'`,
    [invoiceId]
  );
}

export async function markDatabaseDiscountRedeemed(invoiceId: number) {
  const database = requirePool();
  await database.query(
    `UPDATE pharmacy_discount_redemptions SET status = 'REDEEMED'
      WHERE order_id = $1 AND status = 'RESERVED'`,
    [invoiceId]
  );
}

/**
 * Reserva el envío de correo (transición atómica PENDING/FAILED → SENDING).
 * Retorna true solo si la factura estaba en PENDING (primer envío) o FAILED (reintento).
 * Bloquea envíos concurrentes para la misma factura.
 */
export async function reserveDatabaseInvoiceEmailSend(invoiceId: number): Promise<boolean> {
  const database = requirePool();
  const result = await database.query(
    `UPDATE pharmacy_delivery_tracking
       SET email_status = 'SENDING', email_attempt_at = NOW(), email_error = NULL, updated_at = NOW()
     WHERE order_code = (SELECT CONCAT('WEB-', LPAD(id_factura::text, 6, '0')) FROM Facturas WHERE id_factura = $1)
       AND email_status IN ('PENDING', 'FAILED')
     RETURNING id`,
    [invoiceId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Marca el envío como exitoso (transición SENDING → SENT).
 * Solo tiene efecto si estaba en SENDING.
 */
export async function markDatabaseInvoiceEmailSent(invoiceId: number): Promise<boolean> {
  const database = requirePool();
  const result = await database.query(
    `UPDATE pharmacy_delivery_tracking
       SET email_status = 'SENT', email_sent_at = NOW(), email_error = NULL, updated_at = NOW()
     WHERE order_code = (SELECT CONCAT('WEB-', LPAD(id_factura::text, 6, '0')) FROM Facturas WHERE id_factura = $1)
       AND email_status = 'SENDING'
     RETURNING id`,
    [invoiceId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Marca el envío como fallido (transición SENDING → FAILED).
 * Guarda el error para diagnóstico y permite reintentos.
 */
export async function markDatabaseInvoiceEmailFailed(invoiceId: number, error: string): Promise<boolean> {
  const database = requirePool();
  const result = await database.query(
    `UPDATE pharmacy_delivery_tracking
       SET email_status = 'FAILED', email_error = $2, updated_at = NOW()
     WHERE order_code = (SELECT CONCAT('WEB-', LPAD(id_factura::text, 6, '0')) FROM Facturas WHERE id_factura = $1)
       AND email_status = 'SENDING'
     RETURNING id`,
    [invoiceId, error.slice(0, 500)]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Obtiene el estado de envío de correo de una factura.
 */
export async function getDatabaseInvoiceEmailStatus(invoiceId: number): Promise<{ email_status: string; email_error: string | null; email_attempt_at: string | null } | null> {
  const database = requirePool();
  const result = await database.query(
    `SELECT email_status, email_error, email_attempt_at
       FROM pharmacy_delivery_tracking
      WHERE order_code = (SELECT CONCAT('WEB-', LPAD(id_factura::text, 6, '0')) FROM Facturas WHERE id_factura = $1)
      LIMIT 1`,
    [invoiceId]
  );
  return result.rows[0] ?? null;
}

/**
 * Recupera correos atascados en estado SENDING por más de 10 minutos (versión PostgreSQL).
 * Operación atómica con UPDATE ... WHERE email_status = 'SENDING' AND email_attempt_at < NOW() - interval.
 * Retorna el número de facturas recuperadas.
 *
 * En PostgreSQL, esta operación es atómica y segura para múltiples instancias concurrentes.
 * Se recomienda ejecutar periódicamente (ej. cron job cada 5-10 min) o vía pg_cron.
 */
export async function recoverDatabaseStuckSendingEmails(maxAgeMinutes: number = 10): Promise<number> {
  const database = requirePool();
  const result = await database.query(
    `UPDATE pharmacy_delivery_tracking
       SET email_status = 'FAILED',
           email_error = 'Recuperado automáticamente: envío SENDING por más de $1 minutos (último intento: ' || email_attempt_at || ')',
           updated_at = NOW()
     WHERE email_status = 'SENDING'
       AND email_attempt_at < NOW() - ($1 || ' minutes')::interval
     RETURNING id`,
    [maxAgeMinutes]
  );
  const recovered = result.rowCount ?? 0;
  if (recovered > 0) {
    console.log(`[DB] Recuperados ${recovered} correos atascados en SENDING (>${maxAgeMinutes} min) → FAILED`);
  }
  return recovered;
}

/**
 * Reintenta el envío de correos en estado FAILED (versión PostgreSQL).
 * Implementa límite de intentos y espera progresiva usando email_attempt_count.
 * Requiere que la tabla tenga columna email_attempt_count (añadir migración si no existe).
 * Retorna { attempted: number, succeeded: number, failed: number }.
 *
 * NOTA: Para producción completa, añadir columna email_attempt_count INTEGER DEFAULT 0 a pharmacy_delivery_tracking
 * y usar advisory locks (pg_advisory_xact_lock) para evitar reintentos concurrentes en múltiples instancias.
 */
export async function retryDatabaseFailedEmails(
  maxAttempts: number = 3,
  baseDelayMs: number = 60000,
  sendFn: (params: { customerEmail: string; customerName: string; orderCode: string; invoiceNumber: string; total: number; pdfBuffer: Buffer; isOnline: boolean }) => Promise<{ success: boolean; messageId?: string; error?: string }>
): Promise<{ attempted: number; succeeded: number; failed: number }> {
  const database = requirePool();

  // Asegurar columna de contador de intentos (idempotente)
  await database.query(`ALTER TABLE pharmacy_delivery_tracking ADD COLUMN IF NOT EXISTS email_attempt_count INTEGER NOT NULL DEFAULT 0`);

  // Obtener facturas FAILED con intentos < maxAttempts
  const result = await database.query(
    `SELECT dt.id, dt.order_code, dt.email_attempt_count, dt.email_error,
            f.id_factura AS invoice_id, f.invoice_number, f.total_neto AS total,
            c.email AS customer_email, c.full_name AS customer_name,
            f.id_cliente
       FROM pharmacy_delivery_tracking dt
       JOIN Facturas f ON f.id_factura = (SELECT id_factura FROM Facturas WHERE CONCAT('WEB-', LPAD(id_factura::text, 6, '0')) = dt.order_code LIMIT 1)
       JOIN Clientes c ON c.id_cliente = f.id_cliente
      WHERE dt.email_status = 'FAILED'
        AND dt.email_attempt_count < $1
      ORDER BY dt.email_attempt_at ASC`,
    [maxAttempts]
  );

  let attempted = 0, succeeded = 0, failed = 0;

  for (const row of result.rows) {
    const invoiceId = Number(row.invoice_id);
    const attemptCount = Number(row.email_attempt_count);

    // Bloqueo por factura para evitar reintentos concurrentes (advisory lock)
    const lockResult = await database.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [invoiceId]);
    if (!lockResult.rows[0]?.locked) {
      console.log(`[DB] Reintento omitido: no se pudo obtener lock para factura ${invoiceId}`);
      continue;
    }

    // Verificar estado actual bajo lock
    const statusCheck = await database.query(
      `SELECT email_status, email_attempt_count FROM pharmacy_delivery_tracking WHERE id = $1`,
      [row.id]
    );
    if (statusCheck.rows[0]?.email_status !== 'FAILED') {
      console.log(`[DB] Reintento omitido: factura ${invoiceId} ya no en FAILED`);
      continue;
    }

    attempted++;

    try {
      // Reservar atómicamente (FAILED → SENDING) e incrementar contador
      const reserveResult = await database.query(
        `UPDATE pharmacy_delivery_tracking
           SET email_status = 'SENDING', email_attempt_at = NOW(), email_error = NULL, email_attempt_count = email_attempt_count + 1, updated_at = NOW()
         WHERE id = $1 AND email_status = 'FAILED'
         RETURNING id`,
        [row.id]
      );
      if (reserveResult.rowCount === 0) {
        console.log(`[DB] Reintento omitido: factura ${invoiceId} estado cambiado concurrentemente`);
        attempted--;
        continue;
      }

      // Generar PDF (usar función del store en memoria para consistencia, o implementar versión DB)
      // Aquí asumimos que el llamador pasa una función que genera el PDF
      // En implementación completa, generar PDF desde datos DB

      // Espera progresiva (backoff exponencial)
      const delay = baseDelayMs * Math.pow(2, attemptCount);
      if (delay > 0) await new Promise(r => setTimeout(r, delay));

      // Enviar correo - requiere que sendFn genere el PDF internamente o se pase pdfBuffer
      // Por simplicidad, delegamos al llamador la generación de PDF
      const pdfBuffer = Buffer.from(''); // Placeholder - en uso real se genera

      const result = await sendFn({
        customerEmail: String(row.customer_email),
        customerName: String(row.customer_name),
        orderCode: String(row.order_code),
        invoiceNumber: String(row.invoice_number),
        total: Number(row.total),
        pdfBuffer,
        isOnline: true
      });

      if (result.success) {
        await database.query(
          `UPDATE pharmacy_delivery_tracking
             SET email_status = 'SENT', email_sent_at = NOW(), email_error = NULL, updated_at = NOW()
           WHERE id = $1`,
          [row.id]
        );
        succeeded++;
        console.log(`[DB] Reintento exitoso: factura ${invoiceId} → SENT (MessageID: ${result.messageId})`);
      } else {
        await database.query(
          `UPDATE pharmacy_delivery_tracking
             SET email_status = 'FAILED', email_error = $2, updated_at = NOW()
           WHERE id = $1`,
          [row.id, (result.error ?? 'Error SMTP en reintento').slice(0, 500)]
        );
        failed++;
        console.error(`[DB] Reintento fallido: factura ${invoiceId} → FAILED (${result.error})`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Error desconocido en reintento';
      await database.query(
        `UPDATE pharmacy_delivery_tracking
           SET email_status = 'FAILED', email_error = $2, updated_at = NOW()
         WHERE id = $1`,
        [row.id, errorMsg.slice(0, 500)]
      );
      failed++;
      console.error(`[DB] Excepción en reintento factura ${invoiceId}:`, errorMsg);
    }
  }

  return { attempted, succeeded, failed };
}

// ============================================================================
// IDEMPOTENCIA POS - VERSIÓN POSTGRESQL (PERSISTENTE)
// ============================================================================

/**
 * Verifica y reserva una clave de idempotencia POS en PostgreSQL.
 * Operación atómica: INSERT ... ON CONFLICT DO NOTHING + SELECT.
 * Retorna { isDuplicate: boolean, existingOrderId?: number, fingerprintMatch?: boolean }.
 * Si la clave existe y la huella coincide → replay idempotente.
 * Si la clave existe pero la huella NO coincide → conflicto (409).
 * Si la clave no existe → permite nueva venta.
 */
export async function checkAndReserveDatabasePosIdempotency(
  keyHash: string,
  employeeId: number,
  branchId: number,
  requestFingerprint: string,
  ttlMinutes: number = 5
): Promise<{ isDuplicate: boolean; existingOrderId?: number; fingerprintMatch?: boolean }> {
  const database = requirePool();
  const client = await database.connect();
  try {
    await client.query('BEGIN');

    // Limpiar claves expiradas
    await client.query('DELETE FROM pharmacy_pos_idempotency_keys WHERE expires_at < NOW()');

    // Intentar insertar la clave (reserva atómica)
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    const insertResult = await client.query(
      `INSERT INTO pharmacy_pos_idempotency_keys (key_hash, employee_id, branch_id, order_id, request_fingerprint, expires_at)
       VALUES ($1, $2, $3, 0, $4, $5)
       ON CONFLICT (key_hash) DO NOTHING
       RETURNING id, order_id, request_fingerprint`,
      [keyHash, employeeId, branchId, requestFingerprint, expiresAt]
    );

    if (insertResult.rowCount && insertResult.rowCount > 0) {
      // Clave nueva insertada - no es duplicado
      await client.query('COMMIT');
      return { isDuplicate: false };
    }

    // La clave ya existía - verificar huella y order_id
    const selectResult = await client.query(
      `SELECT order_id, request_fingerprint FROM pharmacy_pos_idempotency_keys WHERE key_hash = $1`,
      [keyHash]
    );

    await client.query('COMMIT');

    if (!selectResult.rows[0]) {
      return { isDuplicate: false }; // Caso borde: eliminada entre INSERT y SELECT
    }

    const existing = selectResult.rows[0];
    const fingerprintMatch = existing.request_fingerprint === requestFingerprint;
    return {
      isDuplicate: true,
      existingOrderId: Number(existing.order_id),
      fingerprintMatch
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Confirma la clave de idempotencia POS asociándola al orderId real.
 * Debe llamarse SOLO tras crear la venta exitosamente.
 * Actualiza order_id de 0 al ID real.
 */
export async function confirmDatabasePosIdempotency(keyHash: string, orderId: number): Promise<boolean> {
  const database = requirePool();
  const result = await database.query(
    `UPDATE pharmacy_pos_idempotency_keys SET order_id = $2 WHERE key_hash = $1 AND order_id = 0`,
    [keyHash, orderId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Limpia claves de idempotencia POS expiradas.
 * Retorna número de claves eliminadas.
 */
export async function cleanupExpiredDatabasePosIdempotencyKeys(): Promise<number> {
  const database = requirePool();
  const result = await database.query('DELETE FROM pharmacy_pos_idempotency_keys WHERE expires_at < NOW()');
  return result.rowCount ?? 0;
}

/**
 * Obtiene el orderId asociado a una clave de idempotencia (para replay).
 */
export async function getDatabasePosIdempotencyOrderId(keyHash: string): Promise<number | null> {
  const database = requirePool();
  const result = await database.query(
    `SELECT order_id FROM pharmacy_pos_idempotency_keys WHERE key_hash = $1 AND expires_at > NOW()`,
    [keyHash]
  );
  return result.rows[0] ? Number(result.rows[0].order_id) : null;
}

// ============================================================================
// INICIALIZACIÃ“N, MIGRACIONES DINÃMICAS Y PERSISTENCIA DE ESTADO
// ============================================================================

/**
 * Ejecuta las migraciones estructurales si no existen las tablas necesarias en la base de datos.
 */
export async function initializeDatabase() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pharmacy_state (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      snapshot JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('ALTER TABLE Empleados ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true');
  await pool.query("UPDATE Empleados SET activo = false WHERE COALESCE(contrasena, '') = '' AND activo = true");
  await pool.query('ALTER TABLE Empleados ADD COLUMN IF NOT EXISTS puesto INTEGER');
  await pool.query('ALTER TABLE Facturas ADD COLUMN IF NOT EXISTS id_empleado INTEGER');
  await pool.query('ALTER TABLE Facturas ADD COLUMN IF NOT EXISTS puesto_cajero INTEGER');
  await pool.query(`
    WITH unassigned_employees AS (
      SELECT id_empleado, id_sucursal, rol_usuario,
             ROW_NUMBER() OVER (PARTITION BY id_sucursal, rol_usuario ORDER BY id_empleado) AS employee_rank
        FROM Empleados
       WHERE rol_usuario IN ('Cajero', 'Repartidor')
         AND id_sucursal IS NOT NULL
         AND COALESCE(activo, true) = true
         AND COALESCE(contrasena, '') <> ''
         AND puesto IS NULL
    ),
    free_stations AS (
      SELECT branch_roles.id_sucursal, branch_roles.rol_usuario, station.number AS station_number,
             ROW_NUMBER() OVER (PARTITION BY branch_roles.id_sucursal, branch_roles.rol_usuario ORDER BY station.number) AS station_rank
        FROM (
          SELECT DISTINCT id_sucursal, rol_usuario
            FROM unassigned_employees
        ) branch_roles
        CROSS JOIN generate_series(1, 7) AS station(number)
       WHERE NOT EXISTS (
         SELECT 1
           FROM Empleados occupied
          WHERE occupied.id_sucursal = branch_roles.id_sucursal
            AND occupied.rol_usuario = branch_roles.rol_usuario
            AND occupied.puesto = station.number
            AND COALESCE(occupied.activo, true) = true
            AND COALESCE(occupied.contrasena, '') <> ''
       )
    ),
    assignments AS (
      SELECT unassigned_employees.id_empleado, free_stations.station_number
        FROM unassigned_employees
        JOIN free_stations
          ON free_stations.id_sucursal = unassigned_employees.id_sucursal
         AND free_stations.rol_usuario = unassigned_employees.rol_usuario
         AND free_stations.station_rank = unassigned_employees.employee_rank
    )
    UPDATE Empleados employee
       SET puesto = assignments.station_number
      FROM assignments
     WHERE employee.id_empleado = assignments.id_empleado
  `);
  await pool.query(`
    DROP INDEX IF EXISTS ux_empleados_sucursal_rol_puesto_activo;
    CREATE UNIQUE INDEX ux_empleados_sucursal_rol_puesto_activo
      ON Empleados (id_sucursal, rol_usuario, puesto)
      WHERE puesto IS NOT NULL
        AND COALESCE(activo, true) = true
        AND contrasena IS NOT NULL
        AND contrasena <> ''
        AND rol_usuario IN ('Cajero', 'Repartidor')
  `);
  await pool.query('ALTER TABLE Productos ADD COLUMN IF NOT EXISTS imagen_url TEXT');
  await pool.query('ALTER TABLE Productos ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true');
  await pool.query('ALTER TABLE Productos ADD COLUMN IF NOT EXISTS producto_controlado BOOLEAN NOT NULL DEFAULT false');
  await pool.query('ALTER TABLE Productos ADD COLUMN IF NOT EXISTS uso_cronico BOOLEAN NOT NULL DEFAULT false');
  await pool.query('ALTER TABLE Productos ADD COLUMN IF NOT EXISTS evitar_embarazo BOOLEAN NOT NULL DEFAULT false');
  await pool.query('ALTER TABLE Productos ADD COLUMN IF NOT EXISTS requiere_refrigeracion BOOLEAN NOT NULL DEFAULT false');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pharmacy_product_ingredients (
      id BIGSERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES Productos(id_producto) ON DELETE CASCADE,
      ingredient TEXT NOT NULL,
      quantity TEXT NOT NULL DEFAULT '',
      concentration TEXT NOT NULL DEFAULT '',
      principal BOOLEAN NOT NULL DEFAULT false
    )
  `);
  await pool.query(`
    DO $$
    DECLARE duplicate RECORD;
    BEGIN
      FOR duplicate IN
        SELECT p.id_producto AS duplicate_id, canonical.canonical_id
          FROM Productos p
          JOIN (
            SELECT UPPER(TRIM(sku_codigo)) AS normalized_sku, MIN(id_producto) AS canonical_id
              FROM Productos
             WHERE COALESCE(TRIM(sku_codigo), '') <> ''
             GROUP BY UPPER(TRIM(sku_codigo))
            HAVING COUNT(*) > 1
          ) canonical ON canonical.normalized_sku = UPPER(TRIM(p.sku_codigo))
         WHERE p.id_producto <> canonical.canonical_id
      LOOP
        UPDATE Lotes SET id_producto = duplicate.canonical_id WHERE id_producto = duplicate.duplicate_id;
        DELETE FROM Productos WHERE id_producto = duplicate.duplicate_id;
      END LOOP;
    END $$;
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_productos_sku_codigo
      ON Productos (UPPER(TRIM(sku_codigo)))
      WHERE COALESCE(TRIM(sku_codigo), '') <> ''
  `);
  await pool.query(`
    WITH duplicates AS (
      SELECT id_producto, ROW_NUMBER() OVER (PARTITION BY registro_sanitario ORDER BY id_producto) AS duplicate_number
      FROM Productos WHERE COALESCE(registro_sanitario, '') <> ''
    )
    UPDATE Productos p
       SET registro_sanitario = 'MSPAS-2026-' || LPAD((p.id_producto % 10000)::text, 4, '0')
      FROM duplicates d
      WHERE p.id_producto = d.id_producto AND d.duplicate_number > 1
  `);
  await pool.query("ALTER TABLE Proveedores ADD COLUMN IF NOT EXISTS nombre_contacto TEXT NOT NULL DEFAULT ''");
  await pool.query('ALTER TABLE Facturas ADD COLUMN IF NOT EXISTS subtotal_bruto NUMERIC(12, 2)');
  await pool.query('ALTER TABLE Facturas ADD COLUMN IF NOT EXISTS descuento_aplicado NUMERIC(12, 2) NOT NULL DEFAULT 0');
  await pool.query('ALTER TABLE Facturas ADD COLUMN IF NOT EXISTS codigo_descuento TEXT');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pharmacy_customer_accounts (
      id BIGSERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      phone TEXT NOT NULL,
      nit TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS pharmacy_delivery_tracking (
      id BIGSERIAL PRIMARY KEY,
      order_code TEXT NOT NULL UNIQUE,
      customer_account_id BIGINT REFERENCES pharmacy_customer_accounts(id),
      branch_id INTEGER NOT NULL,
      assigned_employee_id INTEGER,
      address TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'CREATED',
      latitude NUMERIC,
      longitude NUMERIC,
      rider_latitude NUMERIC,
      rider_longitude NUMERIC,
      total NUMERIC(12, 2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query('ALTER TABLE pharmacy_customer_accounts ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT \'\'');
  await pool.query('ALTER TABLE pharmacy_delivery_tracking ADD COLUMN IF NOT EXISTS latitude NUMERIC');
  await pool.query('ALTER TABLE pharmacy_delivery_tracking ADD COLUMN IF NOT EXISTS longitude NUMERIC');
  await pool.query('ALTER TABLE pharmacy_delivery_tracking ADD COLUMN IF NOT EXISTS rider_latitude NUMERIC');
  await pool.query('ALTER TABLE pharmacy_delivery_tracking ADD COLUMN IF NOT EXISTS rider_longitude NUMERIC');
  await pool.query('ALTER TABLE pharmacy_delivery_tracking ADD COLUMN IF NOT EXISTS total NUMERIC(12, 2) NOT NULL DEFAULT 0');
  await pool.query(`
    UPDATE pharmacy_delivery_tracking tracking
       SET total = invoice.total_neto
      FROM Facturas invoice
     WHERE tracking.order_code ~ '^WEB-[0-9]+$'
       AND substring(tracking.order_code from 5)::BIGINT = invoice.id_factura
       AND tracking.total = 0
  `);
  await pool.query('ALTER TABLE pharmacy_delivery_tracking ADD COLUMN IF NOT EXISTS assigned_employee_id INTEGER');
  await pool.query('ALTER TABLE pharmacy_delivery_tracking ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT \'PENDING\'');
  await pool.query('ALTER TABLE pharmacy_delivery_tracking ADD COLUMN IF NOT EXISTS email_status TEXT NOT NULL DEFAULT \'PENDING\'');
  await pool.query('ALTER TABLE pharmacy_delivery_tracking ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ');
  await pool.query('ALTER TABLE pharmacy_delivery_tracking ADD COLUMN IF NOT EXISTS email_error TEXT');
  await pool.query('ALTER TABLE pharmacy_delivery_tracking ADD COLUMN IF NOT EXISTS email_attempt_at TIMESTAMPTZ');
  await pool.query('CREATE INDEX IF NOT EXISTS pharmacy_delivery_tracking_assignee_idx ON pharmacy_delivery_tracking (branch_id, assigned_employee_id)');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pharmacy_discount_codes (
      id BIGSERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      discount_type TEXT NOT NULL CHECK (discount_type IN ('PERCENTAGE', 'FIXED')),
      discount_value NUMERIC(12, 2) NOT NULL CHECK (discount_value > 0),
      max_uses INTEGER NOT NULL CHECK (max_uses > 0),
      starts_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (expires_at IS NULL OR starts_at IS NULL OR expires_at > starts_at)
    );
    CREATE TABLE IF NOT EXISTS pharmacy_discount_redemptions (
      id BIGSERIAL PRIMARY KEY,
      discount_code_id BIGINT NOT NULL REFERENCES pharmacy_discount_codes(id),
      order_id BIGINT NOT NULL,
      customer_email TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('RESERVED', 'REDEEMED', 'RELEASED')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS pharmacy_discount_redemptions_usage_idx
      ON pharmacy_discount_redemptions (discount_code_id, status);
    CREATE UNIQUE INDEX IF NOT EXISTS pharmacy_discount_redemptions_customer_idx
      ON pharmacy_discount_redemptions (discount_code_id, LOWER(customer_email))
      WHERE status IN ('RESERVED', 'REDEEMED');
  `);

  // Tabla de claves de idempotencia POS (persistente, sobrevive a reinicios)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pharmacy_pos_idempotency_keys (
      id BIGSERIAL PRIMARY KEY,
      key_hash TEXT NOT NULL UNIQUE,
      employee_id INTEGER NOT NULL,
      branch_id INTEGER NOT NULL,
      order_id BIGINT NOT NULL,
      request_fingerprint TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS pharmacy_pos_idempotency_keys_expires_idx
      ON pharmacy_pos_idempotency_keys (expires_at);
  `);

  // Asegurar columna email_attempt_count en pharmacy_delivery_tracking
  await pool.query('ALTER TABLE pharmacy_delivery_tracking ADD COLUMN IF NOT EXISTS email_attempt_count INTEGER NOT NULL DEFAULT 0');
}

/** Carga el snapshot de estado en formato JSONB de la base de datos */
export async function loadDatabaseSnapshot(): Promise<DataSnapshot | null> {
  if (!pool) return null;
  const result = await pool.query<{ snapshot: DataSnapshot }>('SELECT snapshot FROM pharmacy_state WHERE id = 1');
  return result.rows[0]?.snapshot ?? null;
}

/** Guarda el snapshot de estado en formato JSONB para sincronizaciÃ³n */
export async function saveDatabaseSnapshot(snapshot: DataSnapshot) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO pharmacy_state (id, snapshot, updated_at)
     VALUES (1, $1::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET snapshot = EXCLUDED.snapshot, updated_at = NOW()`,
    [JSON.stringify(snapshot)]
  );
}

/** Obtiene una orden por ID desde PostgreSQL */
export async function getDatabaseOrderById(orderId: number): Promise<Order | null> {
  if (!pool) return null;
  const result = await pool.query(
    `SELECT o.id_pedido AS id, o.codigo AS code, o.origen AS source, o.id_sucursal AS branchId,
            o.id_cliente AS customerId, o.email_cliente AS customerEmail, o.id_empleado AS employeeId,
            o.modo_entrega AS deliveryMode, o.direccion AS address, o.id_repartidor AS assignedEmployeeId,
            o.latitud AS deliveryLatitude, o.longitud AS deliveryLongitude, o.estado AS status,
            o.estado_pago AS paymentStatus, o.requiere_receta AS requiresPrescription,
            o.receta_url AS prescriptionWebUrl, o.receta_entrega_url AS prescriptionDeliveryUrl,
            o.subtotal, o.descuento AS discountAmount, o.codigo_descuento AS discountCode,
            o.total_neto AS total, o.fecha_emision AS createdAt, o.fecha_pago AS paidAt,
            o.fecha_liberacion AS releasedAt
       FROM Pedidos o
      WHERE o.id_pedido = $1
      LIMIT 1`,
    [orderId]
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return {
    id: Number(row.id),
    code: row.code,
    source: row.source,
    branchId: Number(row.branchId),
    customerId: Number(row.customerId),
    customerEmail: row.customerEmail,
    employeeId: row.employeeId ? Number(row.employeeId) : null,
    deliveryMode: row.deliveryMode,
    address: row.address,
    assignedEmployeeId: row.assignedEmployeeId ? Number(row.assignedEmployeeId) : null,
    deliveryLatitude: row.deliveryLatitude ? Number(row.deliveryLatitude) : null,
    deliveryLongitude: row.deliveryLongitude ? Number(row.deliveryLongitude) : null,
    status: row.status,
    paymentStatus: row.paymentStatus,
    requiresPrescription: Boolean(row.requiresPrescription),
    prescriptionWebUrl: row.prescriptionWebUrl,
    prescriptionDeliveryUrl: row.prescriptionDeliveryUrl,
    subtotal: Number(row.subtotal ?? 0),
    discountAmount: Number(row.discountAmount ?? 0),
    discountCode: row.discountCode,
    total: Number(row.total),
    createdAt: row.createdAt,
    paidAt: row.paidAt,
    releasedAt: row.releasedAt
  };
}

/** Obtiene una factura por ID de orden desde PostgreSQL */
export async function getDatabaseInvoiceByOrderId(orderId: number): Promise<Invoice | null> {
  if (!pool) return null;
  const result = await pool.query(
    `SELECT f.id_factura, f.id_pedido, f.fecha_emision, f.correlativo_sat,
            f.subtotal_bruto, f.descuento_aplicado, f.codigo_descuento, f.total_neto
       FROM Facturas f
      WHERE f.id_pedido = $1
      LIMIT 1`,
    [orderId]
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return {
    id: Number(row.id_factura),
    orderId: Number(row.id_pedido),
    invoiceNumber: `WEB-${String(row.id_factura).padStart(6, '0')}`,
    satCorrelative: String(row.correlativo_sat ?? ''),
    issuedAt: new Date(row.fecha_emision).toISOString(),
    total: Number(row.total_neto ?? 0),
    subtotal: Number(row.subtotal_bruto ?? 0),
    discountAmount: Number(row.descuento_aplicado ?? 0),
    discountCode: row.codigo_descuento == null ? null : String(row.codigo_descuento),
    emailStatus: undefined,
    emailSentAt: null,
    emailError: null,
    emailAttemptAt: null
  };
}

/** Comprueba la salud y conectividad de la base de datos ejecutando SELECT 1 */
export async function databaseHealth() {
  if (!pool) return { configured: false, connected: false };
  await pool.query('SELECT 1');
  return { configured: true, connected: true };
}
