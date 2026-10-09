import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { apiRequest } from '../../api';
import { ProductDetailModal } from '../../components/ProductDetailModal';
import type { Category, EmployeeProfile, ProductCard } from '../../types';
import { getCategoryHierarchyIds, money } from '../../lib/catalog';

export function PosPage({ token, profile, categories }: { token: string | null; profile: EmployeeProfile | null; categories?: Category[] }) {
  const [orders, setOrders] = useState<any[]>([]);
  const [products, setProducts] = useState<ProductCard[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | 'all'>('all');
  const [status, setStatus] = useState('');
  const [branchId] = useState(profile?.branchId ?? 1);
  const [sale, setSale] = useState({ name: 'Cliente de mostrador', nit: 'CF', email: 'mostrador@demo.com', phone: '0000-0000', productId: 1, quantity: 1, cashReceived: '' });
  const [selectedProductForModal, setSelectedProductForModal] = useState<ProductCard | null>(null);
  const [qrPayment, setQrPayment] = useState<{ orderCode: string; paymentUrl: string; imageUrl: string } | null>(null);

  async function loadData() {
    if (!token) return;
    const [ordersData, prodsData] = await Promise.all([
      apiRequest<any[]>(`/api/pos/pickup-orders?branchId=${branchId}`, {}, token),
      apiRequest<ProductCard[]>(`/api/public/catalog?branchId=${branchId}`)
    ]);
    setOrders(ordersData);
    setProducts(prodsData);
    if (prodsData.length > 0 && !sale.productId) setSale((prev) => ({ ...prev, productId: prodsData[0].id }));
  }

  useEffect(() => {
    loadData().catch((error) => setStatus(error.message));
  }, [token, branchId]);

  const filteredProducts = products.filter((p) => {
    if (selectedCategoryId !== 'all') {
      const allowedIds = getCategoryHierarchyIds(selectedCategoryId, categories ?? []);
      if (!p.categoryId || !allowedIds.includes(p.categoryId)) return false;
    }
    if (productSearch.trim()) {
      const q = productSearch.toLowerCase().trim();
      const cat = (categories ?? []).find((c) => c.id === p.categoryId);
      if (![p.name, p.sku, p.brand, p.laboratory, cat?.name ?? '', p.presentation].some((f) => f.toLowerCase().includes(q))) return false;
    }
    return true;
  });

  const selectedProd = products.find((p) => p.id === sale.productId);

  async function processSale() {
    try {
      const total = (selectedProd?.price ?? 0) * sale.quantity;
      const cashReceived = Number(sale.cashReceived);
      if (!selectedProd || total <= 0) throw new Error('Selecciona un medicamento válido.');
      if (!Number.isFinite(cashReceived) || cashReceived < total) throw new Error(`El pago es insuficiente. Debe recibir al menos ${money(total)}.`);
      const result = await apiRequest('/api/pos/sales', { method: 'POST', body: JSON.stringify({ branchId, customer: { name: sale.name, nit: sale.nit, email: sale.email, phone: sale.phone }, items: [{ productId: sale.productId, quantity: sale.quantity }] }) }, token);
      setStatus(`Venta procesada exitosamente: ${(result as any).order.code}. Vuelto: ${money(cashReceived - total)}`);
      setSale((previous) => ({ ...previous, cashReceived: '' }));
      loadData();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Error al procesar venta');
    }
  }

  async function createQrPayment() {
    try {
      if (!selectedProd) throw new Error('Selecciona un medicamento válido.');
      const result = await apiRequest<{ order: { code: string }; paymentUrl: string }>('/api/pos/qr-payment', { method: 'POST', body: JSON.stringify({ branchId, customer: { name: sale.name, nit: sale.nit, email: sale.email, phone: sale.phone }, items: [{ productId: sale.productId, quantity: sale.quantity }] }) }, token);
      const imageUrl = await QRCode.toDataURL(result.paymentUrl, { width: 280, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } });
      setQrPayment({ orderCode: result.order.code, paymentUrl: result.paymentUrl, imageUrl });
      setStatus(`QR generado para la orden ${result.order.code}. Esperando pago del cliente.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'No se pudo generar el QR de pago');
    }
  }

  async function releaseOrder(orderId: number) {
    try {
      await apiRequest(`/api/pos/orders/${orderId}/release`, { method: 'POST', body: JSON.stringify({ prescriptionDeliveryUrl: null }) }, token);
      setStatus(`Orden #${orderId} entregada y liberada`);
      loadData();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Error al liberar orden');
    }
  }

  return (
    <div className="internal-page-container">
      <div className="two-col-grid">
        <div className="panel-card">
          <div className="panel-head"><h2>POS de Caja (Sucursal {branchId})</h2><span className="pill-tag">Venta en Mostrador</span></div>
          <div className="form-grid-2">
            <div className="form-field"><label>Cliente</label><input value={sale.name} onChange={(e) => setSale({ ...sale, name: e.target.value })} /></div>
            <div className="form-field"><label>NIT</label><input value={sale.nit} onChange={(e) => setSale({ ...sale, nit: e.target.value })} /></div>
          </div>
          <div className="form-grid-2" style={{ marginTop: '0.65rem', marginBottom: '0.35rem' }}>
            <div className="form-field"><label>Buscar Medicamento</label><input type="text" placeholder="Nombre, SKU, marca..." value={productSearch} onChange={(e) => setProductSearch(e.target.value)} /></div>
            <div className="form-field"><label>Filtrar por categoría</label><select value={selectedCategoryId} onChange={(e) => setSelectedCategoryId(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
              <option value="all">Todas las Categorías ({products.length})</option>
              {(categories ?? []).map((cat) => { const allowedIds = getCategoryHierarchyIds(cat.id, categories ?? []); const count = products.filter((p) => p.categoryId && allowedIds.includes(p.categoryId)).length; return <option key={cat.id} value={cat.id}>{cat.name} ({count})</option>; })}
            </select></div>
          </div>
          {(productSearch || selectedCategoryId !== 'all') && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}><span>Mostrando {filteredProducts.length} de {products.length} medicamentos</span><button type="button" className="btn-secondary" style={{ padding: '0.2rem 0.6rem', fontSize: '0.78rem' }} onClick={() => { setProductSearch(''); setSelectedCategoryId('all'); }}>Limpiar búsqueda</button></div>}
          {filteredProducts.length > 0 && (productSearch || selectedCategoryId !== 'all') && <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.75rem', maxHeight: '120px', overflowY: 'auto' }}>{filteredProducts.slice(0, 10).map((p) => <button key={p.id} type="button" onClick={() => setSale((prev) => ({ ...prev, productId: p.id }))} style={{ padding: '0.35rem 0.65rem', borderRadius: 'var(--radius-sm)', border: p.id === sale.productId ? '2px solid var(--primary)' : '1px solid var(--border)', background: p.id === sale.productId ? 'var(--primary-light, #e6fffa)' : 'var(--surface)', color: 'var(--text-main)', fontSize: '0.78rem', cursor: 'pointer', fontWeight: p.id === sale.productId ? 700 : 500 }}>{p.name} · {money(p.price)}</button>)}</div>}
          <div className="form-field"><label>Medicamento Seleccionado</label><select value={sale.productId} onChange={(e) => setSale({ ...sale, productId: Number(e.target.value) })}>{filteredProducts.length === 0 ? <option value="">No hay medicamentos con los filtros actuales</option> : filteredProducts.map((p) => { const cat = (categories ?? []).find((c) => c.id === p.categoryId); return <option key={p.id} value={p.id}>{p.name} ({p.sku}) · {cat ? `[${cat.name}] · ` : ''}{money(p.price)} · Stock: {p.stock}</option>; })}</select></div>
          {selectedProd && <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', padding: '0.75rem', background: 'var(--bg-subtle)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid var(--border)' }} onClick={() => setSelectedProductForModal(selectedProd)} title="Haz clic para ver especificaciones y ficha técnica completa"><div className="cart-item-thumb" style={{ width: '48px', height: '48px' }}>{selectedProd.imageUrl ? <img src={selectedProd.imageUrl} alt={selectedProd.name} /> : <span>Medicamento</span>}</div><div style={{ flex: 1 }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}><strong>{selectedProd.name}</strong><span style={{ fontSize: '0.74rem', color: 'var(--primary)', fontWeight: 700 }}>Ver Ficha</span></div><p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{selectedProd.brand} · {selectedProd.presentation}</p><div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.2rem' }}><span style={{ color: 'var(--primary-dark)', fontWeight: 700 }}>{money(selectedProd.price)} c/u</span><span style={{ fontSize: '0.8rem', color: selectedProd.stock > 0 ? '#10b981' : '#ef4444', fontWeight: 600 }}>{selectedProd.stock} disponibles</span></div></div></div>}
          <div className="form-field"><label>Cantidad</label><input type="number" min="1" value={sale.quantity} onChange={(e) => setSale({ ...sale, quantity: Number(e.target.value) })} /></div>
          {selectedProd && <div className="pos-cash-summary"><div><span>Total a cobrar</span><strong>{money(selectedProd.price * sale.quantity)}</strong></div><div className="form-field"><label>Pago recibido (Q)</label><input type="number" min={selectedProd.price * sale.quantity} step="0.01" value={sale.cashReceived} onChange={(e) => setSale({ ...sale, cashReceived: e.target.value })} placeholder="Ej. 100" /></div><div className="pos-change-row"><span>Vuelto</span><strong>{money(Math.max(0, Number(sale.cashReceived || 0) - selectedProd.price * sale.quantity))}</strong></div></div>}
          <button type="button" className="btn-primary" onClick={processSale}>Cobrar Venta Físico {selectedProd ? `(${money(selectedProd.price * sale.quantity)})` : ''}</button>
          <button type="button" className="btn-secondary pos-qr-button" onClick={createQrPayment}>Generar QR para pago con tarjeta {selectedProd ? `(${money(selectedProd.price * sale.quantity)})` : ''}</button>
          {qrPayment && <div className="pos-qr-card"><strong>Orden {qrPayment.orderCode}</strong><p>El cliente debe escanear el código y completar el pago con tarjeta.</p><img src={qrPayment.imageUrl} alt={`QR de pago para ${qrPayment.orderCode}`} /><a href={qrPayment.paymentUrl} target="_blank" rel="noreferrer">Abrir pantalla de pago</a></div>}
        </div>
        <div className="panel-card"><div className="panel-head"><h2>Órdenes para Retiro en Tienda</h2><span className="pill-tag">{orders.length} pendientes</span></div><div className="item-list-stack">{orders.map((order) => <div key={order.id} className="compact-list-row"><div><strong>{order.code}</strong><p style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{order.customer?.name ?? 'Cliente'}</p><small>{money(order.total)} · {order.status}</small></div><button type="button" className="btn-secondary" onClick={() => releaseOrder(order.id)}>Liberar Entrega</button></div>)}</div>{status && <div className="checkout-status-msg">{status}</div>}</div>
      </div>
      <ProductDetailModal product={selectedProductForModal} categories={categories ?? []} branchName={`Sucursal ${branchId}`} onClose={() => setSelectedProductForModal(null)} onAddToCart={(productId, quantity) => { setSale((prev) => ({ ...prev, productId, quantity })); setSelectedProductForModal(null); }} inCartQuantity={0} />
    </div>
  );
}

export default PosPage;
