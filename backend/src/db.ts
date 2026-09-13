/**
 * ============================================================================
 * PROYECTO FARMACIA - CAPA DE PERSISTENCIA Y ACCESO A DATOS (POSTGRESQL)
 * ============================================================================
 * Este módulo implementa la interacción con la base de datos relacional PostgreSQL:
 * 1. Conectividad y Pool de Conexiones:
 *    - Inicialización de `pg.Pool` con soporte SSL y límite de conexiones concurrentes.
 *    - Detección automática de variables de entorno (DATABASE_URL o PGHOST/PGUSER/etc.).
 * 2. Cuentas de Clientes y Telemetría:
 *    - Creación y autenticación de cuentas e-commerce con hash bcrypt.
 *    - Tabla `pharmacy_delivery_tracking` para seguimiento geográfico en tiempo real.
 * 3. Gestión de Personal (Empleados):
 *    - Consulta con filtros, creación, actualización y baja lógica (`deactivateDatabaseEmployee`).
 * 4. Catálogos Maestros (CRUDs):
 *    - Sucursales, Categorías jerárquicas y Proveedores.
 * 5. Control de Medicamentos e Inventario FEFO:
 *    - Catálogo con búsqueda textual (`ILIKE`), cálculo de existencias en tiempo real.
 *    - Alta transaccional de productos con lote inicial opcional.
 *    - Recepción formal de lotes (`receiveDatabaseLot`) y registro de kardex / movimientos.
 *    - Eliminación inteligente: borrado físico si no tiene historial; baja lógica (soft delete) si tiene ventas.
 * 6. Checkout y Facturación Transaccional:
 *    - Operación atómica (`BEGIN ... COMMIT / ROLLBACK`) que reserva stock según caducidad (FEFO),
 *      registra el cliente, emite factura legal y asocia detalle de lotes.
 * 7. Inicialización y Respaldo (Fallback State):
 *    - Tablas de estado `pharmacy_state` para snapshots JSONB sincronizados.
 * ============================================================================
 */

import dotenv from 'dotenv';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import type { CreateProductInput, DataSnapshot, PublicCheckoutInput } from './domain.js';

dotenv.config();

// ============================================================================
// CONFIGURACIÓN DEL POOL DE CONEXIONES POSTGRESQL
// ============================================================================

/**
 * Construye la cadena de conexión de PostgreSQL a partir de variables de entorno.
 * Soporta DATABASE_URL completa o variables individuales estándar de PG.
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

/** Bandera que indica si la base de datos PostgreSQL está habilitada y configurada */
export const databaseEnabled = Boolean(url);

/** Instancia del pool de conexiones `pg.Pool` */
const pool = url
  ? new Pool({
      connectionString: url,
      ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
      max: Number(process.env.PGPOOL_MAX ?? 5)
    })
  : null;

/**
 * Asegura que el pool esté disponible antes de ejecutar una consulta obligatoria.
 * Lanza un error si PostgreSQL no está configurado.
 */
function requirePool(): Pool {
  if (!pool) throw new Error('PostgreSQL no está configurado');
  return pool;
}

// ============================================================================
// MODELOS Y MAPEADORES DE CLIENTES Y TELEMETRÍA
// ============================================================================

export interface DatabaseEmployee {
  employeeId: number;
  fullName: string;
  email: string;
  password: string;
  role: 'Administrador' | 'Gerente' | 'Cajero' | 'Bodeguero' | 'Repartidor' | 'Proveedor';
  branchId: number | null;
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

/** Crea una nueva cuenta de cliente con contraseña encriptada (bcrypt 12 rondas) */
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

/** Busca una cuenta de cliente por correo y valida opcionalmente la contraseña con bcrypt */
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

/** Actualiza los datos fiscales y de dirección de un cliente */
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

/** Registra el seguimiento GPS y telemetría de una orden de entrega a domicilio */
export async function createDatabaseDeliveryTracking(input: { orderCode: string; customerId: number | null; branchId: number; address: string; latitude: number | null; longitude: number | null; deliveryMode: string }) {
  if (input.deliveryMode !== 'DELIVERY') return;
  const database = requirePool();
  await database.query(
    `INSERT INTO pharmacy_delivery_tracking (order_code, customer_account_id, branch_id, address, latitude, longitude, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'CREATED')
     ON CONFLICT (order_code) DO UPDATE SET customer_account_id = EXCLUDED.customer_account_id, address = EXCLUDED.address, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude`,
    [input.orderCode, input.customerId, input.branchId, input.address, input.latitude, input.longitude]
  );
}

/** Lista los pedidos en seguimiento asociados a un cliente */
export async function listDatabaseCustomerOrders(customerId: number) {
  const database = requirePool();
  const result = await database.query(
    `SELECT order_code AS code, branch_id AS "branchId", address, status,
            latitude, longitude, updated_at AS "updatedAt"
       FROM pharmacy_delivery_tracking
      WHERE customer_account_id = $1
      ORDER BY created_at DESC`,
    [customerId]
  );
  return result.rows;
}

/** Lista los pedidos pendientes de entrega asignados a una sucursal */
export async function listDatabaseDeliveries(branchId: number) {
  const database = requirePool();
  const result = await database.query(
    `SELECT id, order_code AS code, branch_id AS "branchId", address, status,
            latitude, longitude, customer_account_id AS "customerId",
            updated_at AS "updatedAt"
       FROM pharmacy_delivery_tracking
      WHERE branch_id = $1 AND status <> 'DELIVERED'
      ORDER BY created_at`,
    [branchId]
  );
  return result.rows;
}

/** Actualiza el estado y las coordenadas GPS en tiempo real de una entrega */
export async function updateDatabaseDeliveryTracking(id: number, input: { status?: string; latitude?: number; longitude?: number }) {
  const database = requirePool();
  const fields: Array<[string, unknown]> = [];
  if (input.status !== undefined) fields.push(['status', input.status]);
  if (input.latitude !== undefined) fields.push(['latitude', input.latitude]);
  if (input.longitude !== undefined) fields.push(['longitude', input.longitude]);
  if (fields.length === 0) throw new Error('No hay datos de seguimiento para actualizar');
  const assignments = fields.map(([column], index) => `${column} = $${index + 2}`).join(', ');
  const result = await database.query(
    `UPDATE pharmacy_delivery_tracking SET ${assignments}, updated_at = NOW()
      WHERE id = $1
      RETURNING id, order_code AS code, branch_id AS "branchId", address, status, latitude, longitude, updated_at AS "updatedAt"`,
    [id, ...fields.map(([, value]) => value)]
  );
  if (!result.rows[0]) throw new Error('Seguimiento no encontrado');
  return result.rows[0];
}

// ============================================================================
// GESTIÓN DE EMPLEADOS (PERSONAL DE FARMACIA)
// ============================================================================

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

/** Busca un empleado activo por correo electrónico para autenticación */
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

/** Recupera un empleado por su ID primario */
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

/** Lista todos los empleados para el panel de administración */
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

/** Crea un nuevo empleado en la base de datos con contraseña encriptada con bcrypt */
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

/** Actualiza datos y rol de un empleado */
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

/** Desactiva a un empleado removiendo su contraseña de acceso */
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

// ============================================================================
// GESTIÓN DE SUCURSALES (SUCURSALES)
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
// GESTIÓN DE CATEGORÍAS (CATEGORIAS)
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
  if (!result.rows[0]) throw new Error(`Categoría #${id} no encontrada`);
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
    throw new Error('No se puede eliminar una categoría que tiene productos o subcategorías');
  }
  const result = await database.query(
    'DELETE FROM Categorias WHERE id_categoria = $1 RETURNING id_categoria AS id, nombre_categoria AS name, id_categoria_padre AS "parentId"',
    [id]
  );
  if (!result.rows[0]) throw new Error(`Categoría #${id} no encontrada`);
  return result.rows[0];
}

// ============================================================================
// GESTIÓN DE PROVEEDORES (PROVEEDORES)
// ============================================================================

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

export async function createDatabaseSupplier(input: { name: string; nit: string; email: string; phone: string; address: string; active: boolean }) {
  const database = requirePool();
  const result = await database.query(
    `INSERT INTO Proveedores (nombre_proveedor, nit, correo, telefono, direccion, estado)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id_proveedor AS id, nombre_proveedor AS name, nit, correo AS email, telefono AS phone, direccion AS address, LOWER(estado) = 'activo' AS active`,
    [input.name.trim(), input.nit.trim(), input.email.trim(), input.phone.trim(), input.address.trim(), input.active ? 'Activo' : 'Inactivo']
  );
  return result.rows[0];
}

export async function updateDatabaseSupplier(id: number, input: Partial<{ name: string; nit: string; email: string; phone: string; address: string; active: boolean }>) {
  const database = requirePool();
  const fields: Array<[string, unknown]> = [];
  const mapping: Array<[keyof typeof input, string]> = [['name', 'nombre_proveedor'], ['nit', 'nit'], ['email', 'correo'], ['phone', 'telefono'], ['address', 'direccion']];
  for (const [key, column] of mapping) if (input[key] !== undefined) fields.push([column, input[key]]);
  if (input.active !== undefined) fields.push(['estado', input.active ? 'Activo' : 'Inactivo']);
  if (!fields.length) throw new Error('No hay campos para actualizar');
  const assignments = fields.map(([column], index) => `${column} = $${index + 2}`).join(', ');
  const result = await database.query(
    `UPDATE Proveedores SET ${assignments} WHERE id_proveedor = $1
     RETURNING id_proveedor AS id, nombre_proveedor AS name, nit, correo AS email, telefono AS phone, direccion AS address, LOWER(estado) = 'activo' AS active`,
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

// ============================================================================
// CATÁLOGO DE PRODUCTOS Y BÚSQUEDA AVANZADA CON LOTES
// ============================================================================

/**
 * Realiza búsqueda en catálogo consolidando lotes disponibles en sucursal mediante `jsonb_agg`.
 */
export async function searchDatabaseCatalog(query: string, branchId?: number, categoryId?: number) {
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
      ORDER BY p.nombre_producto`,
    [query.trim(), branchId ?? null, categoryId ?? null]
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
 * Registra la recepción formal de un lote de medicamentos con transacción ACID.
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
       VALUES ($1, 'ENTRADA', $2, $3, 'Recepción de lote')`,
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
    const productResult = await client.query(
      `INSERT INTO Productos
        (sku_codigo, nombre_producto, id_categoria, requiere_receta, marca,
         laboratorio, presentacion, unidad_medida, registro_sanitario, imagen_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
        input.sanitaryRegistry.trim(),
        input.imageUrl?.trim() || null
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

/**
 * Elimina un producto. Si ya posee historial de ventas registradas, aplica una baja lógica
 * marcándolo como inactivo y poniendo su stock a cero para preservar la integridad referencial.
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
    ['sanitaryRegistry', 'registro_sanitario']
  ];
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
                marca AS brand, laboratorio AS laboratory, presentacion AS presentation,
                unidad_medida AS "unitMeasure", registro_sanitario AS "sanitaryRegistry",
                imagen_url AS "imageUrl"`,
    [id, ...fields.map(([, value]) => value)]
  );
  if (!result.rows[0]) throw new Error(`Producto #${id} no encontrado`);

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
    description: typeof input.description === 'string' ? input.description : ''
  };
}

// ============================================================================
// CHECKOUT Y PROCESAMIENTO DE COMPRAS (TRANSACCIÓN ATÓMICA FEFO)
// ============================================================================

/**
 * Realiza el proceso de compra completo dentro de una transacción PostgreSQL aislada:
 * 1. Upsert del cliente por NIT.
 * 2. Deducción de inventario respetando FEFO (`ORDER BY fecha_vencimiento ASC`).
 * 3. Inserción de movimientos de kardex.
 * 4. Generación de factura fiscal electrónica y sus partidas detalladas.
 */
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
      
      // Consulta de lotes disponibles ordenados por vencimiento más próximo (FEFO)
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
    return { 
      order: { 
        id: invoiceId, 
        code: `WEB-${String(invoiceId).padStart(6, '0')}`, 
        total, 
        deliveryMode: input.deliveryMode, 
        status: 'AWAITING_PAYMENT', 
        paymentStatus: 'PENDING' 
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

/** Registra el comprobante de pago vinculado a una factura */
export async function registerDatabasePayment(invoiceId: number, transactionId: string, amount: number) {
  const database = requirePool();
  const method = await database.query(`INSERT INTO MetodosPago (nombre_metodo) VALUES ('Stripe') ON CONFLICT DO NOTHING RETURNING id_metodo_pago`);
  let methodId = method.rows[0]?.id_metodo_pago;
  if (!methodId) methodId = (await database.query(`SELECT id_metodo_pago FROM MetodosPago WHERE LOWER(nombre_metodo) = 'stripe' LIMIT 1`)).rows[0]?.id_metodo_pago;
  await database.query(`INSERT INTO Pagos (id_factura, id_metodo_pago, transaccion_pasarela_id, monto_pagado) VALUES ($1, $2, $3, $4)`, [invoiceId, methodId, transactionId, amount]);
}

// ============================================================================
// INICIALIZACIÓN, MIGRACIONES DINÁMICAS Y PERSISTENCIA DE ESTADO
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
  await pool.query('ALTER TABLE Productos ADD COLUMN IF NOT EXISTS imagen_url TEXT');
  await pool.query('ALTER TABLE Productos ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true');
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
      address TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'CREATED',
      latitude NUMERIC,
      longitude NUMERIC,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query('ALTER TABLE pharmacy_customer_accounts ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT \'\'');
  await pool.query('ALTER TABLE pharmacy_delivery_tracking ADD COLUMN IF NOT EXISTS latitude NUMERIC');
  await pool.query('ALTER TABLE pharmacy_delivery_tracking ADD COLUMN IF NOT EXISTS longitude NUMERIC');
}

/** Carga el snapshot de estado en formato JSONB de la base de datos */
export async function loadDatabaseSnapshot(): Promise<DataSnapshot | null> {
  if (!pool) return null;
  const result = await pool.query<{ snapshot: DataSnapshot }>('SELECT snapshot FROM pharmacy_state WHERE id = 1');
  return result.rows[0]?.snapshot ?? null;
}

/** Guarda el snapshot de estado en formato JSONB para sincronización */
export async function saveDatabaseSnapshot(snapshot: DataSnapshot) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO pharmacy_state (id, snapshot, updated_at)
     VALUES (1, $1::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET snapshot = EXCLUDED.snapshot, updated_at = NOW()`,
    [JSON.stringify(snapshot)]
  );
}

/** Comprueba la salud y conectividad de la base de datos ejecutando SELECT 1 */
export async function databaseHealth() {
  if (!pool) return { configured: false, connected: false };
  await pool.query('SELECT 1');
  return { configured: true, connected: true };
}
