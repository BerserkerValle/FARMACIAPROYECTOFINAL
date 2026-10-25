/**
 * ============================================================================
 * PROYECTO FARMACIA - ALMACÃ‰N DE DATOS EN MEMORIA Y PERSISTENCIA JSON (STORE)
 * ============================================================================
 * Este mÃ³dulo proporciona una capa de persistencia dual para el sistema:
 * 1. Modo PostgreSQL: Cuando `DATABASE_URL` estÃ¡ configurada, sincroniza snapshots
 *    en formato JSONB y ejecuta migraciones iniciales.
 * 2. Modo Local / Fallback: En ausencia de base de datos externa, opera en memoria
 *    con persistencia automÃ¡tica en disco (`data/dev-store.json`).
 *
 * MÃ‰TODOS Y ALGORITMOS CLAVE:
 * - Algoritmo FEFO (First Expired, First Out):
 *   Al procesar una venta (POS o Web), las existencias se descuentan de los lotes
 *   cuya fecha de vencimiento sea mÃ¡s prÃ³xima (`sort((a, b) => a.expirationDate - b.expirationDate)`).
 * - Cifrado DinÃ¡mico:
 *   Migra automÃ¡ticamente contraseÃ±as de empleados no cifradas a hashes bcrypt de 12 rondas.
 * - Motor de MÃ©tricas y KPIs:
 *   Calcula ventas diarias, mensuales, productos con rotaciÃ³n crÃ­tica y alertas de caducidad (< 90 dÃ­as).
 * ============================================================================
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import bcrypt from 'bcryptjs';
import { databaseEnabled, initializeDatabase, loadDatabaseSnapshot, saveDatabaseSnapshot } from './db.js';
import type {
  Branch,
  Category,
  CreateProductInput,
  CrosscheckInput,
  CrosscheckRecord,
  Customer,
  DashboardMetrics,
  DataSnapshot,
  DiscountCode,
  DiscountRedemption,
  EmailStatus,
  Employee,
  Invoice,
  Lot,
  Order,
  OrderItem,
  Payment,
  PaymentStatus,
  PosSaleInput,
  Product,
  PublicCheckoutInput,
  ReceiveGoodsInput,
  ReturnRecord,
  Role,
  Supplier
} from './domain.js';
import { assertDiscountCodeUsable, calculateDiscountAmount } from './discounts.js';
import { generarFacturaDesdeOrden } from './services/invoice.service.js';

// ============================================================================
// CONFIGURACIÃ“N DE RUTA DEL ARCHIVO DE ALMACENAMIENTO LOCAL
// ============================================================================

/**
 * Resuelve la ruta adecuada al archivo dev-store.json segÃºn el directorio de ejecuciÃ³n.
 */
function getStorageFilePath(): string {
  const cwd = process.cwd();
  const pathInBackendBackend = resolve(cwd, 'backend', 'data', 'dev-store.json');
  const pathInBackendData = resolve(cwd, 'data', 'dev-store.json');
  if (existsSync(pathInBackendBackend)) return pathInBackendBackend;
  if (existsSync(pathInBackendData)) return pathInBackendData;
  return pathInBackendBackend;
}

const storageFile = getStorageFilePath();

// ============================================================================
// FUNCIONES AUXILIARES DE FECHAS Y CORRELATIVOS
// ============================================================================

function now(): string {
  return new Date().toISOString();
}

function monthKey(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function startOfDay(value: string | Date): Date {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function startOfMonth(value: string | Date): Date {
  const date = new Date(value);
  date.setUTCDate(1);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function code(prefix: string, id: number): string {
  return `${prefix}-${String(id).padStart(5, '0')}`;
}

/** Realiza una copia profunda de un objeto para evitar mutaciones directas */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeProduct(product: Product): Product {
  return {
    ...product,
    controlledProduct: product.controlledProduct ?? false,
    chronicUse: product.chronicUse ?? false,
    avoidPregnancy: product.avoidPregnancy ?? false,
    requiresRefrigeration: product.requiresRefrigeration ?? false,
    ingredients: product.ingredients ?? []
  };
}

// ============================================================================
// CLASE PRINCIPAL: PharmacyStore
// ============================================================================

export class PharmacyStore {
  private snapshot!: DataSnapshot;
  private ready: Promise<void>;
  /** Mapa de claves de idempotencia para POS: key -> { orderId, timestamp, fingerprint } */
  private posIdempotencyKeys = new Map<string, { orderId: number; timestamp: number; fingerprint: string }>();

  constructor() {
    this.ready = this.load();
  }

  /** Permite al servidor esperar a que los datos estÃ©n completamente cargados antes de responder peticiones */
  async waitUntilReady() {
    await this.ready;
  }

  /** Carga los datos desde PostgreSQL o desde el archivo JSON local */
  private async load() {
    if (databaseEnabled) {
      await initializeDatabase();
      const databaseSnapshot = await loadDatabaseSnapshot();
      if (databaseSnapshot) {
        this.snapshot = databaseSnapshot;
        this.snapshot.products = this.snapshot.products.map(normalizeProduct);
        this.ensureDiscountSnapshotDefaults();
        await this.migrateEmployeePasswords();
        return;
      }
      this.snapshot = this.seed();
      await saveDatabaseSnapshot(this.snapshot);
      return;
    }

    try {
      const raw = await readFile(storageFile, 'utf8');
      this.snapshot = JSON.parse(raw) as DataSnapshot;
      this.ensureDiscountSnapshotDefaults();
      if (!this.snapshot.counters.product) {
        this.snapshot.counters.product = Math.max(0, ...this.snapshot.products.map((p) => p.id));
      }
      this.snapshot.products = this.snapshot.products.map(normalizeProduct);

      await this.migrateEmployeePasswords();
      return;
    } catch {
      this.snapshot = this.seed();
      await this.save();
    }
  }

  private ensureDiscountSnapshotDefaults() {
    this.snapshot.discountCodes ??= [];
    this.snapshot.discountRedemptions ??= [];
    this.snapshot.counters.discountCode ??= this.snapshot.discountCodes.reduce((max, item) => Math.max(max, item.id), 0);
  }

  /** Cifra con bcrypt cualquier contraseÃ±a almacenada en texto plano */
  private async migrateEmployeePasswords() {
    let changed = false;
    for (const employee of this.snapshot.employees) {
      if (!employee.password.startsWith('$2')) {
        employee.password = bcrypt.hashSync(employee.password, 12);
        changed = true;
      }
    }
    if (changed) await this.save();
  }

  /** Persiste el snapshot en PostgreSQL o en disco local */
  private async save() {
    if (databaseEnabled) {
      await saveDatabaseSnapshot(this.snapshot);
      return;
    }
    await mkdir(dirname(storageFile), { recursive: true });
    await writeFile(storageFile, JSON.stringify(this.snapshot, null, 2), 'utf8');
  }

  /** Genera los datos semilla iniciales para pruebas del sistema de farmacia */
  private seed(): DataSnapshot {
    const branches: Branch[] = [
      { id: 1, name: 'Antigua Central', city: 'Antigua Guatemala', address: '7a Avenida Norte 12' },
      { id: 2, name: 'Ciudad Vieja', city: 'Ciudad Vieja', address: '5a Calle Oriente 8' },
      { id: 3, name: 'Jocotenango', city: 'Jocotenango', address: 'Avenida Central 14' },
      { id: 4, name: 'Pastores', city: 'Pastores', address: 'Calzada Principal 22' },
      { id: 5, name: 'San Lucas', city: 'San Lucas SacatepÃ©quez', address: 'Ruta Interamericana Km 28' },
      { id: 6, name: 'Santa MarÃ­a', city: 'Santa MarÃ­a de JesÃºs', address: 'Zona 1, Calle Real' },
      { id: 7, name: 'DueÃ±as', city: 'DueÃ±as', address: 'Entrada principal lote 3' }
    ];

    const categories: Category[] = [
      { id: 1, name: 'Medicamentos', parentId: null },
      { id: 2, name: 'AnalgÃ©sicos', parentId: 1 },
      { id: 3, name: 'AntibiÃ³ticos', parentId: 1 },
      { id: 4, name: 'LÃ­nea PediÃ¡trica', parentId: 1 },
      { id: 5, name: 'Controlados', parentId: 1 }
    ];

    const products: Product[] = [
      {
        id: 1,
        sku: 'SKU-AMOX-500',
        name: 'Amoxicilina Clavulanato 500mg',
        categoryId: 3,
        brand: 'Genfar',
        laboratory: 'Laboratorios Genfar',
        presentation: 'Caja x 14 tabletas',
        unitMeasure: 'tableta',
        sanitaryRegistry: 'MSPAS-2026-8841',
         requiresPrescription: true,
         controlledProduct: false,
         chronicUse: false,
         avoidPregnancy: false,
         requiresRefrigeration: false,
         ingredients: [],
        active: true,
        description: 'AntibiÃ³tico de amplio espectro con control sanitario.',
        price: 145,
        cost: 97,
        imageUrl: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&w=600&q=80'
      },
      {
        id: 2,
        sku: 'SKU-ACETA-500',
        name: 'AcetaminofÃ©n Genfar 500mg',
        categoryId: 2,
        brand: 'Genfar',
        laboratory: 'Laboratorios Genfar',
        presentation: 'Caja x 10 tabletas',
        unitMeasure: 'tableta',
        sanitaryRegistry: 'MSPAS-2026-4410',
         requiresPrescription: false,
         controlledProduct: false,
         chronicUse: false,
         avoidPregnancy: false,
         requiresRefrigeration: false,
         ingredients: [],
        active: true,
        description: 'AnalgÃ©sico y antipirÃ©tico de alta rotaciÃ³n.',
        price: 30,
        cost: 18,
        imageUrl: 'https://images.unsplash.com/photo-1584017911766-d451b3d0e843?auto=format&fit=crop&w=600&q=80'
      },
      {
        id: 3,
        sku: 'SKU-IBUP-400',
        name: 'Ibuprofeno 400mg',
        categoryId: 2,
        brand: 'MK',
        laboratory: 'Laboratorios MK',
        presentation: 'Caja x 20 tabletas',
        unitMeasure: 'tableta',
        sanitaryRegistry: 'MSPAS-2025-3320',
         requiresPrescription: false,
         controlledProduct: false,
         chronicUse: false,
         avoidPregnancy: false,
         requiresRefrigeration: false,
         ingredients: [],
        active: true,
        description: 'Anti-inflamatorio para venta libre.',
        price: 28,
        cost: 12,
        imageUrl: 'https://images.unsplash.com/photo-1471864190281-a93a3070b6de?auto=format&fit=crop&w=600&q=80'
      },
      {
        id: 4,
        sku: 'SKU-JARABE-120',
        name: 'Jarabe PediÃ¡trico MultivitamÃ­nico',
        categoryId: 4,
        brand: 'PediaLife',
        laboratory: 'PediaLife S.A.',
        presentation: 'Frasco x 120 ml',
        unitMeasure: 'frasco',
        sanitaryRegistry: 'MSPAS-2026-9912',
         requiresPrescription: false,
         controlledProduct: false,
         chronicUse: false,
         avoidPregnancy: false,
         requiresRefrigeration: false,
         ingredients: [],
        active: true,
        description: 'Suplemento infantil de rotaciÃ³n media.',
        price: 48,
        cost: 26,
        imageUrl: 'https://images.unsplash.com/photo-1577401239170-897942555fb3?auto=format&fit=crop&w=600&q=80'
      }
    ];

    const suppliers: Supplier[] = [
      { id: 1, name: 'Laboratorios Genfar', contactName: 'Compras Genfar', nit: '5489321-4', email: 'compras@genfar.com', phone: '2299-0011', address: 'Zona 10, Ciudad de Guatemala', active: true },
      { id: 2, name: 'Laboratorios MK', contactName: 'Ventas MK', nit: '1458992-7', email: 'ventas@mk.com', phone: '2233-7788', address: 'Zona 4, Ciudad de Guatemala', active: true },
      { id: 3, name: 'PediaLife S.A.', contactName: 'Pedidos PediaLife', nit: '7744211-3', email: 'pedidos@pedialife.com', phone: '2255-8811', address: 'Mixco, Guatemala', active: true }
    ];

    const employees: Employee[] = [
      { id: 1, fullName: 'Admin Central', email: 'admin@derkas.com', password: 'Admin123*', role: 'Administrador', branchId: null, supervisorId: null, active: true },
      { id: 2, fullName: 'Gerente General', email: 'gerente@derkas.com', password: 'Gerente123*', role: 'Gerente', branchId: null, supervisorId: 1, active: true },
      { id: 3, fullName: 'Cajero Vendedor 01', email: 'cajero1@derkas.com', password: 'Caja123*', role: 'Cajero', branchId: 1, supervisorId: 2, active: true },
      { id: 4, fullName: 'Bodeguero Antigua', email: 'bodega1@derkas.com', password: 'Bodega123*', role: 'Bodeguero', branchId: 1, supervisorId: 2, active: true },
      { id: 5, fullName: 'Repartidor Antigua 01', email: 'rider1@derkas.com', password: 'Ruta123*', role: 'Repartidor', branchId: 1, supervisorId: 2, active: true },
      { id: 6, fullName: 'Proveedor Genfar', email: 'proveedor@genfar.com', password: 'Proveedor123*', role: 'Proveedor', branchId: null, supervisorId: null, active: true }
    ];

    const lots: Lot[] = [
      { id: 1, productId: 1, branchId: 1, supplierId: 1, batchCode: 'LOT-2026-A4', expirationDate: '2027-01-15', productionDate: '2025-12-10', costPrice: 97, salePrice: 145, quantityAvailable: 12 },
      { id: 2, productId: 2, branchId: 1, supplierId: 2, batchCode: 'LOT-2026-B1', expirationDate: '2026-11-10', productionDate: '2026-02-01', costPrice: 18, salePrice: 30, quantityAvailable: 60 },
      { id: 3, productId: 3, branchId: 1, supplierId: 2, batchCode: 'LOT-2026-B7', expirationDate: '2027-03-20', productionDate: '2026-01-12', costPrice: 12, salePrice: 28, quantityAvailable: 30 },
      { id: 4, productId: 4, branchId: 1, supplierId: 3, batchCode: 'LOT-2026-C3', expirationDate: '2026-12-15', productionDate: '2026-03-05', costPrice: 26, salePrice: 48, quantityAvailable: 18 },
      { id: 5, productId: 2, branchId: 2, supplierId: 2, batchCode: 'LOT-2026-B2', expirationDate: '2026-10-10', productionDate: '2026-02-18', costPrice: 18, salePrice: 30, quantityAvailable: 28 },
      { id: 6, productId: 1, branchId: 2, supplierId: 1, batchCode: 'LOT-2026-A5', expirationDate: '2026-12-20', productionDate: '2025-11-15', costPrice: 97, salePrice: 145, quantityAvailable: 5 },
      { id: 7, productId: 3, branchId: 3, supplierId: 2, batchCode: 'LOT-2026-B8', expirationDate: '2027-02-11', productionDate: '2026-01-21', costPrice: 12, salePrice: 28, quantityAvailable: 14 },
      { id: 8, productId: 4, branchId: 4, supplierId: 3, batchCode: 'LOT-2026-C4', expirationDate: '2026-09-30', productionDate: '2026-02-22', costPrice: 26, salePrice: 48, quantityAvailable: 6 }
    ];

    const customers: Customer[] = [
      { id: 1, name: 'Kevin Leonardo Cay Cay', nit: '4893877-1', email: 'kevincay590@gmail.com', phone: '48938771', createdAt: now(), updatedAt: now() }
    ];

    return {
      branches,
      categories,
      products,
      suppliers,
      lots,
      customers,
      employees,
      orders: [],
      orderItems: [],
      payments: [],
      invoices: [],
      returns: [],
      crosschecks: [],
      discountCodes: [],
      discountRedemptions: [],
      counters: {
        customer: 1,
        employee: 6,
        order: 0,
        orderItem: 0,
        payment: 0,
        invoice: 0,
        return: 0,
        crosscheck: 0,
        lot: 8,
        product: 4,
        discountCode: 0
      }
    };
  }

  private assertReady() {
    if (!this.snapshot) {
      throw new Error('Store not ready');
    }
  }

  /** Invoca el guardado en segundo plano */
  private touch() {
    void this.save();
  }

  // ============================================================================
  // SUCURSALES, CATEGORÃAS Y PROVEEDORES
  // ============================================================================

  getBranches() {
    this.assertReady();
    return clone(this.snapshot.branches);
  }

  getCategories() {
    this.assertReady();
    return clone(this.snapshot.categories);
  }

  getSuppliers() {
    this.assertReady();
    return clone(this.snapshot.suppliers);
  }

  getEmployees() {
    this.assertReady();
    return clone(this.snapshot.employees);
  }

  getDiscountCodes() {
    this.assertReady();
    return clone(this.snapshot.discountCodes);
  }

  createDiscountCode(input: Omit<DiscountCode, 'id' | 'createdAt'>) {
    this.assertReady();
    if (this.snapshot.discountCodes.some((item) => item.code === input.code)) {
      throw new Error('Ya existe un cÃ³digo con ese nombre');
    }
    const discount: DiscountCode = {
      ...input,
      id: ++this.snapshot.counters.discountCode,
      createdAt: now()
    };
    this.snapshot.discountCodes.push(discount);
    this.touch();
    return clone(discount);
  }

  setDiscountCodeActive(id: number, active: boolean) {
    this.assertReady();
    const discount = this.snapshot.discountCodes.find((item) => item.id === id);
    if (!discount) throw new Error('CÃ³digo de descuento no encontrado');
    discount.active = active;
    this.touch();
    return clone(discount);
  }

  quoteDiscountCode(codeValue: string, email: string, branchId: number, items: Array<{ productId: number; quantity: number }>) {
    this.assertReady();
    const normalizedCode = codeValue.trim().toUpperCase();
    const discount = this.snapshot.discountCodes.find((item) => item.code === normalizedCode);
    if (!discount) throw new Error('El cÃ³digo de descuento no existe');
    assertDiscountCodeUsable(discount, email, this.snapshot.discountRedemptions);
    const subtotal = items.reduce((sum, item) => {
      const product = this.snapshot.products.find((candidate) => candidate.id === item.productId);
      if (!product || product.active === false) throw new Error(`Producto no disponible: ${item.productId}`);
      const stock = this.getStock(product.id, branchId);
      if (stock < item.quantity) throw new Error(`Stock insuficiente para ${product.name}`);
      return sum + product.price * item.quantity;
    }, 0);
    if (subtotal <= 0) throw new Error('El carrito estÃ¡ vacÃ­o');
    const discountAmount = calculateDiscountAmount(subtotal, discount.type, discount.value);
    return { code: discount.code, subtotal, discountAmount, total: subtotal - discountAmount };
  }

  getProducts() {
    this.assertReady();
    return clone(this.snapshot.products.filter((p) => p.active !== false));
  }

  getProductById(id: number) {
    this.assertReady();
    return clone(this.snapshot.products.find((p) => p.id === id) ?? null);
  }

  addProduct(input: CreateProductInput) {
    this.assertReady();
    if (!this.snapshot.counters.product) {
      this.snapshot.counters.product = Math.max(0, ...this.snapshot.products.map((p) => p.id));
    }
    if (this.snapshot.products.some((candidate) => candidate.sanitaryRegistry.trim() === input.sanitaryRegistry.trim())) {
      throw new Error('Ya existe un medicamento con ese registro sanitario');
    }
    const product: Product = {
      id: ++this.snapshot.counters.product,
      sku: input.sku.trim().toUpperCase(),
      name: input.name.trim(),
      categoryId: Number(input.categoryId),
      brand: input.brand.trim(),
      laboratory: input.laboratory.trim(),
      presentation: input.presentation.trim(),
      unitMeasure: input.unitMeasure.trim(),
      sanitaryRegistry: input.sanitaryRegistry.trim(),
      requiresPrescription: Boolean(input.requiresPrescription),
      controlledProduct: Boolean(input.controlledProduct),
      chronicUse: Boolean(input.chronicUse),
      avoidPregnancy: Boolean(input.avoidPregnancy),
      requiresRefrigeration: Boolean(input.requiresRefrigeration),
      ingredients: (input.ingredients ?? []).filter((item) => item.ingredient.trim()).map((item) => ({ ...item, ingredient: item.ingredient.trim(), quantity: item.quantity.trim(), concentration: item.concentration.trim() })),
      active: input.active ?? true,
      description: input.description.trim(),
      price: Number(input.price),
      cost: Number(input.cost),
      imageUrl: input.imageUrl?.trim() || null
    };
    this.snapshot.products.push(product);

    let initialLot: Lot | null = null;
    if (input.initialStock && input.initialStock.quantity > 0) {
      initialLot = {
        id: ++this.snapshot.counters.lot,
        productId: product.id,
        branchId: Number(input.initialStock.branchId),
        supplierId: Number(input.initialStock.supplierId),
        batchCode: input.initialStock.batchCode?.trim() || `LOT-${product.sku}-01`,
        expirationDate: input.initialStock.expirationDate || new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10),
        productionDate: input.initialStock.productionDate || new Date().toISOString().slice(0, 10),
        costPrice: product.cost,
        salePrice: product.price,
        quantityAvailable: Number(input.initialStock.quantity)
      };
      this.snapshot.lots.push(initialLot);
    }

    this.touch();
    return clone({ product, initialLot });
  }

  updateProduct(id: number, input: Partial<CreateProductInput>) {
    this.assertReady();
    const product = this.snapshot.products.find((p) => p.id === id);
    if (!product) {
      throw new Error(`Producto #${id} no encontrado`);
    }
    if (input.name !== undefined) product.name = input.name.trim();
    if (input.sku !== undefined) product.sku = input.sku.trim().toUpperCase();
    if (input.categoryId !== undefined) product.categoryId = input.categoryId == null ? null : Number(input.categoryId);
    if (input.brand !== undefined) product.brand = (input.brand ?? '').trim();
    if (input.laboratory !== undefined) product.laboratory = (input.laboratory ?? '').trim();
    if (input.presentation !== undefined) product.presentation = (input.presentation ?? '').trim();
    if (input.unitMeasure !== undefined) product.unitMeasure = (input.unitMeasure ?? '').trim();
    if (input.sanitaryRegistry !== undefined) product.sanitaryRegistry = (input.sanitaryRegistry ?? '').trim();
    if (input.sanitaryRegistry !== undefined && this.snapshot.products.some((candidate) => candidate.id !== id && candidate.sanitaryRegistry.trim() === product.sanitaryRegistry)) {
      throw new Error('Ya existe otro medicamento con ese registro sanitario');
    }
    if (input.requiresPrescription !== undefined) product.requiresPrescription = Boolean(input.requiresPrescription);
    if (input.controlledProduct !== undefined) product.controlledProduct = Boolean(input.controlledProduct);
    if (input.chronicUse !== undefined) product.chronicUse = Boolean(input.chronicUse);
    if (input.avoidPregnancy !== undefined) product.avoidPregnancy = Boolean(input.avoidPregnancy);
    if (input.requiresRefrigeration !== undefined) product.requiresRefrigeration = Boolean(input.requiresRefrigeration);
    if (input.ingredients !== undefined) product.ingredients = input.ingredients.filter((item) => item.ingredient.trim()).map((item) => ({ ...item, ingredient: item.ingredient.trim(), quantity: item.quantity.trim(), concentration: item.concentration.trim() }));
    if (input.active !== undefined) product.active = Boolean(input.active);
    if (input.description !== undefined) product.description = (input.description ?? '').trim();
    if (input.price !== undefined) product.price = Number(input.price);
    if (input.cost !== undefined) product.cost = Number(input.cost);
    if (input.imageUrl !== undefined) product.imageUrl = input.imageUrl?.trim() || null;

    this.touch();
    return clone(product);
  }

  deleteProduct(id: number) {
    this.assertReady();
    const product = this.snapshot.products.find((candidate) => candidate.id === id);
    if (!product) throw new Error(`Producto #${id} no encontrado`);
    product.active = false;
    this.snapshot.lots = this.snapshot.lots.filter((l) => l.productId !== id);
    this.touch();
    return clone(product);
  }

  addBranch(input: Omit<Branch, 'id'>) {
    this.assertReady();
    const branch: Branch = { id: Math.max(0, ...this.snapshot.branches.map((item) => item.id)) + 1, ...input };
    this.snapshot.branches.push(branch);
    this.touch();
    return clone(branch);
  }

  updateBranch(id: number, input: Partial<Omit<Branch, 'id'>>) {
    this.assertReady();
    const branch = this.snapshot.branches.find((item) => item.id === id);
    if (!branch) throw new Error(`Sucursal #${id} no encontrada`);
    Object.assign(branch, input);
    this.touch();
    return clone(branch);
  }

  deleteBranch(id: number) {
    this.assertReady();
    if (this.snapshot.orders.some((order) => order.branchId === id) || this.snapshot.lots.some((lot) => lot.branchId === id)) {
      throw new Error('No se puede eliminar una sucursal con Ã³rdenes o inventario asociado');
    }
    const index = this.snapshot.branches.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`Sucursal #${id} no encontrada`);
    const [branch] = this.snapshot.branches.splice(index, 1);
    this.touch();
    return clone(branch);
  }

  addCategory(input: Omit<Category, 'id'>) {
    this.assertReady();
    const category: Category = { id: Math.max(0, ...this.snapshot.categories.map((item) => item.id)) + 1, ...input };
    this.snapshot.categories.push(category);
    this.touch();
    return clone(category);
  }

  updateCategory(id: number, input: Partial<Omit<Category, 'id'>>) {
    this.assertReady();
    const category = this.snapshot.categories.find((item) => item.id === id);
    if (!category) throw new Error(`CategorÃ­a #${id} no encontrada`);
    Object.assign(category, input);
    this.touch();
    return clone(category);
  }

  deleteCategory(id: number) {
    this.assertReady();
    if (this.snapshot.products.some((product) => product.categoryId === id) || this.snapshot.categories.some((category) => category.parentId === id)) {
      throw new Error('No se puede eliminar una categorÃ­a que tiene productos o subcategorÃ­as');
    }
    const index = this.snapshot.categories.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`CategorÃ­a #${id} no encontrada`);
    const [category] = this.snapshot.categories.splice(index, 1);
    this.touch();
    return clone(category);
  }

  addSupplier(input: Omit<Supplier, 'id'>) {
    this.assertReady();
    const supplier: Supplier = { id: Math.max(0, ...this.snapshot.suppliers.map((item) => item.id)) + 1, ...input, active: input.active ?? true };
    this.snapshot.suppliers.push(supplier);
    this.touch();
    return clone(supplier);
  }

  updateSupplier(id: number, input: Partial<Omit<Supplier, 'id'>>) {
    this.assertReady();
    const supplier = this.snapshot.suppliers.find((item) => item.id === id);
    if (!supplier) throw new Error(`Proveedor #${id} no encontrado`);
    Object.assign(supplier, input);
    this.touch();
    return clone(supplier);
  }

  deleteSupplier(id: number) {
    this.assertReady();
    const supplier = this.snapshot.suppliers.find((item) => item.id === id);
    if (!supplier) throw new Error(`Proveedor #${id} no encontrado`);
    supplier.active = false;
    this.touch();
    return clone(supplier);
  }

  // ============================================================================
  // CLIENTES Y CUENTAS DE USUARIO
  // ============================================================================

  getCustomerByIdentifier(nit: string, email: string) {
    this.assertReady();
    return this.snapshot.customers.find((customer) => customer.nit === nit || customer.email === email) ?? null;
  }

  registerCustomerAccount(input: { fullName: string; email: string; password: string; phone: string; nit: string }) {
    this.assertReady();
    const existing = this.snapshot.customers.find((customer) => customer.email.toLowerCase() === input.email.toLowerCase());
    if (existing) {
      if (existing.passwordHash) throw new Error('El correo ya estÃ¡ registrado');
      existing.name = input.fullName.trim();
      existing.phone = input.phone.trim();
      existing.nit = input.nit.trim();
      existing.passwordHash = bcrypt.hashSync(input.password, 12);
      existing.updatedAt = now();
      this.touch();
      return clone(existing);
    }
    const customer: Customer = {
      id: ++this.snapshot.counters.customer,
      name: input.fullName.trim(),
      nit: input.nit.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone.trim(),
      passwordHash: bcrypt.hashSync(input.password, 12),
      createdAt: now(),
      updatedAt: now()
    };
    this.snapshot.customers.push(customer);
    this.touch();
    return clone(customer);
  }

  findCustomerAccount(email: string, password?: string) {
    this.assertReady();
    const customer = this.snapshot.customers.find((candidate) => candidate.email.toLowerCase() === email.toLowerCase() && candidate.passwordHash);
    if (!customer) return null;
    if (password !== undefined && !bcrypt.compareSync(password, customer.passwordHash!)) return null;
    return clone(customer);
  }

  listCustomerOrders(customerId: number) {
    this.assertReady();
    const account = this.snapshot.customers.find((customer) => customer.id === customerId && customer.passwordHash);
    const customerIds = account
      ? this.snapshot.customers.filter((customer) => customer.email.toLowerCase() === account.email.toLowerCase()).map((customer) => customer.id)
      : [customerId];
    return this.snapshot.orders
      .filter((order) => {
        if (!customerIds.includes(order.customerId) || order.deliveryMode !== 'DELIVERY') return false;
        if (order.customerEmail) return order.customerEmail.toLowerCase() === account?.email.toLowerCase();
        return Boolean(account?.address && order.address?.trim().toLowerCase() === account.address.trim().toLowerCase());
      })
      .map((order) => {
        const orderCustomer = this.snapshot.customers.find((candidate) => candidate.id === order.customerId);
        return { id: order.id, code: order.code, branchId: order.branchId, address: order.address, status: order.status, paymentStatus: order.paymentStatus, latitude: orderCustomer?.deliveryLatitude ?? null, longitude: orderCustomer?.deliveryLongitude ?? null, updatedAt: order.releasedAt ?? order.createdAt };
      });
  }

  updateDelivery(orderId: number, input: { status?: string; latitude?: number; longitude?: number }, actor?: { employeeId: number; role: Role }) {
    this.assertReady();
    const order = this.snapshot.orders.find((candidate) => candidate.id === orderId);
    if (!order) throw new Error('Entrega no encontrada');
    if (input.status) order.status = input.status as Order['status'];
    if (actor?.role === 'Repartidor' && order.assignedEmployeeId == null) {
      order.assignedEmployeeId = actor.employeeId;
    }
    const orderCustomer = this.snapshot.customers.find((candidate) => candidate.id === order.customerId);
    const matchingCustomers = orderCustomer
      ? this.snapshot.customers.filter((candidate) => candidate.email.toLowerCase() === orderCustomer.email.toLowerCase())
      : [];
    for (const customer of matchingCustomers) {
      if (input.latitude !== undefined) customer.deliveryLatitude = input.latitude;
      if (input.longitude !== undefined) customer.deliveryLongitude = input.longitude;
      customer.updatedAt = now();
    }
    this.touch();
    return clone({
      id: order.id,
      code: order.code,
      status: order.status,
      latitude: orderCustomer?.deliveryLatitude ?? null,
      longitude: orderCustomer?.deliveryLongitude ?? null
    });
  }

  upsertCustomer(input: PublicCheckoutInput['customer']) {
    this.assertReady();
    const normalizedEmail = input.email.trim().toLowerCase();
    const existing = this.snapshot.customers.find((customer) => customer.email.trim().toLowerCase() === normalizedEmail);
    if (existing) {
      existing.name = input.name;
      existing.phone = input.phone;
      existing.email = normalizedEmail;
      existing.updatedAt = now();
      this.touch();
      return clone(existing);
    }
    const customer = {
      id: ++this.snapshot.counters.customer,
      name: input.name,
      nit: input.nit,
      email: input.email,
      phone: input.phone,
      createdAt: now(),
      updatedAt: now()
    } satisfies Customer;
    this.snapshot.customers.push(customer);
    this.touch();
    return clone(customer);
  }

  // ============================================================================
  // CATÃLOGO Y CONTROL DE LOTES
  // ============================================================================

  getCategoryWithDescendants(categoryId: number): number[] {
    const ids = [categoryId];
    const children = this.snapshot.categories.filter((c) => c.parentId === categoryId);
    for (const child of children) {
      ids.push(...this.getCategoryWithDescendants(child.id));
    }
    return ids;
  }

  searchCatalog(query: string, branchId?: number, categoryId?: number, minPrice?: number, maxPrice?: number) {
    this.assertReady();
    const normalized = query.trim().toLowerCase();
    const allowedCategoryIds = categoryId ? this.getCategoryWithDescendants(categoryId) : null;
    return this.snapshot.products
      .filter((product) => product.active)
      .filter((product) => (allowedCategoryIds ? (product.categoryId && allowedCategoryIds.includes(product.categoryId)) : true))
      .filter((product) => {
        if (!normalized) {
          return true;
        }
        const cat = this.snapshot.categories.find((c) => c.id === product.categoryId);
        const catName = cat?.name ?? '';
        return [product.name, product.brand, product.laboratory, product.sku, catName].some((text) => text.toLowerCase().includes(normalized));
      })
      .filter((product) => {
        if (minPrice !== undefined && product.price < minPrice) return false;
        if (maxPrice !== undefined && product.price > maxPrice) return false;
        return true;
      })
      .map((product) => ({
        ...product,
        stock: this.getStock(product.id, branchId),
        lots: this.getLots(product.id, branchId).map((lot) => ({
          id: lot.id,
          batchCode: lot.batchCode,
          expirationDate: lot.expirationDate,
          quantityAvailable: lot.quantityAvailable,
          branchId: lot.branchId,
          salePrice: lot.salePrice
        }))
      }));
  }

  getLots(productId?: number, branchId?: number) {
    this.assertReady();
    return this.snapshot.lots
      .filter((lot) => (productId ? lot.productId === productId : true))
      .filter((lot) => (branchId ? lot.branchId === branchId : true))
      .sort((left, right) => left.expirationDate.localeCompare(right.expirationDate));
  }

  getStock(productId: number, branchId?: number) {
    return this.getLots(productId, branchId).reduce((sum, lot) => sum + lot.quantityAvailable, 0);
  }

  // ============================================================================
  // VENTAS WEB Y PUNTO DE VENTA (POS)
  // ============================================================================

  createWebCheckout(input: PublicCheckoutInput) {
    this.assertReady();
    const items = input.items.map((item) => {
      const product = this.snapshot.products.find((candidate) => candidate.id === item.productId);
      if (!product) {
        throw new Error(`Producto no encontrado: ${item.productId}`);
      }
      const stock = this.getStock(product.id, input.branchId);
      if (stock < item.quantity) {
        throw new Error(`Stock insuficiente para ${product.name}`);
      }
      return {
        product,
        quantity: item.quantity,
        subtotal: item.quantity * product.price
      };
    });
    const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
    const normalizedCode = input.discountCode?.trim().toUpperCase() || null;
    const discount = normalizedCode
      ? this.snapshot.discountCodes.find((item) => item.code === normalizedCode)
      : null;
    if (normalizedCode && !discount) throw new Error('El cÃ³digo de descuento no existe');
    if (discount) assertDiscountCodeUsable(discount, input.customer.email, this.snapshot.discountRedemptions);
    const discountAmount = discount ? calculateDiscountAmount(subtotal, discount.type, discount.value) : 0;

    const requiresPrescription = items.some(({ product }) => product.requiresPrescription);
    if (requiresPrescription && !input.prescriptionWebUrl) {
      throw new Error('La receta mÃ©dica es obligatoria para este carrito.');
    }

    const customer = this.upsertCustomer(input.customer);
    const order: Order = {
      id: ++this.snapshot.counters.order,
      code: code('DK', this.snapshot.counters.order),
      source: 'WEB',
      branchId: input.branchId,
      customerId: customer.id,
      customerEmail: input.customer.email.trim().toLowerCase(),
      employeeId: null,
      deliveryMode: input.deliveryMode,
      address: input.address ?? null,
      deliveryLatitude: input.deliveryLatitude ?? null,
      deliveryLongitude: input.deliveryLongitude ?? null,
      status: 'AWAITING_PAYMENT',
      paymentStatus: 'PENDING',
      requiresPrescription,
      prescriptionWebUrl: input.prescriptionWebUrl ?? null,
      prescriptionDeliveryUrl: null,
      subtotal,
      discountAmount,
      discountCode: discount?.code ?? null,
      total: subtotal - discountAmount,
      createdAt: now(),
      paidAt: null,
      releasedAt: null
    };

    this.snapshot.orders.push(order);
    for (const item of items) {
      this.snapshot.orderItems.push({
        id: ++this.snapshot.counters.orderItem,
        orderId: order.id,
        productId: item.product.id,
        quantity: item.quantity,
        unitPrice: item.product.price,
        subtotal: item.subtotal,
        assignedLotIds: []
      });
    }
    if (discount) {
      this.snapshot.discountRedemptions.push({
        discountCodeId: discount.id,
        orderId: order.id,
        customerEmail: input.customer.email.trim().toLowerCase(),
        status: input.paymentMethod === 'CASH' ? 'REDEEMED' : 'RESERVED',
        createdAt: now()
      });
    }
    this.touch();
    return clone({ order, customer, items });
  }

  createPosSale(input: PosSaleInput, cashierEmployeeId: number) {
    this.assertReady();
    const customer = this.upsertCustomer(input.customer);
    const items = input.items.map((item) => {
      const product = this.snapshot.products.find((candidate) => candidate.id === item.productId);
      if (!product) {
        throw new Error(`Producto no encontrado: ${item.productId}`);
      }
      const stock = this.getStock(product.id, input.branchId);
      if (stock < item.quantity) {
        throw new Error(`Stock insuficiente para ${product.name}`);
      }
      return {
        product,
        quantity: item.quantity,
        subtotal: item.quantity * product.price
      };
    });

    const order: Order = {
      id: ++this.snapshot.counters.order,
      code: code('POS', this.snapshot.counters.order),
      source: 'POS',
      branchId: input.branchId,
      customerId: customer.id,
      employeeId: cashierEmployeeId,
      deliveryMode: 'PICKUP',
      address: null,
      status: 'PAID',
      paymentStatus: 'PAID',
      requiresPrescription: false,
      prescriptionWebUrl: null,
      prescriptionDeliveryUrl: null,
      total: items.reduce((sum, item) => sum + item.subtotal, 0),
      createdAt: now(),
      paidAt: now(),
      releasedAt: null
    };

    this.snapshot.orders.push(order);
    for (const item of items) {
      this.snapshot.orderItems.push({
        id: ++this.snapshot.counters.orderItem,
        orderId: order.id,
        productId: item.product.id,
        quantity: item.quantity,
        unitPrice: item.product.price,
        subtotal: item.subtotal,
        assignedLotIds: this.consumeStock(input.branchId, item.product.id, item.quantity)
      });
    }
    this.snapshot.payments.push({
      id: ++this.snapshot.counters.payment,
      orderId: order.id,
      provider: 'cash',
      transactionId: `cash-${order.id}`,
      amount: order.total,
      status: 'PAID',
      createdAt: now()
    });
    this.snapshot.invoices.push({
      id: ++this.snapshot.counters.invoice,
      orderId: order.id,
      invoiceNumber: `FAC-${String(order.id).padStart(6, '0')}`,
      satCorrelative: `SAT-${String(order.id).padStart(8, '0')}`,
      issuedAt: now(),
      total: order.total,
      emailStatus: 'PENDING',
      emailSentAt: null,
      emailError: null,
      emailAttemptAt: null
    });
    this.touch();
    return clone({ order, customer, items });
  }

  registerPayment(orderId: number, provider: 'stripe' | 'paypal' | 'demo' | 'cash', transactionId: string) {
    this.assertReady();
    const order = this.snapshot.orders.find((candidate) => candidate.id === orderId);
    if (!order) {
      throw new Error('Orden no encontrada');
    }
    if (order.paymentStatus === 'PAID') {
      return clone(order);
    }
    order.paymentStatus = 'PAID';
    order.status = order.deliveryMode === 'PICKUP' ? 'READY_FOR_PICKUP' : 'PACKING';
    order.paidAt = now();
    for (const redemption of this.snapshot.discountRedemptions) {
      if (redemption.orderId === orderId && redemption.status === 'RESERVED') redemption.status = 'REDEEMED';
    }
    this.snapshot.payments.push({
      id: ++this.snapshot.counters.payment,
      orderId,
      provider,
      transactionId,
      amount: order.total,
      status: 'PAID',
      createdAt: now()
    });
    this.snapshot.invoices.push({
      id: ++this.snapshot.counters.invoice,
      orderId,
      invoiceNumber: `FAC-${String(order.id).padStart(6, '0')}`,
      satCorrelative: `SAT-${String(order.id).padStart(8, '0')}`,
      issuedAt: now(),
      total: order.total,
      emailStatus: 'PENDING',
      emailSentAt: null,
      emailError: null,
      emailAttemptAt: null
    });
    this.consumeOrderStock(orderId);
    this.touch();
    return clone(order);
  }

  releaseDiscountRedemption(orderId: number) {
    this.assertReady();
    let changed = false;
    for (const redemption of this.snapshot.discountRedemptions) {
      if (redemption.orderId === orderId && redemption.status === 'RESERVED') {
        redemption.status = 'RELEASED';
        changed = true;
      }
    }
    if (changed) this.touch();
  }

  /**
   * Intenta reservar el envío de correo (transición PENDING → SENDING).
   * Retorna true solo si la factura estaba en PENDING o FAILED (reintento).
   * Bloquea envíos concurrentes para la misma factura.
   */
  reserveInvoiceEmailSend(orderId: number): boolean {
    this.assertReady();
    const invoice = this.snapshot.invoices.find((inv) => inv.orderId === orderId);
    if (!invoice) {
      return false;
    }
    // Solo permitir reserva si está PENDING (primer envío) o FAILED (reintento)
    if (invoice.emailStatus === 'SENT' || invoice.emailStatus === 'SENDING') {
      return false; // Ya enviado o en proceso
    }
    invoice.emailStatus = 'SENDING';
    invoice.emailAttemptAt = now();
    invoice.emailError = null;
    this.touch();
    return true;
  }

  /**
   * Marca el envío como exitoso (transición SENDING → SENT).
   * Solo tiene efecto si estaba en SENDING.
   */
  markInvoiceEmailSent(orderId: number): boolean {
    this.assertReady();
    const invoice = this.snapshot.invoices.find((inv) => inv.orderId === orderId);
    if (!invoice) {
      return false;
    }
    if (invoice.emailStatus !== 'SENDING') {
      return false; // No estaba en proceso de envío
    }
    invoice.emailStatus = 'SENT';
    invoice.emailSentAt = now();
    invoice.emailError = null;
    this.touch();
    return true;
  }

  /**
   * Marca el envío como fallido (transición SENDING → FAILED).
   * Guarda el error para diagnóstico y permite reintentos.
   */
  markInvoiceEmailFailed(orderId: number, error: string): boolean {
    this.assertReady();
    const invoice = this.snapshot.invoices.find((inv) => inv.orderId === orderId);
    if (!invoice) {
      return false;
    }
    if (invoice.emailStatus !== 'SENDING') {
      return false; // No estaba en proceso de envío
    }
    invoice.emailStatus = 'FAILED';
    invoice.emailError = error.slice(0, 500); // Limitar longitud
    this.touch();
    return true;
  }

  /**
   * Obtiene el estado de envío de correo de una factura.
   */
  getInvoiceEmailStatus(orderId: number): { status: EmailStatus | undefined; error: string | null | undefined; attemptAt: string | null | undefined } | null {
    this.assertReady();
    const invoice = this.snapshot.invoices.find((inv) => inv.orderId === orderId);
    if (!invoice) return null;
    return { status: invoice.emailStatus, error: invoice.emailError, attemptAt: invoice.emailAttemptAt };
  }

  /**
   * Recupera correos atascados en estado SENDING por más de 10 minutos.
   * Cambia su estado a FAILED para permitir reintentos controlados.
   * Operación atómica: solo afecta facturas con emailStatus === 'SENDING' y emailAttemptAt > 10 min.
   * Retorna el número de facturas recuperadas.
   *
   * LIMITACIONES EN MODO JSON (memoria local):
   * - No protege contra múltiples instancias del backend: cada proceso tiene su propia memoria.
   * - Al reiniciar el backend, las claves de idempotencia POS (posIdempotencyKeys) se pierden.
   * - La recuperación se ejecuta solo cuando se invoca explícitamente (no hay job programado interno).
   * - En producción con PostgreSQL, usar transacciones y bloqueos de fila (SELECT FOR UPDATE).
   *
   * NOTA: SMTP solo confirma aceptación del mensaje (código 250), NO garantiza entrega en buzón.
   * El estado SENT significa "aceptado por el servidor SMTP", no "entregado al destinatario".
   */
  recoverStuckSendingEmails(maxAgeMinutes: number = 10): number {
    this.assertReady();
    const now = new Date();
    const threshold = new Date(now.getTime() - maxAgeMinutes * 60 * 1000);
    let recovered = 0;

    for (const invoice of this.snapshot.invoices) {
      if (invoice.emailStatus === 'SENDING' && invoice.emailAttemptAt) {
        const attemptAt = new Date(invoice.emailAttemptAt);
        if (attemptAt < threshold) {
          invoice.emailStatus = 'FAILED';
          invoice.emailError = `Recuperado automáticamente: envío SENDING por más de ${maxAgeMinutes} minutos (último intento: ${invoice.emailAttemptAt})`;
          recovered++;
        }
      }
    }

    if (recovered > 0) {
      this.touch();
      console.log(`[Store] Recuperados ${recovered} correos atascados en SENDING (>${maxAgeMinutes} min) → FAILED`);
    }
    return recovered;
  }

  /**
   * Reintenta el envío de correos en estado FAILED, con límite de intentos y espera progresiva.
   * No reintenta correos ya marcados SENT.
   * Requiere que el servicio de correo esté configurado (initializeEmailService).
   * Retorna { attempted: number, succeeded: number, failed: number }.
   *
   * Para producción con múltiples instancias, implementar bloqueo distribuido (ej. pg_advisory_lock)
   * o cola de trabajos (ej. BullMQ) en lugar de invocación directa.
   */
  async retryFailedEmails(
    maxAttempts: number = 3,
    baseDelayMs: number = 60000,
    sendFn: (params: { customerEmail: string; customerName: string; orderCode: string; invoiceNumber: string; total: number; pdfBuffer: Buffer; isOnline: boolean }) => Promise<{ success: boolean; messageId?: string; error?: string }>
  ): Promise<{ attempted: number; succeeded: number; failed: number }> {
    this.assertReady();

    const failedInvoices = this.snapshot.invoices.filter(inv => inv.emailStatus === 'FAILED');
    let attempted = 0, succeeded = 0, failed = 0;

    for (const invoice of failedInvoices) {
      // Contar intentos previos (aproximado: cada vez que pasa a FAILED cuenta como intento)
      // En implementación completa, añadir campo emailAttemptCount a Invoice.
      // Aquí usamos heurística: si emailError contiene "Recuperado automáticamente", es primer reintento.
      const isFirstRetry = invoice.emailError?.includes('Recuperado automáticamente') ?? true;

      // Límite simple: no reintentar más de maxAttempts veces
      // (En producción, añadir contador persistente)
      if (!isFirstRetry && maxAttempts <= 1) continue;

      attempted++;

      try {
        // Obtener datos necesarios para reenvío
        const order = this.snapshot.orders.find(o => o.id === invoice.orderId);
        if (!order) {
          console.warn(`[Store] Reintento fallido: orden ${invoice.orderId} no encontrada para factura ${invoice.id}`);
          failed++;
          continue;
        }
        const customer = this.snapshot.customers.find(c => c.id === order.customerId);
        if (!customer || !customer.email) {
          console.warn(`[Store] Reintento fallido: cliente sin email para orden ${order.id}`);
          failed++;
          continue;
        }

        // Reservar atómicamente (PENDING/FAILED → SENDING)
        const reserved = this.reserveInvoiceEmailSend(invoice.orderId);
        if (!reserved) {
          console.log(`[Store] Reintento omitido: factura ${invoice.id} ya no en estado reintentable`);
          attempted--;
          continue;
        }

        // Generar PDF
        const { pdfBuffer } = await generarFacturaDesdeOrden(invoice.orderId, order.source === 'WEB');

        // Enviar con espera progresiva (backoff exponencial simple)
        const delay = baseDelayMs * Math.pow(2, isFirstRetry ? 0 : 1);
        if (delay > 0) await new Promise(r => setTimeout(r, delay));

        const result = await sendFn({
          customerEmail: customer.email,
          customerName: customer.name,
          orderCode: order.code,
          invoiceNumber: invoice.invoiceNumber,
          total: invoice.total,
          pdfBuffer,
          isOnline: order.source === 'WEB'
        });

        if (result.success) {
          this.markInvoiceEmailSent(invoice.orderId);
          succeeded++;
          console.log(`[Store] Reintento exitoso: factura ${invoice.id} → SENT (MessageID: ${result.messageId})`);
        } else {
          this.markInvoiceEmailFailed(invoice.orderId, result.error ?? 'Error SMTP en reintento');
          failed++;
          console.error(`[Store] Reintento fallido: factura ${invoice.id} → FAILED (${result.error})`);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Error desconocido en reintento';
        this.markInvoiceEmailFailed(invoice.orderId, errorMsg);
        failed++;
        console.error(`[Store] Excepción en reintento factura ${invoice.id}:`, errorMsg);
      }
    }

    return { attempted, succeeded, failed };
  }

  /**
   * Verifica y registra una clave de idempotencia para ventas POS.
   * Retorna { isDuplicate: boolean, existingOrderId?: number, fingerprintMatch?: boolean }.
   * Si es duplicado (mismo key en últimos 5 min), retorna el orderId existente.
   * Valida la huella de la solicitud para evitar colisiones con contenido diferente.
   */
  checkPosIdempotency(key: string, requestFingerprint: string): { isDuplicate: boolean; existingOrderId?: number; fingerprintMatch?: boolean } {
    const now = Date.now();
    const entry = this.posIdempotencyKeys.get(key);
    // Limpiar entradas antiguas (> 5 min)
    if (entry && now - entry.timestamp > 5 * 60 * 1000) {
      this.posIdempotencyKeys.delete(key);
      return { isDuplicate: false };
    }
    if (entry) {
      return { isDuplicate: true, existingOrderId: entry.orderId, fingerprintMatch: entry.fingerprint === requestFingerprint };
    }
    return { isDuplicate: false };
  }

  /** Registra una clave de idempotencia tras crear una venta POS exitosa */
  registerPosIdempotency(key: string, orderId: number, requestFingerprint: string): void {
    this.posIdempotencyKeys.set(key, { orderId, timestamp: Date.now(), fingerprint: requestFingerprint });
  }

  private consumeOrderStock(orderId: number) {
    const orderItems = this.snapshot.orderItems.filter((item) => item.orderId === orderId);
    const order = this.snapshot.orders.find((candidate) => candidate.id === orderId);
    if (!order) {
      return;
    }
    for (const item of orderItems) {
      item.assignedLotIds = this.consumeStock(order.branchId, item.productId, item.quantity);
    }
  }

  /**
   * Deduce el inventario aplicando la regla FEFO (First Expired, First Out).
   * Ordena los lotes por `expirationDate` ascendente y descuenta progresivamente.
   */
  private consumeStock(branchId: number, productId: number, quantity: number) {
    const lots = this.snapshot.lots
      .filter((lot) => lot.branchId === branchId && lot.productId === productId)
      .sort((left, right) => left.expirationDate.localeCompare(right.expirationDate));
    let remaining = quantity;
    const consumed: number[] = [];
    for (const lot of lots) {
      if (remaining <= 0) {
        break;
      }
      const taken = Math.min(lot.quantityAvailable, remaining);
      if (taken > 0) {
        lot.quantityAvailable -= taken;
        remaining -= taken;
        consumed.push(lot.id);
      }
    }
    if (remaining > 0) {
      throw new Error('Stock insuficiente al consumir inventario');
    }
    return consumed;
  }

  listPickupOrders(branchId: number) {
    this.assertReady();
    return this.snapshot.orders
      .filter((order) => order.branchId === branchId)
      .filter((order) => order.deliveryMode === 'PICKUP')
      .filter((order) => order.paymentStatus === 'PAID')
      .map((order) => this.enrichOrder(order));
  }

  releasePickupOrder(orderId: number, employeeId: number, prescriptionDeliveryUrl?: string | null) {
    this.assertReady();
    const order = this.snapshot.orders.find((candidate) => candidate.id === orderId);
    if (!order) {
      throw new Error('Orden no encontrada');
    }
    order.employeeId = employeeId;
    if (prescriptionDeliveryUrl) {
      order.prescriptionDeliveryUrl = prescriptionDeliveryUrl;
    }
    order.status = 'DELIVERED';
    order.releasedAt = now();
    this.touch();
    return clone(this.enrichOrder(order));
  }

  receiveGoods(input: ReceiveGoodsInput) {
    this.assertReady();
    const lot: Lot = {
      id: ++this.snapshot.counters.lot,
      productId: input.productId,
      branchId: input.branchId,
      supplierId: input.supplierId,
      batchCode: input.batchCode,
      expirationDate: input.expirationDate,
      productionDate: input.productionDate,
      costPrice: input.costPrice,
      salePrice: input.salePrice,
      quantityAvailable: input.quantity
    };
    this.snapshot.lots.push(lot);
    this.touch();
    return clone(lot);
  }

  // ============================================================================
  // GESTIÃ“N DE PERSONAL Y PERMISOS
  // ============================================================================

  addEmployee(input: {
    fullName: string;
    email: string;
    password: string;
    role: Role;
    branchId: number | null;
    supervisorId: number | null;
  }) {
    this.assertReady();
    const employee: Employee = {
      id: ++this.snapshot.counters.employee,
      fullName: input.fullName,
      email: input.email,
      password: bcrypt.hashSync(input.password, 12),
      role: input.role,
      branchId: input.branchId,
      supervisorId: input.supervisorId,
      active: true
    };
    this.snapshot.employees.push(employee);
    this.touch();
    return clone(employee);
  }

  updateEmployee(id: number, input: Partial<Omit<Employee, 'id'>>) {
    this.assertReady();
    const employee = this.snapshot.employees.find((item) => item.id === id);
    if (!employee) throw new Error(`Empleado #${id} no encontrado`);
    Object.assign(employee, {
      ...input,
      ...(input.password ? { password: bcrypt.hashSync(input.password, 12) } : {})
    });
    this.touch();
    return clone(employee);
  }

  deleteEmployee(id: number) {
    this.assertReady();
    const employee = this.snapshot.employees.find((item) => item.id === id);
    if (!employee) throw new Error(`Empleado #${id} no encontrado`);
    employee.active = false;
    this.touch();
    return clone(employee);
  }

  // ============================================================================
  // AUDITORÃA Y CONTROL DE CALIDAD
  // ============================================================================

  crosscheckOrder(orderId: number, input: CrosscheckInput) {
    this.assertReady();
    const record: CrosscheckRecord = {
      id: ++this.snapshot.counters.crosscheck,
      orderId,
      reviewerEmployeeId: input.reviewerEmployeeId,
      approved: input.approved,
      notes: input.notes ?? '',
      createdAt: now()
    };
    this.snapshot.crosschecks.push(record);
    this.touch();
    return clone(record);
  }

  createReturn(orderId: number, employeeId: number, reason: string, destiny: 'REINTEGRATION' | 'DISPOSAL') {
    this.assertReady();
    const record: ReturnRecord = {
      id: ++this.snapshot.counters.return,
      orderId,
      employeeId,
      reason,
      destiny,
      createdAt: now()
    };
    this.snapshot.returns.push(record);
    this.touch();
    return clone(record);
  }

  private enrichOrder(order: Order) {
    const items = this.snapshot.orderItems
      .filter((item) => item.orderId === order.id)
      .map((item) => ({
        ...item,
        product: this.snapshot.products.find((product) => product.id === item.productId) ?? null
      }));
    const customer = this.snapshot.customers.find((candidate) => candidate.id === order.customerId) ?? null;
    const branch = this.snapshot.branches.find((candidate) => candidate.id === order.branchId) ?? null;
    const { passwordHash: _passwordHash, ...safeCustomer } = customer ?? { passwordHash: undefined };
    return { ...clone(order), items, customer: customer ? safeCustomer : null, branch };
  }

  customerOwnsOrder(customerId: number, order: Order) {
    this.assertReady();
    const account = this.snapshot.customers.find((candidate) => candidate.id === customerId);
    if (!account) return false;
    const ownedIds = this.snapshot.customers
      .filter((candidate) => candidate.email.toLowerCase() === account.email.toLowerCase())
      .map((candidate) => candidate.id);
    if (!ownedIds.includes(order.customerId)) return false;
    if (order.customerEmail) return order.customerEmail.toLowerCase() === account.email.toLowerCase();
    return Boolean(account.address && order.address?.trim().toLowerCase() === account.address.trim().toLowerCase());
  }

  getOrderByIdForCustomer(customerId: number, orderId: number) {
    this.assertReady();
    const order = this.snapshot.orders.find((candidate) => candidate.id === orderId);
    if (!order || !this.customerOwnsOrder(customerId, order)) return null;
    return this.enrichOrder(order);
  }

  findOrderByCodeForCustomer(customerId: number, codeValue: string) {
    this.assertReady();
    const order = this.snapshot.orders.find((candidate) => candidate.code === codeValue);
    if (!order || !this.customerOwnsOrder(customerId, order)) return null;
    return this.enrichOrder(order);
  }

  getOrderById(orderId: number) {
    this.assertReady();
    const order = this.snapshot.orders.find((candidate) => candidate.id === orderId);
    return order ? this.enrichOrder(order) : null;
  }

  findOrderByCode(codeValue: string) {
    this.assertReady();
    const order = this.snapshot.orders.find((candidate) => candidate.code === codeValue);
    return order ? this.enrichOrder(order) : null;
  }

  attachPrescription(orderId: number, kind: 'web' | 'delivery', url: string) {
    this.assertReady();
    const order = this.snapshot.orders.find((candidate) => candidate.id === orderId);
    if (!order) {
      throw new Error('Orden no encontrada');
    }
    if (kind === 'web') {
      order.prescriptionWebUrl = url;
    } else {
      order.prescriptionDeliveryUrl = url;
    }
    this.touch();
    return clone(this.enrichOrder(order));
  }

  listPendingOrders(branchId?: number) {
    this.assertReady();
    return this.snapshot.orders
      .filter((order) => order.paymentStatus === 'PENDING' || order.status === 'AWAITING_PAYMENT' || order.status === 'PAID' || order.status === 'PACKING' || order.status === 'READY_FOR_PICKUP' || order.status === 'IN_ROUTE')
      .filter((order) => (branchId ? order.branchId === branchId : true))
      .map((order) => this.enrichOrder(order));
  }

  listDeliveries(branchId: number, assignee: { employeeId: number; role: Role } | null) {
    this.assertReady();
    return this.snapshot.orders
      .filter((order) => order.deliveryMode === 'DELIVERY')
      .filter((order) => order.status !== 'DELIVERED' && order.status !== 'CANCELLED')
      .filter((order) => (branchId ? order.branchId === branchId : true))
      .filter((order) => {
        if (!assignee || assignee.role === 'Administrador' || assignee.role === 'Gerente') return true;
        if (order.assignedEmployeeId != null) return order.assignedEmployeeId === assignee.employeeId;
        return true;
      })
      .map((order) => this.enrichOrder(order));
  }

  getDeliveryOwnership(orderId: number) {
    this.assertReady();
    const order = this.snapshot.orders.find((candidate) => candidate.id === orderId);
    if (!order || order.deliveryMode !== 'DELIVERY') return null;
    return { branchId: order.branchId, assignedEmployeeId: order.assignedEmployeeId ?? null };
  }

  claimDelivery(orderId: number, employeeId: number) {
    this.assertReady();
    const order = this.snapshot.orders.find((candidate) => candidate.id === orderId);
    if (!order) throw new Error('Entrega no encontrada');
    if (order.assignedEmployeeId == null) {
      order.assignedEmployeeId = employeeId;
      this.touch();
    }
    return clone(this.enrichOrder(order));
  }

  // ============================================================================
  // ANALÃTICA, DASHBOARD Y REPORTES
  // ============================================================================

  getDashboard(): DashboardMetrics {
    this.assertReady();
    const today = startOfDay(new Date());
    const month = startOfMonth(new Date());
    const salesToday = this.snapshot.orders
      .filter((order) => order.paymentStatus === 'PAID')
      .filter((order) => new Date(order.paidAt ?? order.createdAt) >= today)
      .reduce((sum, order) => sum + order.total, 0);
    const salesMonth = this.snapshot.orders
      .filter((order) => order.paymentStatus === 'PAID')
      .filter((order) => new Date(order.paidAt ?? order.createdAt) >= month)
      .reduce((sum, order) => sum + order.total, 0);
    const lowStockProducts = this.snapshot.products.flatMap((product) => this.snapshot.branches.flatMap((branch) => {
      if (!this.snapshot.lots.some((lot) => lot.productId === product.id && lot.branchId === branch.id)) return [];
      const stock = this.getStock(product.id, branch.id);
      if (stock > 10) return [];
      return [{
        productId: product.id,
        name: product.name,
        sku: product.sku,
        branchId: branch.id,
        branchName: branch.name,
        stock,
        severity: stock <= 0 ? 'critical' as const : stock <= 5 ? 'urgent' as const : 'low' as const
      }];
    })).sort((left, right) => left.stock - right.stock || left.name.localeCompare(right.name));
    const lowStockCount = new Set(lowStockProducts.map((item) => item.productId)).size;
    const expiringLotsCount = this.snapshot.lots.filter((lot) => {
      const diffDays = Math.ceil((new Date(lot.expirationDate).getTime() - Date.now()) / 86_400_000);
      return diffDays < 90;
    }).length;
    const pendingOrders = this.snapshot.orders.filter((order) => ['AWAITING_PAYMENT', 'PAID', 'PACKING', 'READY_FOR_PICKUP', 'IN_ROUTE'].includes(order.status)).length;
    return {
      salesToday,
      salesMonth,
      lowStockCount,
      expiringLotsCount,
      registeredCustomers: this.snapshot.customers.length,
      pendingOrders,
      suppliersCount: this.snapshot.suppliers.length,
      lowStockProducts
    };
  }

  getReports() {
    this.assertReady();
    const salesByMonth = new Map<string, number>();
    const salesByBranch = new Map<number, number>();
    const salesByEmployee = new Map<number, number>();
    const salesByProduct = new Map<number, { name: string; quantity: number; total: number }>();
    const purchasesBySupplier = new Map<number, number>();
    let grossProfit = 0;

    for (const order of this.snapshot.orders.filter((candidate) => candidate.paymentStatus === 'PAID')) {
      const key = monthKey(new Date(order.paidAt ?? order.createdAt));
      salesByMonth.set(key, (salesByMonth.get(key) ?? 0) + order.total);
      salesByBranch.set(order.branchId, (salesByBranch.get(order.branchId) ?? 0) + order.total);
      if (order.employeeId) {
        salesByEmployee.set(order.employeeId, (salesByEmployee.get(order.employeeId) ?? 0) + order.total);
      }
      for (const item of this.snapshot.orderItems.filter((orderItem) => orderItem.orderId === order.id)) {
        const product = this.snapshot.products.find((candidate) => candidate.id === item.productId);
        if (product) {
          const current = salesByProduct.get(product.id) ?? { name: product.name, quantity: 0, total: 0 };
          current.quantity += item.quantity;
          current.total += item.subtotal;
          salesByProduct.set(product.id, current);
          grossProfit += item.subtotal - item.quantity * product.cost;
        }
      }
    }

    for (const lot of this.snapshot.lots) {
      purchasesBySupplier.set(lot.supplierId, (purchasesBySupplier.get(lot.supplierId) ?? 0) + lot.quantityAvailable * lot.costPrice);
    }

    const topProducts = [...salesByProduct.values()].sort((left, right) => right.total - left.total).slice(0, 10);
    const branchRows = this.snapshot.branches.map((branch) => ({ branch: branch.name, total: salesByBranch.get(branch.id) ?? 0 }));
    const employeeRows = this.snapshot.employees.filter((employee) => employee.role === 'Cajero').map((employee) => ({ employee: employee.fullName, total: salesByEmployee.get(employee.id) ?? 0 }));
    const monthlyRows = [...salesByMonth.entries()].map(([key, total]) => ({ month: key, total })).sort((left, right) => left.month.localeCompare(right.month));
    const purchaseRows = this.snapshot.suppliers.map((supplier) => ({ supplier: supplier.name, total: purchasesBySupplier.get(supplier.id) ?? 0 }));

    return {
      monthlySales: monthlyRows,
      topProducts,
      salesByBranch: branchRows,
      salesByEmployee: employeeRows,
      profitMonthly: monthlyRows.map((row) => ({ month: row.month, total: grossProfit })),
      purchasesBySupplier: purchaseRows
    };
  }

  getState() {
    this.assertReady();
    return clone(this.snapshot);
  }

  getPersistenceMode() {
    return databaseEnabled ? 'postgresql' : 'local-json';
  }

  getCustomerById(id: number) {
    this.assertReady();
    return this.snapshot.customers.find((customer) => customer.id === id) ?? null;
  }

  getBranchById(id: number) {
    this.assertReady();
    return this.snapshot.branches.find((branch) => branch.id === id) ?? null;
  }

  getInvoiceByOrderId(orderId: number) {
    this.assertReady();
    return this.snapshot.invoices.find((invoice) => invoice.orderId === orderId) ?? null;
  }

  getPaymentByOrderId(orderId: number) {
    this.assertReady();
    return this.snapshot.payments.find((payment) => payment.orderId === orderId) ?? null;
  }

  getOrderItems(orderId: number) {
    this.assertReady();
    return this.snapshot.orderItems
      .filter((item) => item.orderId === orderId)
      .map((item) => ({
        ...item,
        product: this.snapshot.products.find((p) => p.id === item.productId) ?? null
      }));
  }

  getEmployeeById(id: number) {
    this.assertReady();
    const employee = this.snapshot.employees.find((item) => item.id === id);
    return employee && employee.active ? employee : null;
  }

  findEmployeeByCredentials(email: string, password: string) {
    this.assertReady();
    const employee = this.snapshot.employees.find((item) => item.email.toLowerCase() === email.toLowerCase() && item.active);
    if (!employee) return null;
    const valid = employee.password.startsWith('$2')
      ? bcrypt.compareSync(password, employee.password)
      : password === employee.password;
    if (!valid) return null;
    return clone(employee);
  }
}

export const store = new PharmacyStore();
