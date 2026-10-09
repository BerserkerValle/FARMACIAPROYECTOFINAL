export type Portal = 'public' | 'login' | 'customer' | 'pos' | 'warehouse' | 'delivery' | 'admin';

export interface Branch { id: number; name: string; city: string; address: string; }
export interface Category { id: number; name: string; parentId: number | null; }
export interface Supplier {
  id: number; name: string; contactName?: string; nit: string; email: string;
  phone: string; address: string; active: boolean;
}
export interface ProductCard {
  id: number; name: string; sku: string; categoryId?: number; brand: string;
  laboratory: string; presentation: string; unitMeasure?: string; sanitaryRegistry?: string;
  requiresPrescription: boolean; price: number; cost?: number; stock: number; description: string;
  imageUrl?: string | null;
  lots: Array<{ id: number; batchCode: string; expirationDate: string; quantityAvailable: number; branchId?: number; salePrice?: number }>;
}
export interface EmployeeProfile { employeeId: number; role: string; branchId: number | null; fullName: string; email: string; }
export interface CustomerAccount { customerId: number; fullName: string; email: string; phone: string; nit: string; address: string; }
export interface LowStockProduct {
  productId: number; name: string; sku: string; branchId: number; branchName: string;
  stock: number; severity: 'critical' | 'urgent' | 'low';
}
export interface DashboardMetrics {
  salesToday: number; salesMonth: number; lowStockCount: number; expiringLotsCount: number;
  registeredCustomers: number; pendingOrders: number; suppliersCount: number;
  lowStockProducts: LowStockProduct[];
}
