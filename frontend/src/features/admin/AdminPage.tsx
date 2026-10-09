import { useEffect, useState } from 'react';
import { apiRequest } from '../../api';
import type { Category, DashboardMetrics, LowStockProduct, Supplier } from '../../types';
import { money } from '../../lib/catalog';

type AdminReports = {
  monthlySales?: Array<{ month: string; total: number }>;
  topProducts?: Array<{ name: string; quantity: number; total: number }>;
  salesByBranch?: Array<{ branch: string; total: number }>;
  purchasesBySupplier?: Array<{ supplier: string; total: number }>;
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

type AdminTab = 'performance' | 'lowStock' | 'newEmployee' | 'crosscheck' | 'categories' | 'suppliers';
const ADMIN_TABS: { id: AdminTab; label: string; icon: React.ReactNode }[] = [
  { id: 'performance', label: 'Rendimiento de la farmacia', icon: <span>⌁</span> },
  { id: 'lowStock', label: 'Inventario bajo', icon: <span>▥</span> },
  { id: 'newEmployee', label: 'Alta de Colaborador', icon: <span>+</span> },
  { id: 'crosscheck', label: 'Auditoría & Crosscheck MSPAS', icon: <span>✓</span> },
  { id: 'categories', label: 'Categorías de medicamentos', icon: <span>▦</span> },
  { id: 'suppliers', label: 'Gestión de proveedores', icon: <span>▥</span> }
];

export function AdminPage({ token }: { token: string | null }) {
  const [dashboard, setDashboard] = useState<DashboardMetrics | null>(null);
  const [reports, setReports] = useState<AdminReports | null>(null);
  const [status, setStatus] = useState('');
  const [employee, setEmployee] = useState({ fullName: 'Nuevo Usuario', email: 'nuevo@farmaciafjk.com', password: 'Clave123*', role: 'Cajero', branchId: 1, supervisorId: null as number | null });
  const [crosscheckOrderId, setCrosscheckOrderId] = useState('1');
  const [categories, setCategories] = useState<Category[]>([]);
  const [newCategory, setNewCategory] = useState({ name: '', parentId: null as number | null });
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [editingSupplierId, setEditingSupplierId] = useState<number | null>(null);
  const [supplierForm, setSupplierForm] = useState({ name: '', contactName: '', nit: '', phone: '', email: '', address: '', active: true });
  const [activeTab, setActiveTab] = useState<AdminTab>(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
    return ADMIN_TABS.some((tab) => tab.id === hash) ? hash as AdminTab : 'performance';
  });

  useEffect(() => { window.location.hash = activeTab; }, [activeTab]);
  useEffect(() => {
    const onHashChange = () => { const hash = window.location.hash.slice(1); if (ADMIN_TABS.some((tab) => tab.id === hash)) setActiveTab(hash as AdminTab); };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  async function loadAll() {
    if (!token) return;
    const [dash, rep, categoryData, supplierData] = await Promise.all([
      apiRequest<DashboardMetrics>('/api/admin/dashboard', {}, token), apiRequest<AdminReports>('/api/admin/reports', {}, token),
      apiRequest<Category[]>('/api/admin/categories', {}, token), apiRequest<Supplier[]>('/api/admin/suppliers', {}, token)
    ]);
    setDashboard(dash); setReports(rep); setCategories(categoryData); setSuppliers(supplierData);
  }
  useEffect(() => { loadAll().catch((error) => setStatus(error.message)); }, [token]);
  async function createEmployee() { try { await apiRequest('/api/admin/employees', { method: 'POST', body: JSON.stringify(employee) }, token); setStatus('Empleado registrado con éxito.'); loadAll(); } catch (error) { setStatus(error instanceof Error ? error.message : 'Error al registrar empleado'); } }
  async function doCrosscheck() { try { await apiRequest(`/api/admin/orders/${crosscheckOrderId}/crosscheck`, { method: 'POST', body: JSON.stringify({ reviewerEmployeeId: 2, approved: true, notes: 'Receta validada y archivada' }) }, token); setStatus(`Crosscheck registrado para orden #${crosscheckOrderId}`); } catch (error) { setStatus(error instanceof Error ? error.message : 'Error en crosscheck'); } }
  async function addCategory() { try { if (!newCategory.name.trim()) throw new Error('Escribe el nombre de la categoría'); await apiRequest('/api/admin/categories', { method: 'POST', body: JSON.stringify(newCategory) }, token); setNewCategory({ name: '', parentId: null }); setStatus('Categoría creada correctamente.'); await loadAll(); } catch (error) { setStatus(error instanceof Error ? error.message : 'No se pudo crear la categoría'); } }
  async function removeCategory(category: Category) { if (!window.confirm(`¿Eliminar la categoría "${category.name}"?`)) return; try { await apiRequest(`/api/admin/categories/${category.id}`, { method: 'DELETE' }, token); setStatus('Categoría eliminada correctamente.'); await loadAll(); } catch (error) { setStatus(error instanceof Error ? error.message : 'No se pudo eliminar la categoría'); } }
  function resetSupplierForm() { setEditingSupplierId(null); setSupplierForm({ name: '', contactName: '', nit: '', phone: '', email: '', address: '', active: true }); }
  function editSupplier(supplier: Supplier) { setEditingSupplierId(supplier.id); setSupplierForm({ name: supplier.name, contactName: supplier.contactName ?? '', nit: supplier.nit, phone: supplier.phone, email: supplier.email, address: supplier.address, active: supplier.active }); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }
  async function saveSupplier() { try { const payload = { ...supplierForm, name: supplierForm.name.trim(), contactName: supplierForm.contactName.trim(), nit: supplierForm.nit.trim(), phone: supplierForm.phone.trim(), email: supplierForm.email.trim(), address: supplierForm.address.trim() }; if (!payload.name || !payload.contactName || !payload.nit || !payload.phone || !payload.email || !payload.address) throw new Error('Completa todos los campos del proveedor'); const path = editingSupplierId ? `/api/admin/suppliers/${editingSupplierId}` : '/api/admin/suppliers'; await apiRequest(path, { method: editingSupplierId ? 'PUT' : 'POST', body: JSON.stringify(payload) }, token); setStatus(editingSupplierId ? 'Proveedor actualizado correctamente.' : 'Proveedor registrado correctamente.'); resetSupplierForm(); await loadAll(); } catch (error) { setStatus(error instanceof Error ? error.message : 'No se pudo guardar el proveedor'); } }
  async function toggleSupplier(supplier: Supplier) { try { await apiRequest(`/api/admin/suppliers/${supplier.id}`, { method: 'PUT', body: JSON.stringify({ active: !supplier.active }) }, token); setStatus(`Proveedor ${supplier.active ? 'desactivado' : 'activado'} correctamente.`); await loadAll(); } catch (error) { setStatus(error instanceof Error ? error.message : 'No se pudo actualizar el estado del proveedor'); } }
  const filteredSuppliers = suppliers.filter((supplier) => { const query = supplierSearch.trim().toLowerCase(); return !query || [supplier.name, supplier.contactName, supplier.nit, supplier.email, supplier.phone].some((value) => String(value ?? '').toLowerCase().includes(query)); });
  const SkeletonCard = () => <div className="skeleton-card"><div className="skeleton-line" style={{ width: '60%' }} /><div className="skeleton-line" style={{ width: '40%', marginTop: '0.5rem' }} /><div className="skeleton-line" style={{ width: '30%', marginTop: '0.5rem' }} /></div>;
  const SkeletonChart = () => <div className="skeleton-chart"><div className="skeleton-line" style={{ width: '100%', height: '200px' }} /></div>;
  const PerformanceTab = () => <><div className="stats-grid-4">{[['Ventas del Día', dashboard?.salesToday, 'Cajas POS + En Línea'], ['Ventas del Mes', dashboard?.salesMonth, 'Total acumulado'], ['Stock Bajo', dashboard?.lowStockCount, 'Medicamentos críticos'], ['Pedidos Pendientes', dashboard?.pendingOrders, 'Empaque o entrega'], ['Proveedores', dashboard?.suppliersCount, 'Registrados en el sistema']].map(([label, value, hint]) => <div className="stat-metric-card" key={String(label)}><p>{label}</p><strong>{dashboard ? (typeof value === 'number' && (label === 'Ventas del Día' || label === 'Ventas del Mes') ? money(value) : String(value)) : <span className="skeleton-text" />}</strong><span>{hint}</span></div>)}</div>{dashboard && reports ? <><AdminCharts reports={reports} /><InventoryAlerts products={dashboard.lowStockProducts ?? []} /></> : <><SkeletonChart /><SkeletonCard /></> }</>;
  const LowStockTab = () => dashboard ? <InventoryAlerts products={dashboard.lowStockProducts ?? []} /> : <SkeletonCard />;
  const NewEmployeeTab = () => <div className="two-col-grid"><div className="panel-card"><div className="panel-head"><h2>Alta de Colaborador</h2><span className="pill-tag">Control RBAC</span></div><div className="form-grid-2"><div className="form-field"><label>Nombre</label><input value={employee.fullName} onChange={(e) => setEmployee({ ...employee, fullName: e.target.value })} /></div><div className="form-field"><label>Correo</label><input value={employee.email} onChange={(e) => setEmployee({ ...employee, email: e.target.value })} /></div></div><div className="form-grid-2"><div className="form-field"><label>Rol</label><select value={employee.role} onChange={(e) => setEmployee({ ...employee, role: e.target.value })}><option>Administrador</option><option>Gerente</option><option>Cajero</option><option>Bodeguero</option><option>Repartidor</option></select></div><div className="form-field"><label>Contraseña</label><input type="password" value={employee.password} onChange={(e) => setEmployee({ ...employee, password: e.target.value })} /></div></div><button type="button" className="btn-primary" onClick={createEmployee}>Crear Usuario</button></div><CrosscheckPanel /></div>;
  const CrosscheckPanel = () => <div className="panel-card"><div className="panel-head"><h2>Auditoría & Crosscheck MSPAS</h2><span className="pill-tag">Validación Sanitaria</span></div><div className="form-field"><label>ID de Orden a Validar</label><input value={crosscheckOrderId} onChange={(e) => setCrosscheckOrderId(e.target.value)} /></div><button type="button" className="btn-primary" onClick={doCrosscheck}>Registrar Validación de Receta</button><div className="reports-summary-grid"><div className="report-summary-box"><strong>{reports?.monthlySales?.length ?? 0}</strong><span>Períodos analizados</span></div><div className="report-summary-box"><strong>{reports?.topProducts?.length ?? 0}</strong><span>Productos con ventas</span></div></div>{status && <div className="checkout-status-msg">{status}</div>}</div>;
  const CategoriesTab = () => <div className="panel-card" style={{ marginTop: '1rem' }}><div className="panel-head"><h2>Categorías de medicamentos</h2><span className="pill-tag">Administrador / Gerente</span></div><div className="form-grid-2"><div className="form-field"><label>Nombre de categoría</label><input value={newCategory.name} onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })} placeholder="Ej. Vitaminas" /></div><div className="form-field"><label>Categoría principal</label><select value={newCategory.parentId ?? ''} onChange={(e) => setNewCategory({ ...newCategory, parentId: e.target.value ? Number(e.target.value) : null })}><option value="">Sin categoría principal</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div></div><button type="button" className="btn-primary" onClick={addCategory}>Agregar categoría</button><div className="item-list-stack" style={{ marginTop: '0.75rem' }}>{categories.map((category) => <div className="compact-list-row" key={category.id}><strong>{category.name}</strong><button type="button" className="btn-secondary" onClick={() => removeCategory(category)}>Eliminar</button></div>)}</div></div>;
  const SuppliersTab = () => <div className="panel-card admin-suppliers-panel" style={{ marginTop: '1rem' }}><div className="panel-head"><div><h2>Gestión de proveedores</h2><span className="panel-subtitle">Contactos, compras y estado operativo</span></div><span className="pill-tag">Administrador / Gerente</span></div><div className="supplier-toolbar"><div className="form-field supplier-search-field"><label>Buscar proveedor</label><input value={supplierSearch} onChange={(e) => setSupplierSearch(e.target.value)} placeholder="Nombre, NIT, correo o teléfono" /></div>{editingSupplierId && <button type="button" className="btn-secondary" onClick={resetSupplierForm}>Cancelar edición</button>}</div><div className="form-grid-2 supplier-form-grid">{(['name', 'contactName', 'nit', 'phone', 'email', 'address'] as const).map((field) => <div className="form-field" key={field}><label>{field === 'name' ? 'Empresa o proveedor' : field === 'contactName' ? 'Nombre del contacto' : field === 'nit' ? 'NIT' : field === 'phone' ? 'Teléfono' : field === 'email' ? 'Correo electrónico' : 'Dirección'}</label><input type={field === 'email' ? 'email' : 'text'} value={supplierForm[field]} onChange={(e) => setSupplierForm({ ...supplierForm, [field]: e.target.value })} /></div>)}</div><div className="supplier-form-actions"><label className="checkbox-field"><input type="checkbox" checked={supplierForm.active} onChange={(e) => setSupplierForm({ ...supplierForm, active: e.target.checked })} /> Proveedor activo</label><button type="button" className="btn-primary" onClick={saveSupplier}>{editingSupplierId ? 'Guardar cambios' : 'Registrar proveedor'}</button></div><div className="lots-table-wrap"><table className="lots-table suppliers-table"><thead><tr><th>Proveedor</th><th>Contacto</th><th>NIT</th><th>Comunicación</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{filteredSuppliers.map((supplier) => <tr key={supplier.id}><td><strong>{supplier.name}</strong><small>{supplier.address}</small></td><td>{supplier.contactName || 'Sin contacto'}</td><td>{supplier.nit}</td><td><span>{supplier.email}</span><small>{supplier.phone}</small></td><td><span className={`supplier-status ${supplier.active ? 'active' : 'inactive'}`}>{supplier.active ? 'Activo' : 'Inactivo'}</span></td><td><div className="supplier-actions"><button type="button" className="btn-secondary" onClick={() => editSupplier(supplier)}>Editar</button><button type="button" className="btn-secondary" onClick={() => toggleSupplier(supplier)}>{supplier.active ? 'Desactivar' : 'Activar'}</button></div></td></tr>)}{filteredSuppliers.length === 0 && <tr><td colSpan={6} className="no-lots-msg">No hay proveedores que coincidan con la búsqueda.</td></tr>}</tbody></table></div></div>;
  const panels: Record<AdminTab, React.ReactNode> = { performance: <PerformanceTab />, lowStock: <LowStockTab />, newEmployee: <NewEmployeeTab />, crosscheck: <CrosscheckPanel />, categories: <CategoriesTab />, suppliers: <SuppliersTab /> };
  return <div className="internal-page-container"><div className="admin-tab-bar"><div className="admin-tab-bar-desktop" role="tablist" aria-label="Secciones de administración">{ADMIN_TABS.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`panel-${tab.id}`} id={`tab-${tab.id}`} className={`admin-tab-btn ${activeTab === tab.id ? 'active' : ''}`} onClick={() => setActiveTab(tab.id)}><span className="admin-tab-icon">{tab.icon}</span><span className="admin-tab-label">{tab.label}</span></button>)}</div><div className="admin-tab-bar-mobile"><select value={activeTab} onChange={(e) => setActiveTab(e.target.value as AdminTab)} className="admin-tab-select" aria-label="Seleccionar sección de administración">{ADMIN_TABS.map((tab) => <option key={tab.id} value={tab.id}>{tab.label}</option>)}</select></div></div><div id="admin-tab-panels" role="tabpanel" aria-labelledby={`tab-${activeTab}`}>{panels[activeTab]}</div></div>;
}

export default AdminPage;
