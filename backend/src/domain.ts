export type Role = 'Administrador' | 'Gerente' | 'Cajero' | 'Bodeguero' | 'Repartidor' | 'Proveedor';

export type OrderSource = 'WEB' | 'POS' | 'PICKUP';
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
export type OrderStatus = 'CREATED' | 'AWAITING_PAYMENT' | 'PAID' | 'PACKING' | 'READY_FOR_PICKUP' | 'IN_ROUTE' | 'DELIVERED' | 'CANCELLED';

export interface Branch {
  id: number;
  name: string;
  city: string;
  address: string;
}

export interface Category {
  id: number;
  name: string;
  parentId: number | null;
}

export interface Product {
  id: number;
  sku: string;
  name: string;
  categoryId: number;
  brand: string;
  laboratory: string;
  presentation: string;
  unitMeasure: string;
  sanitaryRegistry: string;
  requiresPrescription: boolean;
  active: boolean;
  description: string;
  price: number;
  cost: number;
  imageUrl?: string | null;
}

export interface CreateProductInput {
  sku: string;
  name: string;
  categoryId: number;
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
  initialStock?: {
    branchId: number;
    supplierId: number;
    batchCode: string;
    expirationDate: string;
    productionDate: string;
    quantity: number;
  } | null;
}

export interface Supplier {
  id: number;
  name: string;
  nit: string;
  email: string;
  phone: string;
  address: string;
  active: boolean;
}

export interface Lot {
  id: number;
  productId: number;
  branchId: number;
  supplierId: number;
  batchCode: string;
  expirationDate: string;
  productionDate: string;
  costPrice: number;
  salePrice: number;
  quantityAvailable: number;
}

export interface Customer {
  id: number;
  name: string;
  nit: string;
  email: string;
  phone: string;
  createdAt: string;
  updatedAt: string;
}

export interface Employee {
  id: number;
  fullName: string;
  email: string;
  password: string;
  role: Role;
  branchId: number | null;
  supervisorId: number | null;
  active: boolean;
}

export interface OrderItem {
  id: number;
  orderId: number;
  productId: number;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  assignedLotIds: number[];
}

export interface Order {
  id: number;
  code: string;
  source: OrderSource;
  branchId: number;
  customerId: number;
  employeeId: number | null;
  deliveryMode: 'DELIVERY' | 'PICKUP';
  address: string | null;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  requiresPrescription: boolean;
  prescriptionWebUrl: string | null;
  prescriptionDeliveryUrl: string | null;
  total: number;
  createdAt: string;
  paidAt: string | null;
  releasedAt: string | null;
}

export interface Payment {
  id: number;
  orderId: number;
  provider: 'stripe' | 'paypal' | 'cash' | 'demo';
  transactionId: string;
  amount: number;
  status: PaymentStatus;
  createdAt: string;
}

export interface Invoice {
  id: number;
  orderId: number;
  invoiceNumber: string;
  satCorrelative: string;
  issuedAt: string;
  total: number;
}

export interface ReturnRecord {
  id: number;
  orderId: number;
  employeeId: number;
  reason: string;
  destiny: 'REINTEGRATION' | 'DISPOSAL';
  createdAt: string;
}

export interface CrosscheckRecord {
  id: number;
  orderId: number;
  reviewerEmployeeId: number;
  approved: boolean;
  notes: string;
  createdAt: string;
}

export interface DashboardMetrics {
  salesToday: number;
  salesMonth: number;
  lowStockCount: number;
  expiringLotsCount: number;
  registeredCustomers: number;
  pendingOrders: number;
}

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

export interface PublicCheckoutInput {
  branchId: number;
  deliveryMode: 'DELIVERY' | 'PICKUP';
  address?: string | null;
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

export interface CrosscheckInput {
  reviewerEmployeeId: number;
  approved: boolean;
  notes?: string;
}
