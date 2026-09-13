/**
 * ============================================================================
 * PROYECTO FARMACIA - MODELO DE DOMINIO Y TIPOS PRINCIPALES
 * ============================================================================
 * Este archivo define las entidades centrales del sistema de farmacia:
 * - Roles de usuarios y permisos
 * - Catálogo de productos y categorías
 * - Proveedores y control de lotes con trazabilidad (FEFO)
 * - Clientes y cuentas de usuario
 * - Órdenes de compra (Web, POS, Pickup)
 * - Pagos, facturación electrónica y auditoría
 *
 * MÉTODOS Y PATRONES APLICADOS:
 * - Tipado estático con TypeScript para seguridad en tiempo de compilación.
 * - Desacoplamiento de interfaces de entrada (DTOs de creación) y modelos de entidad.
 * - Trazabilidad por lote (batchCode, fecha de vencimiento y producción).
 * ============================================================================
 */

// ============================================================================
// SECCIÓN 1: ROLES Y ESTADOS DEL SISTEMA
// ============================================================================

/**
 * Roles disponibles en el sistema de gestión farmacéutica:
 * - 'Administrador': Control total del sistema, reportes, sucursales y personal.
 * - 'Gerente': Supervisión de sucursal, inventarios y aprobaciones.
 * - 'Cajero': Punto de venta (POS) y cobros directos.
 * - 'Bodeguero': Ingreso de mercadería, lotes y traslados.
 * - 'Repartidor': Gestión y entrega de pedidos a domicilio.
 * - 'Proveedor': Gestión de suministros asociados.
 */
export type Role = 'Administrador' | 'Gerente' | 'Cajero' | 'Bodeguero' | 'Repartidor' | 'Proveedor';

/**
 * Origen de procedencia de la orden:
 * - 'WEB': Compras en línea a través del portal de clientes.
 * - 'POS': Venta directa en mostrador físico.
 * - 'PICKUP': Compra realizada para retiro en tienda física.
 */
export type OrderSource = 'WEB' | 'POS' | 'PICKUP';

/**
 * Estado del pago asociado a la transacción:
 * - 'PENDING': Pago pendiente de procesar o verificar.
 * - 'PAID': Pago liquidado y confirmado exitosamente.
 * - 'FAILED': Falló la transacción bancaria/pasarela.
 * - 'REFUNDED': Monto reembolsado al cliente.
 */
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';

/**
 * Flujo de vida de una orden farmacéutica:
 * - 'CREATED': Creada en el sistema.
 * - 'AWAITING_PAYMENT': Esperando aprobación de pasarela o pago en caja.
 * - 'PAID': Pagada, lista para ser procesada.
 * - 'PACKING': En preparación/empaque en bodega o farmacia.
 * - 'READY_FOR_PICKUP': Lista para retiro por el cliente.
 * - 'IN_ROUTE': En camino con el repartidor.
 * - 'DELIVERED': Entregada al cliente final.
 * - 'CANCELLED': Anulada por rechazo de receta, falta de stock o cancelación.
 */
export type OrderStatus = 'CREATED' | 'AWAITING_PAYMENT' | 'PAID' | 'PACKING' | 'READY_FOR_PICKUP' | 'IN_ROUTE' | 'DELIVERED' | 'CANCELLED';

// ============================================================================
// SECCIÓN 2: ESTRUCTURA ORGANIZACIONAL (SUCURSALES Y CATEGORÍAS)
// ============================================================================

/**
 * Representa una sucursal o farmacia física de la cadena.
 */
export interface Branch {
  /** Identificador único autonumérico */
  id: number;
  /** Nombre comercial o descriptivo de la sucursal */
  name: string;
  /** Ciudad o municipio donde opera */
  city: string;
  /** Dirección física completa */
  address: string;
}

/**
 * Categorías de productos farmacéuticos (permite jerarquías padre-hijo).
 */
export interface Category {
  /** Identificador único de la categoría */
  id: number;
  /** Nombre de la categoría (ej: Analgésicos, Cuidado Personal) */
  name: string;
  /** ID de la categoría padre (null si es categoría principal) */
  parentId: number | null;
}

// ============================================================================
// SECCIÓN 3: CATÁLOGO DE PRODUCTOS Y MEDICAMENTOS
// ============================================================================

/**
 * Modelo completo de un producto o medicamento en inventario.
 */
export interface Product {
  /** Identificador único */
  id: number;
  /** Código único de inventario / código de barras */
  sku: string;
  /** Nombre comercial del producto */
  name: string;
  /** Categoría a la que pertenece */
  categoryId: number | null;
  /** Marca comercial */
  brand: string;
  /** Laboratorio farmacéutico fabricante */
  laboratory: string;
  /** Presentación (ej: Caja x 30 tabletas, Frasco 120ml) */
  presentation: string;
  /** Unidad de medida (ej: mg, ml, unidad) */
  unitMeasure: string;
  /** Registro sanitario oficial ante el Ministerio de Salud */
  sanitaryRegistry: string;
  /** Indica si requiere receta médica para su venta */
  requiresPrescription: boolean;
  /** Estado activo o descontinuado en catálogo */
  active: boolean;
  /** Descripción terapéutica, indicaciones o especificaciones */
  description: string;
  /** Precio de venta al público final */
  price: number;
  /** Costo base de adquisición */
  cost: number;
  /** URL o ruta del archivo de imagen del producto */
  imageUrl?: string | null;
}

/**
 * DTO (Data Transfer Object) para el registro de nuevos productos.
 * Permite registrar opcionalmente el primer lote de stock inicial.
 */
export interface CreateProductInput {
  sku: string;
  name: string;
  categoryId: number | null;
  brand: string;
  laboratory: string;
  presentation: string;
  unitMeasure: string;
  sanitaryRegistry: string;
  requiresPrescription: boolean;
  active?: boolean;
  description: string;
  price: number;
  cost: number;
  imageUrl?: string | null;
  /** Lote inicial opcional que se da de alta automáticamente al crear el producto */
  initialStock?: {
    branchId: number;
    supplierId: number;
    batchCode: string;
    expirationDate: string;
    productionDate: string;
    quantity: number;
  } | null;
}

// ============================================================================
// SECCIÓN 4: PROVEEDORES Y LOTES DE INVENTARIO (TRAZABILIDAD FEFO)
// ============================================================================

/**
 * Proveedor o laboratorio que abastece insumos médicos.
 */
export interface Supplier {
  id: number;
  name: string;
  /** Número de Identificación Tributaria */
  nit: string;
  email: string;
  phone: string;
  address: string;
  active: boolean;
}

/**
 * Lote individual de medicamentos.
 * Crucial para la regla FEFO (First Expired, First Out):
 * Los medicamentos se despachan priorizando aquellos con fecha de caducidad más cercana.
 */
export interface Lot {
  id: number;
  productId: number;
  branchId: number;
  supplierId: number;
  /** Número o código de lote de fabricación */
  batchCode: string;
  /** Fecha de vencimiento (ISO YYYY-MM-DD) */
  expirationDate: string;
  /** Fecha de elaboración del lote */
  productionDate: string;
  /** Costo unitario al que se compró este lote */
  costPrice: number;
  /** Precio unitario al que se fijó para venta */
  salePrice: number;
  /** Existencia física disponible actual de este lote */
  quantityAvailable: number;
}

// ============================================================================
// SECCIÓN 5: CLIENTES Y USUARIOS DEL SISTEMA
// ============================================================================

/**
 * Perfil de cliente registrado o comprador recurrente.
 */
export interface Customer {
  id: number;
  name: string;
  nit: string;
  email: string;
  phone: string;
  address?: string;
  createdAt: string;
  updatedAt: string;
  /** Hash bcrypt de la contraseña si el cliente posee cuenta en portal web */
  passwordHash?: string;
  /** Coordenadas geográficas para despachos y geolocalización */
  deliveryLatitude?: number | null;
  deliveryLongitude?: number | null;
}

/**
 * Empleado o usuario operativo del sistema interno (POS, Bodega, Admin).
 */
export interface Employee {
  id: number;
  fullName: string;
  email: string;
  /** Contraseña almacenada de forma segura mediante hash bcrypt */
  password: string;
  role: Role;
  /** Sucursal a la cual está asignado físicamente */
  branchId: number | null;
  /** Supervisor directo (ID de otro empleado, o null) */
  supervisorId: number | null;
  active: boolean;
}

// ============================================================================
// SECCIÓN 6: ÓRDENES, VENTAS Y FACTURACIÓN
// ============================================================================

/**
 * Detalle o renglón de una orden.
 * Vincula los lotes específicos asignados para asegurar trazabilidad FEFO.
 */
export interface OrderItem {
  id: number;
  orderId: number;
  productId: number;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  /** IDs de los lotes de donde se descontó el producto */
  assignedLotIds: number[];
}

/**
 * Encabezado de una orden de venta.
 * Administra el ciclo de vida comercial, entrega y validación de recetas.
 */
export interface Order {
  id: number;
  /** Código legible de la orden (ej: ORD-00012) */
  code: string;
  source: OrderSource;
  branchId: number;
  customerId: number;
  customerEmail?: string;
  employeeId: number | null;
  deliveryMode: 'DELIVERY' | 'PICKUP';
  address: string | null;
  deliveryLatitude?: number | null;
  deliveryLongitude?: number | null;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  /** Si algún producto de la orden requiere prescripción médica */
  requiresPrescription: boolean;
  /** Comprobante o foto de receta cargada desde la web */
  prescriptionWebUrl: string | null;
  /** Foto de receta validada por el repartidor en la entrega */
  prescriptionDeliveryUrl: string | null;
  total: number;
  createdAt: string;
  paidAt: string | null;
  releasedAt: string | null;
}

/**
 * Registro de transacción de pago.
 * Soporta Stripe (tarjeta de crédito/débito), efectivo, PayPal o demo.
 */
export interface Payment {
  id: number;
  orderId: number;
  provider: 'stripe' | 'paypal' | 'cash' | 'demo';
  /** ID de transacción de la pasarela de pago */
  transactionId: string;
  amount: number;
  status: PaymentStatus;
  createdAt: string;
}

/**
 * Factura emitida según correlativo fiscal (SAT / FEL).
 */
export interface Invoice {
  id: number;
  orderId: number;
  /** Número fiscal correlativo (ej: FAC-00010) */
  invoiceNumber: string;
  /** Número de autorización SAT correlativo */
  satCorrelative: string;
  issuedAt: string;
  total: number;
}

// ============================================================================
// SECCIÓN 7: CONTROL DE CALIDAD, DEVOLUCIONES Y AUDITORÍA
// ============================================================================

/**
 * Registro de devolución de mercadería por parte del cliente.
 * Destino:
 * - 'REINTEGRATION': Reingreso a inventario (si el empaque está íntegro y vigente).
 * - 'DISPOSAL': Destrucción o desecho de fármacos dañados/abiertos.
 */
export interface ReturnRecord {
  id: number;
  orderId: number;
  employeeId: number;
  reason: string;
  destiny: 'REINTEGRATION' | 'DISPOSAL';
  createdAt: string;
}

/**
 * Doble chequeo o verificación cruzada por parte de un supervisor/farmacéutico.
 * Verifica que los medicamentos despachados coincidan exactamente con la orden y receta.
 */
export interface CrosscheckRecord {
  id: number;
  orderId: number;
  reviewerEmployeeId: number;
  approved: boolean;
  notes: string;
  createdAt: string;
}

/**
 * Métricas calculadas para el panel de administración / gerencia.
 */
export interface DashboardMetrics {
  salesToday: number;
  salesMonth: number;
  lowStockCount: number;
  expiringLotsCount: number;
  registeredCustomers: number;
  pendingOrders: number;
}

/**
 * Estructura completa de persistencia en memoria y JSON local (fallback / seed).
 */
export interface DataSnapshot {
  branches: Branch[];
  categories: Category[];
  products: Product[];
  suppliers: Supplier[];
  lots: Lot[];
  customers: Customer[];
  employees: Employee[];
  orders: Order[];
  orderItems: OrderItem[];
  payments: Payment[];
  invoices: Invoice[];
  returns: ReturnRecord[];
  crosschecks: CrosscheckRecord[];
  counters: {
    customer: number;
    employee: number;
    order: number;
    orderItem: number;
    payment: number;
    invoice: number;
    return: number;
    crosscheck: number;
    lot: number;
    product: number;
  };
}

// ============================================================================
// SECCIÓN 8: DTOs DE ENTRADA PARA CONTROLADORES Y SERVICIOS
// ============================================================================

/**
 * Entrada para checkout público desde el e-commerce.
 */
export interface PublicCheckoutInput {
  branchId: number;
  deliveryMode: 'DELIVERY' | 'PICKUP';
  paymentMethod: 'STRIPE' | 'CASH';
  address?: string | null;
  deliveryLatitude?: number | null;
  deliveryLongitude?: number | null;
  customer: {
    name: string;
    nit: string;
    email: string;
    phone: string;
  };
  items: Array<{
    productId: number;
    quantity: number;
  }>;
  prescriptionWebUrl?: string | null;
}

/**
 * Entrada para registro de venta directa en el Punto de Venta (POS).
 */
export interface PosSaleInput {
  branchId: number;
  customer: {
    name: string;
    nit: string;
    email: string;
    phone: string;
  };
  items: Array<{
    productId: number;
    quantity: number;
  }>;
}

/**
 * Entrada para recepción de mercadería y alta de lotes en bodega.
 */
export interface ReceiveGoodsInput {
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
}

/**
 * Entrada para la validación de doble chequeo de una orden.
 */
export interface CrosscheckInput {
  reviewerEmployeeId: number;
  approved: boolean;
  notes?: string;
}
