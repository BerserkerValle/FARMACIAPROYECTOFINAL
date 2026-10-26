import { useEffect, useState } from 'react';
import { apiRequest } from '../../api';
import type { DashboardMetrics, LowStockProduct, Supplier } from '../../types';
import { money } from '../../lib/catalog';
import { PasswordInputComponent } from '../../components/PasswordInput';

type AdminReports = {
  monthlySales?: Array<{ month: string; total: number }>;
  topProducts?: Array<{ name: string; quantity: number; total: number }>;
  salesByBranch?: Array<{ branch: string; total: number }>;
  purchasesBySupplier?: Array<{ supplier: string; total: number }>;
};

type AdminDiscountCode = {
  id: number;
  code: string;
  type: 'PERCENTAGE' | 'FIXED';
  value: number;
  maxUses: number;
  startsAt: string | null;
  expiresAt: string | null;
  active: boolean;
  createdAt: string;
};

function formatChartLabel(value: string) {
  if (/^\d{4}-\d{2}$/.test(value)) {
    const [year, month] = value.split('-');
    return new Intl.DateTimeFormat('es-GT', { month: 'short' }).format(new Date(Number(year), Number(month) - 1, 1));
  }
  return value.length > 16 ? `${value.slice(0, 16)}...` : value;
}

function monthKeyFromDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function fillMonthlySales(rows: Array<{ month: string; total: number }>, count: number, endDate = new Date()) {
  const totals = new Map(rows.map((row) => [row.month, Number(row.total)]));
  const endMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
  const startMonth = addMonths(endMonth, -(count - 1));
  return Array.from({ length: count }, (_, index) => {
    const date = addMonths(startMonth, index);
    const month = monthKeyFromDate(date);
    return { month, total: totals.get(month) ?? 0 };
  });
}

function SalesTrendChart({ rows }: { rows: Array<{ month: string; total: number }> }) {
  const data = rows.slice(-8);
  const max = Math.max(...data.map((row) => row.total), 1);
  const points = data.map((row, index) => `${data.length === 1 ? 50 : (index / (data.length - 1)) * 100},${100 - (row.total / max) * 82 - 8}`).join(' ');
  return <div className="chart-shell line-chart-shell">
    {data.length > 0 ? <>
      <svg className="line-chart" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Tendencia de ventas mensuales">
        <defs><linearGradient id="sales-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--primary)" stopOpacity="0.28" /><stop offset="1" stopColor="var(--primary)" stopOpacity="0" /></linearGradient></defs>
        <path d={`M 0 100 L ${points.replace(/ /g, ' L ')} L 100 100 Z`} fill="url(#sales-area)" />
        <polyline points={points} fill="none" stroke="var(--primary)" strokeWidth="2.2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
        {data.map((row, index) => <circle key={row.month} cx={data.length === 1 ? 50 : (index / (data.length - 1)) * 100} cy={100 - (row.total / max) * 82 - 8} r="1.8" fill="var(--surface)" stroke="var(--primary)" strokeWidth="1.2" vectorEffect="non-scaling-stroke"><title>{row.month}: {money(row.total)}</title></circle>)}
      </svg>
      <div className="chart-axis-labels">{data.map((row) => <span key={row.month}>{formatChartLabel(row.month)}</span>)}</div>
    </> : <div className="chart-empty">Aún no hay ventas registradas para graficar.</div>}
  </div>;
}

function HorizontalBars({ rows, labelKey }: { rows: Array<{ label: string; value: number }>; labelKey: string }) {
  const data = rows.slice(0, 6);
  const max = Math.max(...data.map((row) => row.value), 1);
  return <div className="horizontal-bars">
    {data.length > 0 ? data.map((row) => <div className="bar-row" key={`${labelKey}-${row.label}`}>
      <div className="bar-row-head"><span title={row.label}>{formatChartLabel(row.label)}</span><strong>{money(row.value)}</strong></div>
      <div className="bar-track"><span style={{ width: `${Math.max((row.value / max) * 100, row.value > 0 ? 4 : 0)}%` }} /></div>
    </div>) : <div className="chart-empty">No hay datos disponibles.</div>}
  </div>;
}

function AdminCharts({ reports }: { reports: AdminReports | null }) {
  const [period, setPeriod] = useState<'3m' | '6m' | '12m' | 'all'>('6m');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const monthlySales = reports?.monthlySales ?? [];
  const filteredMonthlySales = monthlySales.filter((row) => {
    const monthDate = `${row.month}-01`;
    if (fromDate && monthDate < `${fromDate.slice(0, 7)}-01`) return false;
    if (toDate && monthDate > `${toDate.slice(0, 7)}-01`) return false;
    return true;
  });
  const visibleMonthlySales = fromDate || toDate
    ? (() => {
      const start = fromDate ? new Date(`${fromDate.slice(0, 7)}-01T00:00:00`) : new Date(`${filteredMonthlySales[0]?.month ?? monthKeyFromDate(new Date())}-01T00:00:00`);
      const end = toDate ? new Date(`${toDate.slice(0, 7)}-01T00:00:00`) : new Date();
      const count = Math.max(1, (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1);
      return fillMonthlySales(monthlySales, count, end).map((row, index) => ({
        month: monthKeyFromDate(addMonths(start, index)),
        total: new Map(monthlySales.map((item) => [item.month, Number(item.total)])).get(monthKeyFromDate(addMonths(start, index))) ?? 0
      }));
    })()
    : period === 'all'
      ? fillMonthlySales(monthlySales, Math.max(monthlySales.length, 1), monthlySales.length ? new Date(`${monthlySales[monthlySales.length - 1].month}-01T00:00:00`) : new Date())
      : fillMonthlySales(monthlySales, Number(period.replace('m', '')));
  const branchRows = (reports?.salesByBranch ?? []).map((row) => ({ label: row.branch, value: Number(row.total) }));
  const productRows = (reports?.topProducts ?? []).map((row) => ({ label: row.name, value: Number(row.total) }));
  return <section className="dashboard-analytics">
    <div className="analytics-heading"><div><span className="section-kicker">Lectura operativa</span><h2>Rendimiento de la farmacia</h2></div><div className="analytics-controls"><div className="period-switcher" role="group" aria-label="Período del gráfico">{(['3m', '6m', '12m', 'all'] as const).map((value) => <button key={value} type="button" className={period === value && !fromDate && !toDate ? 'active' : ''} onClick={() => { setPeriod(value); setFromDate(''); setToDate(''); }}>{value === 'all' ? 'Todo' : value.replace('m', ' meses')}</button>)}</div><div className="date-filter-group"><label>Desde<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label><label>Hasta<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label></div></div></div>
    <div className="analytics-grid"><div className="analytics-card analytics-card-wide"><div className="analytics-card-head"><div><h3>Ventas mensuales</h3><p>Ingresos confirmados por período seleccionado</p></div><span className="data-freshness">{visibleMonthlySales.length} períodos</span></div><SalesTrendChart rows={visibleMonthlySales} /></div><div className="analytics-card"><div className="analytics-card-head"><div><h3>Ventas por sucursal</h3><p>Comparación acumulada</p></div><span className="chart-accent blue" /></div><HorizontalBars rows={branchRows} labelKey="branch" /></div><div className="analytics-card"><div className="analytics-card-head"><div><h3>Productos destacados</h3><p>Mayor contribución a ventas</p></div><span className="chart-accent amber" /></div><HorizontalBars rows={productRows} labelKey="product" /></div></div>
  </section>;
}

function InventoryAlerts({ products }: { products: LowStockProduct[] }) {
  return <section className="inventory-alerts analytics-card"><div className="analytics-card-head"><div><span className="section-kicker warning-kicker">Acción requerida</span><h3>Inventario bajo</h3><p>Productos que necesitan reposición por sucursal</p></div><span className="alert-counter">{products.length}</span></div>{products.length > 0 ? <div className="inventory-alert-list">{products.map((product) => <div className="inventory-alert-row" key={`${product.productId}-${product.branchId}`}><div className="inventory-alert-icon">!</div><div className="inventory-alert-main"><strong>{product.name}</strong><span>{product.sku} · {product.branchName}</span></div><div className="inventory-alert-stock"><strong>{product.stock}</strong><span>unidades</span></div><span className={`inventory-severity ${product.severity}`}>{product.severity === 'critical' ? 'Agotado' : product.severity === 'urgent' ? 'Urgente' : 'Bajo'}</span></div>)}</div> : <div className="inventory-clear"><span>✓</span><div><strong>Inventario saludable</strong><p>No hay productos por debajo del mínimo de 10 unidades.</p></div></div>}</section>;
}

type AdminTab = 'performance' | 'lowStock' | 'newEmployee' | 'crosscheck' | 'suppliers' | 'discounts';
const ADMIN_TABS: { id: AdminTab; label: string; icon: React.ReactNode }[] = [
  { id: 'performance', label: 'Rendimiento de la farmacia', icon: <span>⌁</span> },
  { id: 'lowStock', label: 'Inventario bajo', icon: <span>▥</span> },
  { id: 'newEmployee', label: 'Alta de Colaborador', icon: <span>+</span> },
  { id: 'crosscheck', label: 'Auditoría MSPAS', icon: <span>✓</span> },
  { id: 'suppliers', label: 'Gestión de proveedores', icon: <span>▥</span> },
  { id: 'discounts', label: 'Códigos de descuento', icon: <span>%</span> }
];

function isAdminTab(hash: string, canManageDiscountCodes: boolean) {
  return ADMIN_TABS.some((tab) => tab.id === hash) && (hash !== 'discounts' || canManageDiscountCodes);
}

export function AdminPage({ token, canManageDiscountCodes }: { token: string | null; canManageDiscountCodes: boolean }) {
  const [dashboard, setDashboard] = useState<DashboardMetrics | null>(null);
  const [reports, setReports] = useState<AdminReports | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [discountCodes, setDiscountCodes] = useState<AdminDiscountCode[]>([]);
  const [status, setStatus] = useState('');
  const [discountForm, setDiscountForm] = useState({ code: '', type: 'PERCENTAGE' as AdminDiscountCode['type'], value: '10', maxUses: '100', startsAt: '', expiresAt: '' });
  const [empFullName, setEmpFullName] = useState('');
  const [empEmail, setEmpEmail] = useState('');
  const [empPassword, setEmpPassword] = useState('');
  const [empRole, setEmpRole] = useState<'Administrador' | 'Gerente' | 'Cajero' | 'Bodeguero' | 'Repartidor'>('Cajero');
  const [empBranchId, setEmpBranchId] = useState(1);
  const [empSupervisorId, setEmpSupervisorId] = useState<number | null>(null);
  const [crosscheckOrderId, setCrosscheckOrderId] = useState('1');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [editingSupplierId, setEditingSupplierId] = useState<number | null>(null);
  const [supplierName, setSupplierName] = useState('');
  const [supplierContactName, setSupplierContactName] = useState('');
  const [supplierNit, setSupplierNit] = useState('');
  const [supplierPhone, setSupplierPhone] = useState('');
  const [supplierEmail, setSupplierEmail] = useState('');
  const [supplierAddress, setSupplierAddress] = useState('');
  const [supplierActive, setSupplierActive] = useState(true);
  const [activeTab, setActiveTab] = useState<AdminTab>(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
    return isAdminTab(hash, canManageDiscountCodes) ? hash as AdminTab : 'performance';
  });

  useEffect(() => { window.location.hash = activeTab; }, [activeTab]);
  useEffect(() => {
    const onHashChange = () => { const hash = window.location.hash.slice(1); if (isAdminTab(hash, canManageDiscountCodes)) setActiveTab(hash as AdminTab); };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [canManageDiscountCodes]);

  async function loadAll() {
    if (!token) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setStatus('');
    try {
      const [dash, rep, supplierData, discountData] = await Promise.all([
        apiRequest<DashboardMetrics>('/api/admin/dashboard', {}, token), apiRequest<AdminReports>('/api/admin/reports', {}, token),
        apiRequest<Supplier[]>('/api/admin/suppliers', {}, token),
        canManageDiscountCodes ? apiRequest<AdminDiscountCode[]>('/api/admin/discount-codes', {}, token) : Promise.resolve([] as AdminDiscountCode[])
      ]);
      setDashboard(dash); setReports(rep); setSuppliers(supplierData); setDiscountCodes(discountData);
      setLastUpdated(new Date());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'No se pudieron cargar los datos del panel');
      throw error;
    } finally {
      setIsLoading(false);
    }
  }
  useEffect(() => { void loadAll().catch(() => undefined); }, [token, canManageDiscountCodes]);
  async function createEmployee() {
    try {
      const employeeData = {
        fullName: empFullName,
        email: empEmail,
        password: empPassword,
        role: empRole,
        branchId: empBranchId,
        supervisorId: empSupervisorId
      };
      await apiRequest('/api/admin/employees', { method: 'POST', body: JSON.stringify(employeeData) }, token);
      setStatus('Empleado registrado con éxito.');
      setEmpFullName('');
      setEmpEmail('');
      setEmpPassword('');
      setEmpRole('Cajero');
      setEmpBranchId(1);
      setEmpSupervisorId(null);
      loadAll();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Error al registrar empleado');
    }
  }
  async function doCrosscheck() { try { await apiRequest(`/api/admin/orders/${crosscheckOrderId}/crosscheck`, { method: 'POST', body: JSON.stringify({ reviewerEmployeeId: 2, approved: true, notes: 'Receta validada y archivada' }) }, token); setStatus(`Crosscheck registrado para orden #${crosscheckOrderId}`); } catch (error) { setStatus(error instanceof Error ? error.message : 'Error en crosscheck'); } }
  function resetSupplierForm() { setEditingSupplierId(null); setSupplierName(''); setSupplierContactName(''); setSupplierNit(''); setSupplierPhone(''); setSupplierEmail(''); setSupplierAddress(''); setSupplierActive(true); }
  function editSupplier(supplier: Supplier) { setEditingSupplierId(supplier.id); setSupplierName(supplier.name); setSupplierContactName(supplier.contactName ?? ''); setSupplierNit(supplier.nit); setSupplierPhone(supplier.phone); setSupplierEmail(supplier.email); setSupplierAddress(supplier.address); setSupplierActive(supplier.active); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }
  async function saveSupplier() { try { const payload = { name: supplierName.trim(), contactName: supplierContactName.trim(), nit: supplierNit.trim(), phone: supplierPhone.trim(), email: supplierEmail.trim(), address: supplierAddress.trim(), active: supplierActive }; if (!payload.name || !payload.contactName || !payload.nit || !payload.phone || !payload.email || !payload.address) throw new Error('Completa todos los campos del proveedor'); const path = editingSupplierId ? `/api/admin/suppliers/${editingSupplierId}` : '/api/admin/suppliers'; await apiRequest(path, { method: editingSupplierId ? 'PUT' : 'POST', body: JSON.stringify(payload) }, token); setStatus(editingSupplierId ? 'Proveedor actualizado correctamente.' : 'Proveedor registrado correctamente.'); resetSupplierForm(); await loadAll(); } catch (error) { setStatus(error instanceof Error ? error.message : 'No se pudo guardar el proveedor'); } }
  async function toggleSupplier(supplier: Supplier) { try { await apiRequest(`/api/admin/suppliers/${supplier.id}`, { method: 'PUT', body: JSON.stringify({ active: !supplier.active }) }, token); setStatus(`Proveedor ${supplier.active ? 'desactivado' : 'activado'} correctamente.`); await loadAll(); } catch (error) { setStatus(error instanceof Error ? error.message : 'No se pudo actualizar el estado del proveedor'); } }
  async function saveDiscountCode() {
    try {
      await apiRequest('/api/admin/discount-codes', {
        method: 'POST',
        body: JSON.stringify({
          code: discountForm.code,
          type: discountForm.type,
          value: Number(discountForm.value),
          maxUses: Number(discountForm.maxUses),
          startsAt: discountForm.startsAt ? new Date(discountForm.startsAt).toISOString() : null,
          expiresAt: discountForm.expiresAt ? new Date(discountForm.expiresAt).toISOString() : null
        })
      }, token);
      setDiscountForm({ code: '', type: 'PERCENTAGE', value: '10', maxUses: '100', startsAt: '', expiresAt: '' });
      setStatus('Código de descuento creado correctamente.');
      await loadAll();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'No se pudo crear el código de descuento');
    }
  }
  async function toggleDiscountCode(discount: AdminDiscountCode) {
    try {
      await apiRequest(`/api/admin/discount-codes/${discount.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !discount.active })
      }, token);
      setStatus(`Código ${discount.active ? 'desactivado' : 'activado'} correctamente.`);
      await loadAll();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'No se pudo actualizar el código');
    }
  }
  const filteredSuppliers = suppliers.filter((supplier) => { const query = supplierSearch.trim().toLowerCase(); return !query || [supplier.name, supplier.contactName, supplier.nit, supplier.email, supplier.phone].some((value) => String(value ?? '').toLowerCase().includes(query)); });
  const SkeletonCard = () => <div className="skeleton-card"><div className="skeleton-line" style={{ width: '60%' }} /><div className="skeleton-line" style={{ width: '40%', marginTop: '0.5rem' }} /><div className="skeleton-line" style={{ width: '30%', marginTop: '0.5rem' }} /></div>;
  const SkeletonChart = () => <div className="skeleton-chart"><div className="skeleton-line" style={{ width: '100%', height: '200px' }} /></div>;
  const PerformanceTab = () => {
    const metrics = [
      { label: 'Ventas de hoy', value: dashboard?.salesToday, hint: 'Facturación confirmada', icon: '↗', tone: 'green', isMoney: true },
      { label: 'Ventas del mes', value: dashboard?.salesMonth, hint: 'Acumulado mensual', icon: '$', tone: 'blue', isMoney: true },
      { label: 'Inventario crítico', value: dashboard?.lowStockCount, hint: 'Productos con stock bajo', icon: '!', tone: 'amber', isMoney: false },
      { label: 'Pedidos pendientes', value: dashboard?.pendingOrders, hint: 'Requieren seguimiento', icon: '≡', tone: 'violet', isMoney: false },
      { label: 'Proveedores', value: dashboard?.suppliersCount, hint: 'Registrados en el sistema', icon: '＋', tone: 'teal', isMoney: false }
    ];
    const sourceLabel = dashboard?.dataSource === 'postgres' ? 'PostgreSQL' : dashboard?.dataSource === 'server-store' ? 'Almacén local del servidor' : 'Conectando';

    return <>
      <section className="admin-dashboard-hero">
        <div>
          <span className="admin-dashboard-eyebrow">Panel ejecutivo</span>
          <h1>Resumen de operaciones</h1>
          <p>Indicadores clave para supervisar ventas, inventario y actividad de la farmacia.</p>
        </div>
        <div className="admin-dashboard-tools">
          <div className="admin-data-source">
            <span className={`admin-source-dot ${dashboard?.dataSource === 'postgres' ? 'connected' : ''}`} />
            <span><strong>{sourceLabel}</strong><small>{lastUpdated ? `Actualizado ${new Intl.DateTimeFormat('es-GT', { hour: '2-digit', minute: '2-digit' }).format(lastUpdated)}` : 'Origen de datos'}</small></span>
          </div>
          <button type="button" className="admin-refresh-button" onClick={() => { void loadAll().catch(() => undefined); }} disabled={isLoading}>
            <span aria-hidden="true">{isLoading ? '…' : '↻'}</span>{isLoading ? 'Cargando' : 'Actualizar'}
          </button>
        </div>
      </section>
      {status && <div className="admin-dashboard-message" role="alert">{status}</div>}
      <div className="stats-grid-4 admin-metrics-grid">
        {metrics.map((metric) => <article className="stat-metric-card admin-metric-card" key={metric.label}>
          <div className={`admin-metric-icon ${metric.tone}`} aria-hidden="true">{metric.icon}</div>
          <p>{metric.label}</p>
          <strong>{dashboard ? metric.isMoney ? money(metric.value ?? 0) : String(metric.value ?? 0) : <span className="skeleton-text" />}</strong>
          <span>{metric.hint}</span>
        </article>)}
      </div>
      {dashboard && reports ? <><AdminCharts reports={reports} /><InventoryAlerts products={dashboard.lowStockProducts ?? []} /></> : isLoading ? <div className="admin-dashboard-loading"><SkeletonChart /><SkeletonCard /></div> : <div className="admin-dashboard-error"><strong>No se pudieron mostrar las métricas.</strong><span>Revisa la conexión con la API y vuelve a intentarlo.</span></div>}
    </>;
  };
  const LowStockTab = () => dashboard ? <InventoryAlerts products={dashboard.lowStockProducts ?? []} /> : <SkeletonCard />;
  const NewEmployeeTab = () => <div className="two-col-grid"><div className="panel-card"><div className="panel-head"><h2>Alta de Colaborador</h2><span className="pill-tag">Control RBAC</span></div><div className="form-grid-2"><div className="form-field"><label>Nombre</label><input value={empFullName} onChange={(e) => setEmpFullName(e.target.value)} /></div><div className="form-field"><label>Correo</label><input value={empEmail} onChange={(e) => setEmpEmail(e.target.value)} /></div></div><div className="form-grid-2"><div className="form-field"><label>Rol</label><select value={empRole} onChange={(e) => setEmpRole(e.target.value as 'Administrador' | 'Gerente' | 'Cajero' | 'Bodeguero' | 'Repartidor')}><option>Administrador</option><option>Gerente</option><option>Cajero</option><option>Bodeguero</option><option>Repartidor</option></select></div><PasswordInputComponent label="Contraseña" value={empPassword} onChange={(e) => setEmpPassword(e.target.value)} required /></div><button type="button" className="btn-primary" onClick={createEmployee}>Crear Usuario</button></div>CrosscheckPanel()</div>;
  const CrosscheckPanel = () => <div className="panel-card"><div className="panel-head"><h2>Auditoría MSPAS</h2><span className="pill-tag">Validación Sanitaria</span></div><div className="form-field"><label>ID de Orden a Validar</label><input value={crosscheckOrderId} onChange={(e) => setCrosscheckOrderId(e.target.value)} /></div><button type="button" className="btn-primary" onClick={doCrosscheck}>Registrar Validación de Receta</button><div className="reports-summary-grid"><div className="report-summary-box"><strong>{reports?.monthlySales?.length ?? 0}</strong><span>Períodos analizados</span></div><div className="report-summary-box"><strong>{reports?.topProducts?.length ?? 0}</strong><span>Productos con ventas</span></div></div>{status && <div className="checkout-status-msg">{status}</div>}</div>;
  const SuppliersTab = () => <div className="panel-card admin-suppliers-panel" style={{ marginTop: '1rem' }}><div className="panel-head"><div><h2>Gestión de proveedores</h2><span className="panel-subtitle">Contactos, compras y estado operativo</span></div><span className="pill-tag">Administrador / Gerente</span></div><div className="supplier-toolbar"><div className="form-field supplier-search-field"><label>Buscar proveedor</label><input value={supplierSearch} onChange={(e) => setSupplierSearch(e.target.value)} placeholder="Nombre, NIT, correo o teléfono" /></div>{editingSupplierId && <button type="button" className="btn-secondary" onClick={resetSupplierForm}>Cancelar edición</button>}</div><div className="form-grid-2 supplier-form-grid">
  <div className="form-field"><label>Empresa o proveedor</label><input type="text" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} /></div>
  <div className="form-field"><label>Nombre del contacto</label><input type="text" value={supplierContactName} onChange={(e) => setSupplierContactName(e.target.value)} /></div>
  <div className="form-field"><label>NIT</label><input type="text" value={supplierNit} onChange={(e) => setSupplierNit(e.target.value)} /></div>
  <div className="form-field"><label>Teléfono</label><input type="tel" value={supplierPhone} onChange={(e) => setSupplierPhone(e.target.value)} /></div>
  <div className="form-field"><label>Correo electrónico</label><input type="email" value={supplierEmail} onChange={(e) => setSupplierEmail(e.target.value)} /></div>
  <div className="form-field"><label>Dirección</label><input type="text" value={supplierAddress} onChange={(e) => setSupplierAddress(e.target.value)} /></div>
</div><div className="supplier-form-actions"><label className="checkbox-field"><input type="checkbox" checked={supplierActive} onChange={(e) => setSupplierActive(e.target.checked)} /> Proveedor activo</label><button type="button" className="btn-primary" onClick={saveSupplier}>{editingSupplierId ? 'Guardar cambios' : 'Registrar proveedor'}</button></div><div className="lots-table-wrap"><table className="lots-table suppliers-table"><thead><tr><th>Proveedor</th><th>Contacto</th><th>NIT</th><th>Comunicación</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{filteredSuppliers.map((supplier) => <tr key={supplier.id}><td><strong>{supplier.name}</strong><small>{supplier.address}</small></td><td>{supplier.contactName || 'Sin contacto'}</td><td>{supplier.nit}</td><td><span>{supplier.email}</span><small>{supplier.phone}</small></td><td><span className={`supplier-status ${supplier.active ? 'active' : 'inactive'}`}>{supplier.active ? 'Activo' : 'Inactivo'}</span></td><td><div className="supplier-actions"><button type="button" className="btn-secondary" onClick={() => editSupplier(supplier)}>Editar</button><button type="button" className="btn-secondary" onClick={() => toggleSupplier(supplier)}>{supplier.active ? 'Desactivar' : 'Activar'}</button></div></td></tr>)}{filteredSuppliers.length === 0 && <tr><td colSpan={6} className="no-lots-msg">No hay proveedores que coincidan con la búsqueda.</td></tr>}</tbody></table></div></div>;
  const DiscountCodesTab = () => <div className="panel-card" style={{ marginTop: '1rem' }}><div className="panel-head"><div><h2>Códigos de descuento</h2><span className="panel-subtitle">Aplican a toda la compra; un código por pedido y un uso por correo.</span></div><span className="pill-tag">Máximo 50% · 100 usos por defecto</span></div><div className="form-grid-2"><div className="form-field"><label>Código</label><input value={discountForm.code} maxLength={32} onChange={(event) => setDiscountForm({ ...discountForm, code: event.target.value.toUpperCase() })} placeholder="EJ. BIENVENIDA10" /></div><div className="form-field"><label>Tipo</label><select value={discountForm.type} onChange={(event) => setDiscountForm({ ...discountForm, type: event.target.value as AdminDiscountCode['type'] })}><option value="PERCENTAGE">Porcentaje</option><option value="FIXED">Monto fijo (Q)</option></select></div><div className="form-field"><label>{discountForm.type === 'PERCENTAGE' ? 'Porcentaje (máximo 50)' : 'Monto en quetzales'}</label><input type="number" min="0.01" max={discountForm.type === 'PERCENTAGE' ? 50 : undefined} step="0.01" value={discountForm.value} onChange={(event) => setDiscountForm({ ...discountForm, value: event.target.value })} /></div><div className="form-field"><label>Usos máximos (por defecto 100)</label><input type="number" min="1" max="10000" step="1" value={discountForm.maxUses} onChange={(event) => setDiscountForm({ ...discountForm, maxUses: event.target.value })} /></div><div className="form-field"><label>Válido desde (opcional)</label><input type="datetime-local" value={discountForm.startsAt} onChange={(event) => setDiscountForm({ ...discountForm, startsAt: event.target.value })} /></div><div className="form-field"><label>Vence (opcional)</label><input type="datetime-local" value={discountForm.expiresAt} onChange={(event) => setDiscountForm({ ...discountForm, expiresAt: event.target.value })} /></div></div><button type="button" className="btn-primary" onClick={saveDiscountCode}>Crear código</button><div className="lots-table-wrap" style={{ marginTop: '1rem' }}><table className="lots-table suppliers-table"><thead><tr><th>Código</th><th>Descuento</th><th>Vigencia</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{discountCodes.map((discount) => <tr key={discount.id}><td><strong>{discount.code}</strong><small>Máximo {discount.maxUses} usos</small></td><td>{discount.type === 'PERCENTAGE' ? `${discount.value}%` : money(discount.value)}</td><td><small>{discount.startsAt ? new Date(discount.startsAt).toLocaleString() : 'Desde ahora'}</small><small>{discount.expiresAt ? `Hasta ${new Date(discount.expiresAt).toLocaleString()}` : 'Sin vencimiento'}</small></td><td><span className={`supplier-status ${discount.active ? 'active' : 'inactive'}`}>{discount.active ? 'Activo' : 'Inactivo'}</span></td><td><button type="button" className="btn-secondary" onClick={() => toggleDiscountCode(discount)}>{discount.active ? 'Desactivar' : 'Activar'}</button></td></tr>)}{discountCodes.length === 0 && <tr><td colSpan={5} className="no-lots-msg">Todavía no hay códigos de descuento.</td></tr>}</tbody></table></div>{status && <div className="checkout-status-msg">{status}</div>}</div>;
  function renderPanel(tab: AdminTab): React.ReactNode { switch (tab) { case "performance": return PerformanceTab(); case "lowStock": return LowStockTab(); case "newEmployee": return NewEmployeeTab(); case "crosscheck": return CrosscheckPanel(); case "suppliers": return SuppliersTab(); case "discounts": return DiscountCodesTab(); default: return null; } }
  const visibleTabs = ADMIN_TABS.filter((tab) => tab.id !== 'discounts' || canManageDiscountCodes);
  return <div className="internal-page-container"><div className="admin-tab-bar"><div className="admin-tab-bar-desktop" role="tablist" aria-label="Secciones de administración">{visibleTabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`panel-${tab.id}`} id={`tab-${tab.id}`} className={`admin-tab-btn ${activeTab === tab.id ? 'active' : ''}`} onClick={() => setActiveTab(tab.id)}><span className="admin-tab-icon">{tab.icon}</span><span className="admin-tab-label">{tab.label}</span></button>)}</div><div className="admin-tab-bar-mobile"><select value={activeTab} onChange={(e) => setActiveTab(e.target.value as AdminTab)} className="admin-tab-select" aria-label="Seleccionar sección de administración">{visibleTabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.label}</option>)}</select></div></div><div id="admin-tab-panels" role="tabpanel" aria-labelledby={`tab-${activeTab}`}>{renderPanel(activeTab)}</div></div>;
}

export default AdminPage;
