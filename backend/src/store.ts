import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
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

function getStorageFilePath() {
  const cwd = process.cwd();
  const pathInBackendBackend = resolve(cwd, 'backend', 'data', 'dev-store.json');
  const pathInBackendData = resolve(cwd, 'data', 'dev-store.json');
  if (existsSync(pathInBackendBackend)) return pathInBackendBackend;
  if (existsSync(pathInBackendData)) return pathInBackendData;
  return pathInBackendBackend;
}

const storageFile = getStorageFilePath();

function now() {
  return new Date().toISOString();
}

function monthKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function startOfDay(value: string | Date) {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function startOfMonth(value: string | Date) {
  const date = new Date(value);
  date.setUTCDate(1);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function code(prefix: string, id: number) {
  return `${prefix}-${String(id).padStart(5, '0')}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class PharmacyStore {
  private snapshot!: DataSnapshot;
  private ready: Promise<void>;

  constructor() {
    this.ready = this.load();
  }

  async waitUntilReady() {
    await this.ready;
  }

  private async load() {
    if (databaseEnabled) {
      await initializeDatabase();
      const databaseSnapshot = await loadDatabaseSnapshot();
      if (databaseSnapshot) {
        this.snapshot = databaseSnapshot;
        return;
      }
      this.snapshot = this.seed();
      await saveDatabaseSnapshot(this.snapshot);
      return;
    }

    try {
      const raw = await readFile(storageFile, 'utf8');
      this.snapshot = JSON.parse(raw) as DataSnapshot;
      if (!this.snapshot.counters.product) {
        this.snapshot.counters.product = Math.max(0, ...this.snapshot.products.map((p) => p.id));
      }
      return;
    } catch {
      this.snapshot = this.seed();
      await this.save();
    }
  }

  private async save() {
    if (databaseEnabled) {
      await saveDatabaseSnapshot(this.snapshot);
      return;
    }
    await mkdir(dirname(storageFile), { recursive: true });
    await writeFile(storageFile, JSON.stringify(this.snapshot, null, 2), 'utf8');
  }

  private seed(): DataSnapshot {
    const branches: Branch[] = [
      { id: 1, name: 'Antigua Central', city: 'Antigua Guatemala', address: '7a Avenida Norte 12' },
      { id: 2, name: 'Ciudad Vieja', city: 'Ciudad Vieja', address: '5a Calle Oriente 8' },
      { id: 3, name: 'Jocotenango', city: 'Jocotenango', address: 'Avenida Central 14' },
      { id: 4, name: 'Pastores', city: 'Pastores', address: 'Calzada Principal 22' },
      { id: 5, name: 'San Lucas', city: 'San Lucas Sacatepéquez', address: 'Ruta Interamericana Km 28' },
      { id: 6, name: 'Santa María', city: 'Santa María de Jesús', address: 'Zona 1, Calle Real' },
      { id: 7, name: 'Dueñas', city: 'Dueñas', address: 'Entrada principal lote 3' }
    ];

    const categories: Category[] = [
      { id: 1, name: 'Medicamentos', parentId: null },
      { id: 2, name: 'Analgésicos', parentId: 1 },
      { id: 3, name: 'Antibióticos', parentId: 1 },
      { id: 4, name: 'Línea Pediátrica', parentId: 1 },
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
        active: true,
        description: 'Antibiótico de amplio espectro con control sanitario.',
        price: 145,
        cost: 97,
        imageUrl: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&w=600&q=80'
      },
      {
        id: 2,
        sku: 'SKU-ACETA-500',
        name: 'Acetaminofén Genfar 500mg',
        categoryId: 2,
        brand: 'Genfar',
        laboratory: 'Laboratorios Genfar',
        presentation: 'Caja x 10 tabletas',
        unitMeasure: 'tableta',
        sanitaryRegistry: 'MSPAS-2026-4410',
        requiresPrescription: false,
        active: true,
        description: 'Analgésico y antipirético de alta rotación.',
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
        active: true,
        description: 'Anti-inflamatorio para venta libre.',
        price: 28,
        cost: 12,
        imageUrl: 'https://images.unsplash.com/photo-1471864190281-a93a3070b6de?auto=format&fit=crop&w=600&q=80'
      },
      {
        id: 4,
        sku: 'SKU-JARABE-120',
        name: 'Jarabe Pediátrico Multivitamínico',
        categoryId: 4,
        brand: 'PediaLife',
        laboratory: 'PediaLife S.A.',
        presentation: 'Frasco x 120 ml',
        unitMeasure: 'frasco',
        sanitaryRegistry: 'MSPAS-2026-9912',
        requiresPrescription: false,
        active: true,
        description: 'Suplemento infantil de rotación media.',
        price: 48,
        cost: 26,
        imageUrl: 'https://images.unsplash.com/photo-1577401239170-897942555fb3?auto=format&fit=crop&w=600&q=80'
      }
    ];

    const suppliers: Supplier[] = [
      { id: 1, name: 'Laboratorios Genfar', nit: '5489321-4', email: 'compras@genfar.com', phone: '2299-0011', address: 'Zona 10, Ciudad de Guatemala', active: true },
      { id: 2, name: 'Laboratorios MK', nit: '1458992-7', email: 'ventas@mk.com', phone: '2233-7788', address: 'Zona 4, Ciudad de Guatemala', active: true },
      { id: 3, name: 'PediaLife S.A.', nit: '7744211-3', email: 'pedidos@pedialife.com', phone: '2255-8811', address: 'Mixco, Guatemala', active: true }
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
        product: 4
      }
    };
  }

  private assertReady() {
    if (!this.snapshot) {
      throw new Error('Store not ready');
    }
  }

  private touch() {
    void this.save();
  }

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

  getProducts() {
    this.assertReady();
    return clone(this.snapshot.products);
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
    if (input.categoryId !== undefined) product.categoryId = Number(input.categoryId);
    if (input.brand !== undefined) product.brand = input.brand.trim();
    if (input.laboratory !== undefined) product.laboratory = input.laboratory.trim();
    if (input.presentation !== undefined) product.presentation = input.presentation.trim();
    if (input.unitMeasure !== undefined) product.unitMeasure = input.unitMeasure.trim();
    if (input.sanitaryRegistry !== undefined) product.sanitaryRegistry = input.sanitaryRegistry.trim();
    if (input.requiresPrescription !== undefined) product.requiresPrescription = Boolean(input.requiresPrescription);
    if (input.active !== undefined) product.active = Boolean(input.active);
    if (input.description !== undefined) product.description = input.description.trim();
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
      throw new Error('No se puede eliminar una sucursal con órdenes o inventario asociado');
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
    if (!category) throw new Error(`Categoría #${id} no encontrada`);
    Object.assign(category, input);
    this.touch();
    return clone(category);
  }

  deleteCategory(id: number) {
    this.assertReady();
    if (this.snapshot.products.some((product) => product.categoryId === id) || this.snapshot.categories.some((category) => category.parentId === id)) {
      throw new Error('No se puede eliminar una categoría que tiene productos o subcategorías');
    }
    const index = this.snapshot.categories.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`Categoría #${id} no encontrada`);
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

  getCustomerByIdentifier(nit: string, email: string) {
    this.assertReady();
    return this.snapshot.customers.find((customer) => customer.nit === nit || customer.email === email) ?? null;
  }

  upsertCustomer(input: PublicCheckoutInput['customer']) {
    this.assertReady();
    const existing = this.snapshot.customers.find((customer) => customer.nit === input.nit || customer.email === input.email);
    if (existing) {
      existing.name = input.name;
      existing.phone = input.phone;
      existing.email = input.email;
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

  searchCatalog(query: string, branchId?: number) {
    this.assertReady();
    const normalized = query.trim().toLowerCase();
    return this.snapshot.products
      .filter((product) => product.active)
      .filter((product) => {
        if (!normalized) {
          return true;
        }
        return [product.name, product.brand, product.laboratory, product.sku].some((text) => text.toLowerCase().includes(normalized));
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

  createWebCheckout(input: PublicCheckoutInput) {
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

    const requiresPrescription = items.some(({ product }) => product.requiresPrescription);
    if (requiresPrescription && !input.prescriptionWebUrl) {
      throw new Error('La receta médica es obligatoria para este carrito.');
    }

    const order: Order = {
      id: ++this.snapshot.counters.order,
      code: code('DK', this.snapshot.counters.order),
      source: 'WEB',
      branchId: input.branchId,
      customerId: customer.id,
      employeeId: null,
      deliveryMode: input.deliveryMode,
      address: input.address ?? null,
      status: 'AWAITING_PAYMENT',
      paymentStatus: 'PENDING',
      requiresPrescription,
      prescriptionWebUrl: input.prescriptionWebUrl ?? null,
      prescriptionDeliveryUrl: null,
      total: items.reduce((sum, item) => sum + item.subtotal, 0),
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
      total: order.total
    });
    this.touch();
    return clone({ order, customer, items });
  }

  registerPayment(orderId: number, provider: 'stripe' | 'paypal' | 'demo', transactionId: string) {
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
      total: order.total
    });
    this.consumeOrderStock(orderId);
    this.touch();
    return clone(order);
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
      password: input.password,
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
    Object.assign(employee, input);
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
    return { ...clone(order), items, customer, branch };
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
    const lowStockCount = this.snapshot.products.filter((product) => this.snapshot.branches.some((branch) => this.getStock(product.id, branch.id) > 0 && this.getStock(product.id, branch.id) <= 10)).length;
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
      pendingOrders
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

  getEmployeeById(id: number) {
    this.assertReady();
    return this.snapshot.employees.find((employee) => employee.id === id) ?? null;
  }

  findEmployeeByCredentials(email: string, password: string) {
    this.assertReady();
    return this.snapshot.employees.find((employee) => employee.email === email && employee.password === password && employee.active) ?? null;
  }
}

export const store = new PharmacyStore();
