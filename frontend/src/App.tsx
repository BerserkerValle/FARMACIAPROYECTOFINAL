import { useEffect, useState } from 'react';
import { useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { apiRequest, uploadTemporaryPrescription, uploadPrescription, uploadProductImage } from './api';

type Portal = 'public' | 'login' | 'customer' | 'pos' | 'warehouse' | 'delivery' | 'admin';

interface Branch {
  id: number;
  name: string;
  city: string;
  address: string;
}

interface Category {
  id: number;
  name: string;
  parentId: number | null;
}

interface Supplier {
  id: number;
  name: string;
  nit: string;
  email: string;
  phone: string;
  address: string;
  active: boolean;
}

interface ProductCard {
  id: number;
  name: string;
  sku: string;
  categoryId?: number;
  brand: string;
  laboratory: string;
  presentation: string;
  unitMeasure?: string;
  sanitaryRegistry?: string;
  requiresPrescription: boolean;
  price: number;
  cost?: number;
  stock: number;
  description: string;
  imageUrl?: string | null;
  lots: Array<{ id: number; batchCode: string; expirationDate: string; quantityAvailable: number; branchId?: number; salePrice?: number }>;
}

interface EmployeeProfile {
  employeeId: number;
  role: string;
  branchId: number | null;
  fullName: string;
  email: string;
}

interface CustomerAccount {
  customerId: number;
  fullName: string;
  email: string;
  phone: string;
  nit: string;
  address: string;
}

interface DashboardMetrics {
  salesToday: number;
  salesMonth: number;
  lowStockCount: number;
  expiringLotsCount: number;
  registeredCustomers: number;
  pendingOrders: number;
}

const moneyFormatter = new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' });

function money(value: number) {
  return moneyFormatter.format(value);
}

function readToken() {
  const sessionId = localStorage.getItem('derkas.token');
  return sessionId && /^\d+$/.test(sessionId) ? sessionId : null;
}

function readProfile() {
  const raw = localStorage.getItem('derkas.profile');
  return raw ? (JSON.parse(raw) as EmployeeProfile) : null;
}

function saveSession(token: string, profile: EmployeeProfile) {
  localStorage.setItem('derkas.token', token);
  localStorage.setItem('derkas.profile', JSON.stringify(profile));
}

function clearSession() {
  localStorage.removeItem('derkas.token');
  localStorage.removeItem('derkas.profile');
}

function getCategoryHierarchyIds(categoryId: number, allCategories: Category[]): number[] {
  const ids = [categoryId];
  const children = allCategories.filter((c) => c.parentId === categoryId);
  for (const child of children) {
    ids.push(...getCategoryHierarchyIds(child.id, allCategories));
  }
  return ids;
}

/* =========================================================================
   TOP HEADER
   ========================================================================= */

function TopHeader({
  branches,
  branchId,
  onSelectBranch,
  cartCount,
  cartTotal,
  activePortal,
  onNavigatePortal,
  token,
  profile,
  onLogout,
  customer,
  onCustomerLogout
}: {
  branches: Branch[];
  branchId: number;
  onSelectBranch: (id: number) => void;
  cartCount: number;
  cartTotal: number;
  activePortal: Portal;
  onNavigatePortal: (portal: Portal) => void;
  token: string | null;
  profile: EmployeeProfile | null;
  onLogout: () => void;
  customer: CustomerAccount | null;
  onCustomerLogout: () => void;
}) {
  return (
    <header className="top-header">
      <div className="header-inner">
        {/* Brand */}
        <div className="brand-link" onClick={() => onNavigatePortal('public')}>
          {token && profile ? (
            <div className="brand-icon"><span>+</span></div>
          ) : (
            <button
              type="button"
              className="brand-icon brand-access-trigger"
              onClick={(event) => { event.stopPropagation(); onNavigatePortal(activePortal === 'login' ? 'public' : 'login'); }}
              title="Acceso Personal"
            >
              <span>+</span>
            </button>
          )}
          <div className="brand-info">
            <h1>DERKAS</h1>
            <p>Farmacia Digital</p>
          </div>
        </div>

        {/* Header Actions */}
        <div className="header-actions">
          {/* Branch Dropdown */}
          {activePortal === 'public' && branches.length > 0 && (
            <div className="branch-select-wrap">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <select
                className="branch-dropdown"
                value={branchId}
                onChange={(e) => onSelectBranch(Number(e.target.value))}
                title="Seleccionar sucursal de inventario"
              >
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name} ({branch.city})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Internal Portal Navigation when logged in */}
          {token && profile && (
            <nav className="portal-nav-pills">
              <button
                type="button"
                className={`portal-nav-pill ${activePortal === 'public' ? 'active' : ''}`}
                onClick={() => onNavigatePortal('public')}
              >
                Catálogo
              </button>
              <button
                type="button"
                className={`portal-nav-pill ${activePortal === 'pos' ? 'active' : ''}`}
                onClick={() => onNavigatePortal('pos')}
              >
                POS
              </button>
              <button
                type="button"
                className={`portal-nav-pill ${activePortal === 'warehouse' ? 'active' : ''}`}
                onClick={() => onNavigatePortal('warehouse')}
              >
                Bodega
              </button>
              <button
                type="button"
                className={`portal-nav-pill ${activePortal === 'delivery' ? 'active' : ''}`}
                onClick={() => onNavigatePortal('delivery')}
              >
                Reparto
              </button>
              <button
                type="button"
                className={`portal-nav-pill ${activePortal === 'admin' ? 'active' : ''}`}
                onClick={() => onNavigatePortal('admin')}
              >
                Admin
              </button>
            </nav>
          )}

          {/* User Session / Login Button */}
          {token && profile ? (
            <button type="button" className="portal-switch-btn" onClick={onLogout} title="Cerrar sesión">
              <span>{profile.fullName.split(' ')[0]}</span>
              <small style={{ opacity: 0.7 }}>({profile.role})</small>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          ) : null}
          {!token || !profile ? (customer ? (
            <button type="button" className="portal-switch-btn" onClick={() => onNavigatePortal('customer')} title="Ver mis pedidos y entregas">
              <span>{customer.fullName.split(' ')[0]}</span>
              <small>(Mis pedidos)</small>
            </button>
          ) : (
            <button type="button" className="portal-switch-btn" onClick={() => onNavigatePortal('customer')}>
              <span>Mi cuenta</span>
            </button>
          )) : null}
        </div>
      </div>
    </header>
  );
}

/* =========================================================================
   TOP PAYMENT SECTION ("que arriba tenga la forma de pagar")
   ========================================================================= */

function TopPaymentBar({
  cart,
  products,
  onUpdateQuantity,
  onRemoveItem,
  onSelectProductForModal,
  branchId,
  branches,
  recipeFile,
  onSetRecipeFile,
  checkout,
  onUpdateCheckout,
  onSubmitPayment,
  isSubmitting,
  status,
  paymentUrl
}: {
  cart: Array<{ productId: number; quantity: number }>;
  products: ProductCard[];
  onUpdateQuantity: (productId: number, delta: number) => void;
  onRemoveItem: (productId: number) => void;
  onSelectProductForModal?: (product: ProductCard) => void;
  branchId: number;
  branches: Branch[];
  recipeFile: File | null;
  onSetRecipeFile: (file: File | null) => void;
  checkout: {
    name: string;
    nit: string;
    email: string;
    phone: string;
    deliveryMode: 'DELIVERY' | 'PICKUP';
    paymentMethod: 'STRIPE' | 'CASH';
    address: string;
    deliveryLatitude: number | null;
    deliveryLongitude: number | null;
  };
  onUpdateCheckout: (fields: Partial<typeof checkout>) => void;
  onSubmitPayment: () => void;
  isSubmitting: boolean;
  status: string;
  paymentUrl: string;
}) {
  const [isExpanded, setIsExpanded] = useState(true);

  const selectedBranch = branches.find((b) => b.id === branchId);
  const cartItemsWithDetails = cart.map((item) => {
    const product = products.find((p) => p.id === item.productId);
    return {
      ...item,
      product,
      subtotal: (product?.price ?? 0) * item.quantity
    };
  });

  const total = cartItemsWithDetails.reduce((sum, item) => sum + item.subtotal, 0);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const hasPrescriptionItems = cartItemsWithDetails.some((item) => item.product?.requiresPrescription);

  return (
    <section className="top-payment-section">
      <div className="top-payment-container">
        {/* Payment Section Header / Summary Bar */}
        <div className="top-payment-header">
          <div className="top-payment-title-group">
            <div className="pay-icon-badge">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                <line x1="1" y1="10" x2="23" y2="10" />
              </svg>
            </div>
            <div>
              <h2>Forma de Pago & Checkout Online</h2>
              <p>
                {cartCount > 0
                  ? `${cartCount} medicamento${cartCount > 1 ? 's' : ''} en carrito para ${selectedBranch ? selectedBranch.name : 'sucursal'}`
                  : 'Agrega medicamentos del catálogo abajo para completar tu compra'}
              </p>
            </div>
          </div>

          <div className="top-payment-actions">
            <div className="top-total-badge">
              <span>Total:</span>
              <strong>{money(total)}</strong>
            </div>
            <button
              type="button"
              className="toggle-expand-btn"
              onClick={() => setIsExpanded(!isExpanded)}
              title={isExpanded ? 'Contraer forma de pago' : 'Expandir forma de pago'}
            >
              <span>{isExpanded ? 'Ocultar detalles' : 'Ver formulario de pago'}</span>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </div>
        </div>

        {/* Expandable Payment Form & Cart List */}
        {isExpanded && (
          <div className="top-payment-body">
            <div className="top-payment-grid">
              {/* Left Column: Cart items */}
              <div className="top-cart-col">
                <div className="top-col-header">
                  <h3>Artículos en Carrito ({cartCount})</h3>
                </div>

                {cart.length === 0 ? (
                  <div className="top-cart-empty">
                    <p>🛒 Carrito vacío</p>
                    <span>Haz clic en "Agregar al Carrito" en cualquier producto del catálogo abajo.</span>
                  </div>
                ) : (
                  <div className="top-cart-items-scroll">
                    {cartItemsWithDetails.map((item) => (
                      <div key={item.productId} className="top-cart-item-row">
                        <div
                          className="top-item-row-left"
                          style={{ cursor: item.product ? 'pointer' : 'default' }}
                          onClick={() => {
                            if (item.product && onSelectProductForModal) {
                              onSelectProductForModal(item.product);
                            }
                          }}
                          title="Haz clic para ver especificaciones y detalles completos"
                        >
                          <div className="cart-item-thumb">
                            {item.product?.imageUrl ? (
                              <img
                                src={item.product.imageUrl}
                                alt={item.product.name}
                                onError={(e) => {
                                  (e.currentTarget as HTMLElement).style.display = 'none';
                                }}
                              />
                            ) : (
                              <span className="cart-item-thumb-fallback">💊</span>
                            )}
                          </div>
                          <div className="top-item-info">
                            <span className="top-item-name" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                              {item.product?.name ?? `Producto #${item.productId}`}
                              <span style={{ fontSize: '0.72rem', color: 'var(--primary)', fontWeight: 600 }}>🔍</span>
                            </span>
                            <span className="top-item-unit-price">
                              {money(item.product?.price ?? 0)} c/u
                              {item.product?.requiresPrescription && (
                                <span className="top-item-rx-tag"> • Receta requerida</span>
                              )}
                            </span>
                          </div>
                        </div>

                        <div className="top-qty-group">
                          <button
                            type="button"
                            className="top-qty-btn"
                            onClick={() => onUpdateQuantity(item.productId, -1)}
                          >
                            -
                          </button>
                          <span className="top-qty-text">{item.quantity}</span>
                          <button
                            type="button"
                            className="top-qty-btn"
                            onClick={() => onUpdateQuantity(item.productId, 1)}
                          >
                            +
                          </button>
                        </div>

                        <strong className="top-item-subtotal">{money(item.subtotal)}</strong>

                        <button
                          type="button"
                          className="top-item-del-btn"
                          onClick={() => onRemoveItem(item.productId)}
                          title="Eliminar"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {hasPrescriptionItems && (
                  <div className="prescription-alert-box" style={{ marginTop: '0.75rem' }}>
                    <span>⚠️</span>
                    <div>
                      <strong>Receta médica requerida</strong>
                      <p>Has seleccionado medicamentos éticos. Adjunta la foto de tu receta a la derecha.</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column: Customer Details & Pay Action */}
              <div className="top-form-col">
                <div className="top-col-header">
                  <h3>Datos de Facturación y Entrega</h3>
                </div>

                <div className="form-grid-2">
                  <div className="form-field">
                    <label>Nombre y Apellido</label>
                    <input
                      type="text"
                      value={checkout.name}
                      onChange={(e) => onUpdateCheckout({ name: e.target.value })}
                      placeholder="Ej. Juan Pérez"
                    />
                  </div>
                  <div className="form-field">
                    <label>NIT o C/F</label>
                    <input
                      type="text"
                      value={checkout.nit}
                      onChange={(e) => onUpdateCheckout({ nit: e.target.value })}
                      placeholder="CF o 1234567-8"
                    />
                  </div>
                </div>

                <div className="form-grid-2">
                  <div className="form-field">
                    <label>Correo Electrónico</label>
                    <input
                      type="email"
                      value={checkout.email}
                      onChange={(e) => onUpdateCheckout({ email: e.target.value })}
                      placeholder="cliente@correo.com"
                    />
                  </div>
                  <div className="form-field">
                    <label>Teléfono Celular</label>
                    <input
                      type="tel"
                      value={checkout.phone}
                      onChange={(e) => onUpdateCheckout({ phone: e.target.value })}
                      placeholder="5555-4444"
                    />
                  </div>
                </div>

                {/* Delivery Mode */}
                <div className="form-field">
                  <label>Método de Entrega</label>
                  <div className="delivery-toggle-group">
                    <button
                      type="button"
                      className={`delivery-toggle-btn ${checkout.deliveryMode === 'DELIVERY' ? 'active' : ''}`}
                      onClick={() => onUpdateCheckout({ deliveryMode: 'DELIVERY' })}
                    >
                      🛵 Envío a Domicilio
                    </button>
                    <button
                      type="button"
                      className={`delivery-toggle-btn ${checkout.deliveryMode === 'PICKUP' ? 'active' : ''}`}
                      onClick={() => onUpdateCheckout({ deliveryMode: 'PICKUP' })}
                    >
                      🏪 Retiro en Sucursal ({selectedBranch ? selectedBranch.name : 'Sede'})
                    </button>
                  </div>
                </div>

                {checkout.deliveryMode === 'DELIVERY' && (
                  <div className="form-field">
                    <label>Dirección de Entrega</label>
                    <input
                      type="text"
                      value={checkout.address}
                      onChange={(e) => onUpdateCheckout({ address: e.target.value })}
                      placeholder="Dirección exacta, zona, número de casa..."
                    />
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ marginTop: '0.5rem' }}
                      onClick={() => {
                        if (!navigator.geolocation) return;
                        navigator.geolocation.getCurrentPosition(
                          (position) => onUpdateCheckout({ deliveryLatitude: position.coords.latitude, deliveryLongitude: position.coords.longitude }),
                          () => onUpdateCheckout({ deliveryLatitude: null, deliveryLongitude: null })
                        );
                      }}
                    >
                      {checkout.deliveryLatitude !== null ? 'Ubicación real guardada' : 'Usar mi ubicación actual'}
                    </button>
                    {checkout.deliveryLatitude !== null && <small style={{ display: 'block', marginTop: '0.35rem', color: 'var(--text-muted)' }}>Se enviará tu ubicación GPS para mayor precisión.</small>}
                  </div>
                )}

                <div className="form-field">
                  <label>Método de pago</label>
                  <div className="delivery-toggle-group">
                    <button
                      type="button"
                      className={`delivery-toggle-btn ${checkout.paymentMethod === 'STRIPE' ? 'active' : ''}`}
                      onClick={() => onUpdateCheckout({ paymentMethod: 'STRIPE' })}
                    >
                      💳 Pagar con Stripe
                    </button>
                    <button
                      type="button"
                      className={`delivery-toggle-btn ${checkout.paymentMethod === 'CASH' ? 'active' : ''}`}
                      onClick={() => onUpdateCheckout({ paymentMethod: 'CASH' })}
                    >
                      💵 {checkout.deliveryMode === 'DELIVERY' ? 'Efectivo contra entrega' : 'Efectivo en sucursal'}
                    </button>
                  </div>
                </div>

                {/* Prescription Upload if needed */}
                {hasPrescriptionItems && (
                  <div className="form-field">
                    <label>Fotografía de Receta Médica</label>
                    <label className="prescription-dropzone">
                      <span>📷</span>
                      <span style={{ flex: 1, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        {recipeFile ? recipeFile.name : 'Subir archivo de receta médica...'}
                      </span>
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        onChange={(e) => onSetRecipeFile(e.target.files?.[0] ?? null)}
                      />
                    </label>
                  </div>
                )}

                {/* Checkout Pay Button */}
                <button
                  type="button"
                  className="checkout-submit-btn"
                  disabled={cart.length === 0 || isSubmitting}
                  onClick={onSubmitPayment}
                >
                  {isSubmitting ? (
                    <span>Procesando pago seguro...</span>
                  ) : (
                    <>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                        <line x1="1" y1="10" x2="23" y2="10" />
                      </svg>
                      <span>{checkout.paymentMethod === 'CASH' ? 'CONFIRMAR PEDIDO' : 'PAGAR ORDEN'} {total > 0 ? `(${money(total)})` : ''}</span>
                    </>
                  )}
                </button>

                {/* Feedback Message */}
                {status && <div className="checkout-status-msg">{status}</div>}

                {/* Direct Stripe / Gateway Link */}
                {paymentUrl && (
                  <a className="payment-gateway-link" href={paymentUrl} target="_blank" rel="noreferrer">
                    <span>Ir a Pasarela de Pago Seguro / Stripe</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/* =========================================================================
   PRODUCT DETAIL MODAL ("al darle click a un producto se abre con su descripcion y datos")
   ========================================================================= */

function ProductDetailModal({
  product,
  categories,
  branchName,
  onClose,
  onAddToCart,
  inCartQuantity
}: {
  product: ProductCard | null;
  categories: Category[];
  branchName?: string;
  onClose: () => void;
  onAddToCart: (productId: number, quantity: number) => void;
  inCartQuantity: number;
}) {
  const [qty, setQty] = useState(1);
  const [activeTab, setActiveTab] = useState<'specs' | 'desc' | 'lots' | 'safety'>('specs');
  const [recentlyAdded, setRecentlyAdded] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);

  useEffect(() => {
    setQty(1);
    setActiveTab('specs');
    setRecentlyAdded(false);
    setIsZoomed(false);
  }, [product]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (isZoomed) setIsZoomed(false);
        else onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, isZoomed]);

  if (!product) return null;

  const category = categories.find((c) => c.id === product.categoryId);
  const categoryName = category?.name ?? 'Farmacia / Medicamentos';
  const remainingStock = Math.max(0, product.stock - inCartQuantity);

  const handleAdd = () => {
    onAddToCart(product.id, qty);
    setRecentlyAdded(true);
    setTimeout(() => {
      setRecentlyAdded(false);
    }, 1600);
  };

  const subtotal = product.price * qty;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="product-detail-modal" onClick={(e) => e.stopPropagation()}>
        {/* Close Button */}
        <button type="button" className="modal-close-btn" onClick={onClose} title="Cerrar (Esc)">
          ✕
        </button>

        {/* Modal Top Badges Header */}
        <div className="modal-top-bar">
          <div className="modal-header-badges">
            <span className="modal-cat-badge">💊 {categoryName}</span>
            <span className="badge-sku">SKU: {product.sku}</span>
            <span className={`badge-prescription ${product.requiresPrescription ? 'rx' : 'otc'}`}>
              {product.requiresPrescription ? '📋 Requiere Receta Médica MSPAS' : '🟢 Venta Libre (OTC)'}
            </span>
          </div>
        </div>

        <div className="modal-body-grid">
          {/* Left Column: Image & Quick Specs Card */}
          <div className="modal-image-col">
            <div
              className={`modal-image-wrap ${isZoomed ? 'zoomed' : ''}`}
              onClick={() => product.imageUrl && setIsZoomed(!isZoomed)}
              title={product.imageUrl ? (isZoomed ? 'Clic para reducir' : 'Clic para ampliar foto') : undefined}
            >
              {product.imageUrl ? (
                <>
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    className="modal-product-img"
                    onError={(e) => {
                      (e.currentTarget as HTMLElement).style.display = 'none';
                      const fallback = e.currentTarget.parentElement?.querySelector('.product-img-fallback');
                      if (fallback) (fallback as HTMLElement).style.display = 'flex';
                    }}
                  />
                  <div className="image-zoom-overlay-hint">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      <line x1="11" y1="8" x2="11" y2="14" />
                      <line x1="8" y1="11" x2="14" y2="11" />
                    </svg>
                    <span>{isZoomed ? 'Reducir' : 'Ampliar foto'}</span>
                  </div>
                </>
              ) : null}
              <div
                className="product-img-fallback"
                style={{ display: product.imageUrl ? 'none' : 'flex' }}
              >
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.5 20.5l10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" />
                  <path d="m8.5 8.5 7 7" />
                </svg>
                <span>Farmacia Derkas</span>
              </div>
            </div>

            {/* Quick Specs Highlight */}
            <div className="modal-spec-card">
              <div className="spec-card-title">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                <strong>Ficha Técnica Resumida</strong>
              </div>
              <div className="spec-item">
                <span>Laboratorio:</span>
                <strong>{product.laboratory || 'Laboratorio Certificado'}</strong>
              </div>
              <div className="spec-item">
                <span>Marca Comercial:</span>
                <strong>{product.brand || 'Derkas'}</strong>
              </div>
              <div className="spec-item">
                <span>Presentación:</span>
                <strong>{product.presentation || 'Estándar'}</strong>
              </div>
              <div className="spec-item">
                <span>Unidad de Medida:</span>
                <strong>{product.unitMeasure || 'Unidad'}</strong>
              </div>
              <div className="spec-item">
                <span>Registro Sanitario:</span>
                <strong style={{ color: 'var(--primary-dark)' }}>{product.sanitaryRegistry || 'MSPAS-2026-REG'}</strong>
              </div>
              {branchName && (
                <div className="spec-item">
                  <span>Sucursal de Consulta:</span>
                  <strong>{branchName}</strong>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Title, Interactive Tabs, Details & Cart Actions */}
          <div className="modal-info-col">
            <div>
              <div className="modal-brand-header">
                <span className="modal-brand-tag">{product.brand} · {product.laboratory}</span>
              </div>
              <h2 className="modal-title">{product.name}</h2>
              {product.presentation && <p className="modal-presentation">{product.presentation}</p>}
            </div>

            {/* Price & Stock Banner */}
            <div className="modal-price-box">
              <div>
                <span className="price-label">Precio Unitario al Público</span>
                <div className="modal-price-val">{money(product.price)}</div>
              </div>
              <div className="modal-stock-status">
                <span className={`stock-indicator-dot ${product.stock > 0 ? 'stock-in' : 'stock-out'}`} />
                <span style={{ color: product.stock > 0 ? '#10b981' : '#ef4444', fontWeight: 700 }}>
                  {product.stock > 0 ? 'Disponible' : 'Sin stock'}
                </span>
              </div>
            </div>

            {/* Navigation Tabs for Details */}
            <div className="modal-tabs-nav">
              <button
                type="button"
                className={`modal-tab-btn ${activeTab === 'specs' ? 'active' : ''}`}
                onClick={() => setActiveTab('specs')}
              >
                📋 Especificaciones
              </button>
              <button
                type="button"
                className={`modal-tab-btn ${activeTab === 'desc' ? 'active' : ''}`}
                onClick={() => setActiveTab('desc')}
              >
                📖 Uso Terapéutico
              </button>
              <button
                type="button"
                className={`modal-tab-btn ${activeTab === 'lots' ? 'active' : ''}`}
                onClick={() => setActiveTab('lots')}
              >
                📦 Lotes ({product.lots?.length ?? 0})
              </button>
              <button
                type="button"
                className={`modal-tab-btn ${activeTab === 'safety' ? 'active' : ''}`}
                onClick={() => setActiveTab('safety')}
              >
                🛡️ Normativa & Conservación
              </button>
            </div>

            {/* TAB CONTENT 1: Full Specifications Grid */}
            {activeTab === 'specs' && (
              <div className="modal-tab-pane">
                <div className="modal-specs-full-grid">
                  <div className="spec-box">
                    <span className="spec-box-label">Nombre del Medicamento</span>
                    <strong className="spec-box-value">{product.name}</strong>
                  </div>
                  <div className="spec-box">
                    <span className="spec-box-label">Categoría Terapéutica</span>
                    <strong className="spec-box-value">{categoryName}</strong>
                  </div>
                  <div className="spec-box">
                    <span className="spec-box-label">Laboratorio Fabricante</span>
                    <strong className="spec-box-value">{product.laboratory}</strong>
                  </div>
                  <div className="spec-box">
                    <span className="spec-box-label">Marca Comercial</span>
                    <strong className="spec-box-value">{product.brand}</strong>
                  </div>
                  <div className="spec-box">
                    <span className="spec-box-label">Presentación Comercial</span>
                    <strong className="spec-box-value">{product.presentation}</strong>
                  </div>
                  <div className="spec-box">
                    <span className="spec-box-label">Forma / Unidad de Medida</span>
                    <strong className="spec-box-value">{product.unitMeasure || 'Dosis / Unidad'}</strong>
                  </div>
                  <div className="spec-box">
                    <span className="spec-box-label">Registro Sanitario MSPAS</span>
                    <strong className="spec-box-value" style={{ color: 'var(--primary-dark)' }}>{product.sanitaryRegistry || 'MSPAS Certificado'}</strong>
                  </div>
                  <div className="spec-box">
                    <span className="spec-box-label">Código SKU / Barra</span>
                    <strong className="spec-box-value">{product.sku}</strong>
                  </div>
                  <div className="spec-box" style={{ gridColumn: 'span 2' }}>
                    <span className="spec-box-label">Condición Sanitaria de Venta</span>
                    <strong className="spec-box-value" style={{ color: product.requiresPrescription ? '#b45309' : '#047857' }}>
                      {product.requiresPrescription
                        ? '⚠️ Medicamento Ético - Venta Bajo Prescripción Médica Retenida (MSPAS)'
                        : '🟢 Venta Libre (OTC) - Medicamento de dispensación directa'}
                    </strong>
                  </div>
                </div>
              </div>
            )}

            {/* TAB CONTENT 2: Description & Therapeutic info */}
            {activeTab === 'desc' && (
              <div className="modal-tab-pane">
                <div className="modal-desc-section">
                  <h4>Descripción Clínica e Indicaciones</h4>
                  <p>{product.description || 'Medicamento farmacéutico certificado con control sanitario de calidad y eficacia comprobada.'}</p>
                </div>
                <div className="modal-feature-bullets">
                  <div className="feature-bullet-item">
                    <span className="bullet-icon">✓</span>
                    <div>
                      <strong>Calidad Farmacéutica Certificada</strong>
                      <p>Producto original distribuido bajo estándares de Buenas Prácticas de Almacenamiento y Dispensación.</p>
                    </div>
                  </div>
                  <div className="feature-bullet-item">
                    <span className="bullet-icon">✓</span>
                    <div>
                      <strong>Trazabilidad y Control PEPS</strong>
                      <p>Lotes verificados con fecha de vencimiento controlada para garantizar máxima efectividad terapéutica.</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB CONTENT 3: Lots & Expirations */}
            {activeTab === 'lots' && (
              <div className="modal-tab-pane">
                <div className="modal-lots-box">
                  <div className="lots-box-header">
                    <h4>Trazabilidad de Lotes y Fechas de Vencimiento</h4>
                    <span>Sucursal: {branchName ?? 'Sede Central'}</span>
                  </div>
                  {product.lots && product.lots.length > 0 ? (
                    <div className="lots-table-wrap">
                      <table className="lots-table">
                        <thead>
                          <tr>
                            <th>Código de Lote</th>
                            <th>Fecha de Vencimiento</th>
                            <th>Estado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {product.lots.map((lot) => (
                            <tr key={lot.id}>
                              <td><strong>{lot.batchCode}</strong></td>
                              <td>{lot.expirationDate}</td>
                              <td>
                                <span className={`lot-status-badge ${lot.quantityAvailable > 0 ? 'vigente' : 'agotado'}`}>
                                  {lot.quantityAvailable > 0 ? 'Disponible' : 'Sin stock'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="no-lots-msg">
                      <p>No hay lotes con existencia registrados en esta sucursal.</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB CONTENT 4: Safety & Storage */}
            {activeTab === 'safety' && (
              <div className="modal-tab-pane">
                <div className="modal-safety-grid">
                  {product.requiresPrescription && (
                    <div className="prescription-alert-box">
                      <span>⚠️</span>
                      <div>
                        <strong>Medicamento Ético con Receta Obligatoria</strong>
                        <p>De acuerdo con la legislación sanitaria del MSPAS, este medicamento requiere receta médica válida emitida por un profesional de la salud colegiado.</p>
                      </div>
                    </div>
                  )}
                  <div className="storage-card">
                    <h5>🌡️ Condiciones de Almacenamiento y Conservación</h5>
                    <ul>
                      <li>Conservar en su empaque original a temperatura ambiente no mayor a 30°C.</li>
                      <li>Proteger de la luz solar directa, humedad y fuentes de calor.</li>
                      <li>Manténgase fuera del alcance y de la vista de los niños.</li>
                      <li>No consumir después de la fecha de vencimiento indicada en el empaque y lote.</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* Quantity Selector & Add to Cart Area */}
            <div className="modal-actions-area">
              <div className="modal-qty-row">
                <div>
                  <span className="qty-subtotal-label">Subtotal ({qty} {qty > 1 ? 'unidades' : 'unidad'}):</span>
                  <strong className="qty-subtotal-val">{money(subtotal)}</strong>
                </div>

                <div className="modal-qty-control">
                  <button
                    type="button"
                    className="modal-qty-btn"
                    onClick={() => setQty((prev) => Math.max(1, prev - 1))}
                    disabled={qty <= 1}
                    title="Disminuir cantidad"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    className="modal-qty-input"
                    min="1"
                    max={remainingStock || 1}
                    value={qty}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (val >= 1 && val <= Math.max(1, remainingStock)) {
                        setQty(val);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="modal-qty-btn"
                    onClick={() => setQty((prev) => (remainingStock > prev ? prev + 1 : prev))}
                    disabled={qty >= remainingStock}
                    title="Aumentar cantidad"
                  >
                    +
                  </button>
                </div>
              </div>

              <button
                type="button"
                className={`modal-add-btn ${recentlyAdded ? 'added' : ''}`}
                disabled={product.stock <= 0}
                onClick={handleAdd}
              >
                {recentlyAdded ? (
                  <span>✓ ¡Agregado a la forma de pago arriba!</span>
                ) : (
                  <>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    <span>
                      Agregar {qty} {qty > 1 ? 'unidades' : 'unidad'} ({money(subtotal)})
                      {inCartQuantity > 0 ? ` · Ya en carrito: ${inCartQuantity}` : ''}
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   CLEAN MAIN CATALOG SECTION ("solo salga el catálogo")
   ========================================================================= */

function PublicCatalogView({
  branches,
  branchId,
  categories,
  products,
  query,
  onQueryChange,
  cart,
  onAddToCart,
  toastMessage
}: {
  branches: Branch[];
  branchId: number;
  categories: Category[];
  products: ProductCard[];
  query: string;
  onQueryChange: (q: string) => void;
  cart: Array<{ productId: number; quantity: number }>;
  onAddToCart: (productId: number, quantity?: number) => void;
  toastMessage: string | null;
}) {
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | 'all'>('all');
  const [filterType, setFilterType] = useState<'all' | 'otc' | 'rx'>('all');
  const [recentlyAddedId, setRecentlyAddedId] = useState<number | null>(null);
  const [selectedProductForModal, setSelectedProductForModal] = useState<ProductCard | null>(null);

  const selectedBranch = branches.find((b) => b.id === branchId);

  // Filter products based on filterType and selectedCategoryId
  const filteredProducts = products.filter((product) => {
    if (filterType === 'otc' && product.requiresPrescription) return false;
    if (filterType === 'rx' && !product.requiresPrescription) return false;
    if (selectedCategoryId !== 'all') {
      const allowedCategoryIds = getCategoryHierarchyIds(selectedCategoryId, categories);
      if (!product.categoryId || !allowedCategoryIds.includes(product.categoryId)) {
        return false;
      }
    }
    return true;
  });

  const otcCount = products.filter((p) => !p.requiresPrescription).length;
  const rxCount = products.filter((p) => p.requiresPrescription).length;

  const handleAdd = (e: React.MouseEvent, productId: number) => {
    e.stopPropagation();
    onAddToCart(productId, 1);
    setRecentlyAddedId(productId);
    setTimeout(() => {
      setRecentlyAddedId(null);
    }, 1200);
  };

  const activeInCartItem = selectedProductForModal
    ? cart.find((i) => i.productId === selectedProductForModal.id)
    : null;

  return (
    <main className="catalog-layout">
      {/* Control Bar: Search & Title */}
      <div className="catalog-control-bar">
        <div className="catalog-header-row">
          <div className="catalog-title-block">
            <h2>Catálogo de Medicamentos</h2>
            <p>
              Inventario disponible en{' '}
              <strong>{selectedBranch ? `${selectedBranch.name}, ${selectedBranch.city}` : 'Sucursal'}</strong>
            </p>
          </div>

          {/* Search Box */}
          <div className="catalog-search-wrap">
            <svg className="search-icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="catalog-search-input"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Buscar por medicamento, principio activo, marca o SKU..."
            />
            {query && (
              <button
                type="button"
                className="clear-search-btn"
                onClick={() => onQueryChange('')}
                title="Limpiar búsqueda"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Categories Bar */}
        {categories.length > 0 && (
          <div className="filter-pills-row" style={{ marginTop: '0.25rem' }}>
            <button
              type="button"
              className={`filter-pill-btn ${selectedCategoryId === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedCategoryId('all')}
            >
              <span>📁 Todas las Categorías</span>
              <span className="filter-pill-count">{products.length}</span>
            </button>
            {categories.map((cat) => {
              const allowedIds = getCategoryHierarchyIds(cat.id, categories);
              const count = products.filter((p) => p.categoryId && allowedIds.includes(p.categoryId)).length;
              return (
                <button
                  key={cat.id}
                  type="button"
                  className={`filter-pill-btn ${selectedCategoryId === cat.id ? 'active' : ''}`}
                  onClick={() => setSelectedCategoryId(selectedCategoryId === cat.id ? 'all' : cat.id)}
                >
                  <span>{cat.name}</span>
                  <span className="filter-pill-count">{count}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Prescription & Clean Filters */}
        <div className="filter-pills-row">
          <button
            type="button"
            className={`filter-pill-btn ${filterType === 'all' ? 'active' : ''}`}
            onClick={() => setFilterType('all')}
          >
            <span>Todos los Tipos</span>
          </button>
          <button
            type="button"
            className={`filter-pill-btn ${filterType === 'otc' ? 'active' : ''}`}
            onClick={() => setFilterType('otc')}
          >
            <span>🟢 Venta Libre</span>
            <span className="filter-pill-count">{otcCount}</span>
          </button>
          <button
            type="button"
            className={`filter-pill-btn ${filterType === 'rx' ? 'active' : ''}`}
            onClick={() => setFilterType('rx')}
          >
            <span>📋 Requiere Receta</span>
            <span className="filter-pill-count">{rxCount}</span>
          </button>

          {(selectedCategoryId !== 'all' || filterType !== 'all' || query) && (
            <button
              type="button"
              className="btn-secondary"
              style={{ padding: '0.4rem 0.9rem', fontSize: '0.82rem', marginLeft: 'auto', borderRadius: 'var(--radius-full)' }}
              onClick={() => {
                setSelectedCategoryId('all');
                setFilterType('all');
                onQueryChange('');
              }}
            >
              ✕ Limpiar Filtros
            </button>
          )}
        </div>
      </div>

      {/* Product Cards Grid */}
      {filteredProducts.length === 0 ? (
        <div className="catalog-empty-state">
          <h3>No encontramos medicamentos</h3>
          <p>No hay productos que coincidan con los filtros en esta sucursal.</p>
        </div>
      ) : (
        <div className="products-grid">
          {filteredProducts.map((product) => {
            const inCartItem = cart.find((i) => i.productId === product.id);
            const inCartQty = inCartItem ? inCartItem.quantity : 0;
            const isAdded = recentlyAddedId === product.id;

            const productCategory = categories.find((c) => c.id === product.categoryId);

            return (
              <article
                key={product.id}
                className="product-card product-card-clickable"
                onClick={() => setSelectedProductForModal(product)}
                title="Haz clic para ver especificaciones y detalles completos"
              >
                <div>
                  {/* Product Image Header with Badges */}
                  <div className="product-image-wrap">
                    {product.imageUrl ? (
                      <img
                        src={product.imageUrl}
                        alt={product.name}
                        className="product-card-img"
                        loading="lazy"
                        onError={(e) => {
                          (e.currentTarget as HTMLElement).style.display = 'none';
                          const fallback = e.currentTarget.parentElement?.querySelector('.product-img-fallback');
                          if (fallback) (fallback as HTMLElement).style.display = 'flex';
                        }}
                      />
                    ) : null}
                    <div
                      className="product-img-fallback"
                      style={{ display: product.imageUrl ? 'none' : 'flex' }}
                    >
                      <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10.5 20.5l10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" />
                        <path d="m8.5 8.5 7 7" />
                      </svg>
                      <span>{product.brand || 'Derkas'}</span>
                    </div>

                    {/* Badges Overlaid over top of image */}
                    <div className="product-card-badges-overlay">
                      <span className="badge-sku">{product.sku}</span>
                      {productCategory && (
                        <span
                          className="badge-sku"
                          style={{ background: 'rgba(15, 23, 42, 0.75)', cursor: 'pointer' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedCategoryId(productCategory.id);
                          }}
                          title={`Filtrar por ${productCategory.name}`}
                        >
                          📁 {productCategory.name}
                        </span>
                      )}
                      <span className={`badge-prescription ${product.requiresPrescription ? 'rx' : 'otc'}`}>
                        {product.requiresPrescription ? '📋 Con Receta' : '🟢 Venta Libre'}
                      </span>
                    </div>
                  </div>

                  {/* Content */}
                  <div className="product-content">
                    <span className="product-brand">
                      {productCategory ? `${productCategory.name} · ` : ''}{product.brand} · {product.laboratory}
                    </span>
                    <h3 className="product-name">{product.name}</h3>
                    {product.presentation && <span className="product-presentation">{product.presentation}</span>}
                    <p className="product-desc">{product.description}</p>
                    <span className="quick-view-badge">
                      🔍 Ver especificaciones y detalles completos
                    </span>
                  </div>
                </div>

                {/* Footer / Price & Add Button */}
                <div className="product-footer" onClick={(e) => e.stopPropagation()}>
                  <div className="product-price-row">
                    <span className="product-price">{money(product.price)}</span>
                    <span className="product-stock-badge">
                      <span className={`stock-indicator-dot ${product.stock > 0 ? 'stock-in' : 'stock-out'}`} />
                      {product.stock > 0 ? 'Disponible' : 'Sin stock'}
                    </span>
                  </div>

                  <button
                    type="button"
                    className={`add-to-cart-btn ${isAdded ? 'added' : ''}`}
                    disabled={product.stock <= 0}
                    onClick={(e) => handleAdd(e, product.id)}
                  >
                    {isAdded ? (
                      <>
                        <span>✓ Agregado a la forma de pago arriba</span>
                      </>
                    ) : (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        <span>Agregar al Carrito {inCartQty > 0 ? `(${inCartQty})` : ''}</span>
                      </>
                    )}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Product Detail Modal */}
      <ProductDetailModal
        product={selectedProductForModal}
        categories={categories}
        branchName={selectedBranch ? `${selectedBranch.name} (${selectedBranch.city})` : undefined}
        onClose={() => setSelectedProductForModal(null)}
        onAddToCart={(id, quantity) => onAddToCart(id, quantity)}
        inCartQuantity={activeInCartItem?.quantity ?? 0}
      />

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="floating-toast">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>{toastMessage}</span>
        </div>
      )}
    </main>
  );
}

/* =========================================================================
   INTERNAL PORTALS: LOGIN, POS, WAREHOUSE, DELIVERY, ADMIN
   ========================================================================= */

function CustomerAuthPage({ onLogin }: { onLogin: (customer: CustomerAccount) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ fullName: '', email: '', password: '', phone: '', nit: '' });
  const [status, setStatus] = useState('');

  async function submit() {
    try {
      const path = mode === 'login' ? '/api/auth/customers/login' : '/api/auth/customers/register';
      const result = await apiRequest<{ customer: CustomerAccount }>(path, {
        method: 'POST',
        body: JSON.stringify(mode === 'login'
          ? { email: form.email, password: form.password }
          : form)
      });
      onLogin(result.customer);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'No se pudo completar la operación');
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-card-box">
        <h2>{mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta de cliente'}</h2>
        <p>Consulta tus pedidos y el avance de tus entregas.</p>
        {mode === 'register' && <div className="form-field"><label>Nombre completo</label><input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></div>}
        <div className="form-field"><label>Correo electrónico</label><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div className="form-field"><label>Contraseña</label><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
        {mode === 'register' && <>
          <div className="form-grid-2">
            <div className="form-field"><label>Teléfono</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div className="form-field"><label>NIT o C/F</label><input value={form.nit} onChange={(e) => setForm({ ...form, nit: e.target.value })} /></div>
          </div>
        </>}
        <button type="button" className="btn-primary" onClick={submit}>{mode === 'login' ? 'Entrar' : 'Crear cuenta'}</button>
        <button type="button" className="btn-secondary" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setStatus(''); }}>
          {mode === 'login' ? 'Crear una cuenta nueva' : 'Ya tengo una cuenta'}
        </button>
        {status && <div className="checkout-status-msg">{status}</div>}
      </div>
    </div>
  );
}

function CustomerLiveMap({ latitude, longitude }: { latitude: number; longitude: number }) {
  const mapElement = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!mapElement.current) return;
    const map = L.map(mapElement.current).setView([latitude, longitude], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    L.circleMarker([latitude, longitude], { radius: 9, color: '#1d4ed8', fillColor: '#3b82f6', fillOpacity: 1 }).addTo(map).bindPopup('Ubicación actual del repartidor').openPopup();
    return () => {
      map.remove();
    };
  }, [latitude, longitude]);

  return <div ref={mapElement} style={{ width: '100%', height: '260px', borderRadius: '8px', overflow: 'hidden', marginTop: '0.75rem' }} />;
}

function CustomerOrdersPage({ customer, onUpdate, onLogout }: { customer: CustomerAccount; onUpdate: (customer: CustomerAccount) => void; onLogout: () => void }) {
  const [orders, setOrders] = useState<any[]>([]);
  const [status, setStatus] = useState('Cargando pedidos...');
  const [form, setForm] = useState(customer);
  const [editing, setEditing] = useState(false);

  async function loadOrders() {
    try {
      const data = await apiRequest<any[]>('/api/public/customer/orders', { headers: { 'X-Customer-Id': String(customer.customerId) } });
      setOrders(data);
      setStatus(data.length ? '' : 'Aún no tienes pedidos de domicilio');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'No se pudieron cargar tus pedidos');
    }
  }

  useEffect(() => {
    loadOrders();
    const timer = window.setInterval(loadOrders, 15000);
    return () => window.clearInterval(timer);
  }, [customer.customerId]);

  async function saveProfile() {
    try {
      const result = await apiRequest<{ customer: CustomerAccount }>('/api/auth/customers/me', {
        method: 'PUT',
        headers: { 'X-Customer-Id': String(customer.customerId) },
        body: JSON.stringify({ fullName: form.fullName, phone: form.phone, nit: form.nit, address: form.address })
      });
      onUpdate(result.customer);
      setForm(result.customer);
      setEditing(false);
      setStatus('Datos actualizados correctamente.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'No se pudieron actualizar tus datos');
    }
  }

  return (
    <div className="internal-page-container">
      <div className="panel-card">
        <div className="panel-head">
          <h2>Mis pedidos y entregas</h2>
          <span className="pill-tag">Actualización automática</span>
        </div>
        <div className="panel-card" style={{ marginBottom: '1rem' }}>
          <div className="panel-head"><h3>Mi información</h3><div style={{ display: 'flex', gap: '0.5rem' }}><button type="button" className="btn-secondary" onClick={() => setEditing(!editing)}>{editing ? 'Cancelar' : 'Editar datos'}</button><button type="button" className="btn-secondary" onClick={onLogout}>Cerrar sesión</button></div></div>
          {editing ? (
            <div className="form-grid-2">
              <div className="form-field"><label>Nombre completo</label><input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></div>
              <div className="form-field"><label>Correo</label><input value={form.email} disabled /></div>
              <div className="form-field"><label>Teléfono</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div className="form-field"><label>NIT o C/F</label><input value={form.nit} onChange={(e) => setForm({ ...form, nit: e.target.value })} /></div>
              <div className="form-field" style={{ gridColumn: '1 / -1' }}><label>Dirección principal</label><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Calle, municipio, número de casa" /></div>
              <button type="button" className="btn-primary" onClick={saveProfile}>Guardar datos</button>
            </div>
          ) : <p>{customer.fullName} · {customer.phone} · {customer.address || 'Sin dirección guardada'}</p>}
        </div>
        {status && <div className="checkout-status-msg">{status}</div>}
        <div className="item-list-stack">
          {orders.map((order) => <div key={order.code} className="compact-list-row">
            <div><strong>{order.code}</strong><p>{order.address}</p><small>Estado: {order.status} · Última actualización: {new Date(order.updatedAt).toLocaleString('es-GT')}</small>{order.latitude && order.longitude && <CustomerLiveMap latitude={Number(order.latitude)} longitude={Number(order.longitude)} />}</div>
            {order.latitude && order.longitude && <span className="pill-tag">Repartidor en ruta</span>}
          </div>)}
        </div>
      </div>
    </div>
  );
}

function LoginPage({ onLogin, onSuccess }: { onLogin: (token: string, profile: EmployeeProfile) => void; onSuccess: () => void }) {
  const [email, setEmail] = useState('admin@derkas.com');
  const [password, setPassword] = useState('Admin123*');
  const [status, setStatus] = useState('');

  async function submit() {
    try {
      const result = await apiRequest<{ employee: EmployeeProfile }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ correo_corporativo: email, contrasena: password })
      });
      onLogin(String(result.employee.employeeId), result.employee);
      onSuccess();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'No se pudo iniciar sesión');
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-card-box">
        <div>
          <h2>Acceso Colaborador</h2>
          <p>Ingreso a POS, Inventarios, Reparto y Administración.</p>
        </div>
        <div className="form-field">
          <label>Correo Corporativo</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@derkas.com" />
        </div>
        <div className="form-field">
          <label>Contraseña</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña" />
        </div>
        <button type="button" className="btn-primary" onClick={submit}>
          Entrar al Sistema
        </button>
        {status && <div className="checkout-status-msg">{status}</div>}
      </div>
    </div>
  );
}

function PosPage({ token, profile, categories }: { token: string | null; profile: EmployeeProfile | null; categories?: Category[] }) {
  const [orders, setOrders] = useState<any[]>([]);
  const [products, setProducts] = useState<ProductCard[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | 'all'>('all');
  const [status, setStatus] = useState('');
  const [branchId] = useState(profile?.branchId ?? 1);
  const [sale, setSale] = useState({ name: 'Cliente de mostrador', nit: 'CF', email: 'mostrador@demo.com', phone: '0000-0000', productId: 1, quantity: 1 });
  const [selectedProductForModal, setSelectedProductForModal] = useState<ProductCard | null>(null);

  async function loadData() {
    if (!token) return;
    const [ordersData, prodsData] = await Promise.all([
      apiRequest<any[]>(`/api/pos/pickup-orders?branchId=${branchId}`, {}, token),
      apiRequest<ProductCard[]>(`/api/public/catalog?branchId=${branchId}`)
    ]);
    setOrders(ordersData);
    setProducts(prodsData);
    if (prodsData.length > 0 && !sale.productId) {
      setSale((prev) => ({ ...prev, productId: prodsData[0].id }));
    }
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
      const match = [p.name, p.sku, p.brand, p.laboratory, cat?.name ?? '', p.presentation].some((f) =>
        f.toLowerCase().includes(q)
      );
      if (!match) return false;
    }
    return true;
  });

  async function processSale() {
    try {
      const result = await apiRequest('/api/pos/sales', {
        method: 'POST',
        body: JSON.stringify({
          branchId,
          customer: { name: sale.name, nit: sale.nit, email: sale.email, phone: sale.phone },
          items: [{ productId: sale.productId, quantity: sale.quantity }]
        })
      }, token);
      setStatus(`Venta procesada exitosamente: ${(result as any).order.code}`);
      loadData();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Error al procesar venta');
    }
  }

  async function releaseOrder(orderId: number) {
    try {
      await apiRequest(`/api/pos/orders/${orderId}/release`, {
        method: 'POST',
        body: JSON.stringify({ prescriptionDeliveryUrl: null })
      }, token);
      setStatus(`Orden #${orderId} entregada y liberada`);
      loadData();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Error al liberar orden');
    }
  }

  const selectedProd = products.find((p) => p.id === sale.productId);

  return (
    <div className="internal-page-container">
      <div className="two-col-grid">
        <div className="panel-card">
          <div className="panel-head">
            <h2>POS de Caja (Sucursal {branchId})</h2>
            <span className="pill-tag">Venta en Mostrador</span>
          </div>
          <div className="form-grid-2">
            <div className="form-field">
              <label>Cliente</label>
              <input value={sale.name} onChange={(e) => setSale({ ...sale, name: e.target.value })} />
            </div>
            <div className="form-field">
              <label>NIT</label>
              <input value={sale.nit} onChange={(e) => setSale({ ...sale, nit: e.target.value })} />
            </div>
          </div>

          {/* Product Search & Category Filter for Cashier */}
          <div className="form-grid-2" style={{ marginTop: '0.65rem', marginBottom: '0.35rem' }}>
            <div className="form-field">
              <label>🔍 Buscar Medicamento</label>
              <input
                type="text"
                placeholder="Nombre, SKU, marca..."
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label>📁 Filtrar por Categoría</label>
              <select
                value={selectedCategoryId}
                onChange={(e) => setSelectedCategoryId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              >
                <option value="all">Todas las Categorías ({products.length})</option>
                {(categories ?? []).map((cat) => {
                  const allowedIds = getCategoryHierarchyIds(cat.id, categories ?? []);
                  const count = products.filter((p) => p.categoryId && allowedIds.includes(p.categoryId)).length;
                  return (
                    <option key={cat.id} value={cat.id}>
                      {cat.name} ({count})
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {(productSearch || selectedCategoryId !== 'all') && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              <span>Mostrando {filteredProducts.length} de {products.length} medicamentos</span>
              <button
                type="button"
                className="btn-secondary"
                style={{ padding: '0.2rem 0.6rem', fontSize: '0.78rem' }}
                onClick={() => {
                  setProductSearch('');
                  setSelectedCategoryId('all');
                }}
              >
                ✕ Limpiar búsqueda
              </button>
            </div>
          )}

          {/* Quick selection chips */}
          {filteredProducts.length > 0 && (productSearch || selectedCategoryId !== 'all') && (
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.75rem', maxHeight: '120px', overflowY: 'auto' }}>
              {filteredProducts.slice(0, 10).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSale((prev) => ({ ...prev, productId: p.id }))}
                  style={{
                    padding: '0.35rem 0.65rem',
                    borderRadius: 'var(--radius-sm)',
                    border: p.id === sale.productId ? '2px solid var(--primary)' : '1px solid var(--border)',
                    background: p.id === sale.productId ? 'var(--primary-light, #e6fffa)' : 'var(--surface)',
                    color: 'var(--text-main)',
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                    fontWeight: p.id === sale.productId ? 700 : 500
                  }}
                >
                  {p.name} · {money(p.price)}
                </button>
              ))}
            </div>
          )}

          <div className="form-field">
            <label>Medicamento Seleccionado</label>
            <select
              value={sale.productId}
              onChange={(e) => setSale({ ...sale, productId: Number(e.target.value) })}
            >
              {filteredProducts.length === 0 ? (
                <option value="">No hay medicamentos con los filtros actuales</option>
              ) : (
                filteredProducts.map((p) => {
                  const cat = (categories ?? []).find((c) => c.id === p.categoryId);
                  return (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku}) · {cat ? `[${cat.name}] · ` : ''}{money(p.price)} · Stock: {p.stock}
                    </option>
                  );
                })
              )}
            </select>
          </div>

          {selectedProd && (
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', padding: '0.75rem', background: 'var(--bg-subtle)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid var(--border)' }}
              onClick={() => setSelectedProductForModal(selectedProd)}
              title="Haz clic para ver especificaciones y ficha técnica completa"
            >
              <div className="cart-item-thumb" style={{ width: '48px', height: '48px' }}>
                {selectedProd.imageUrl ? (
                  <img src={selectedProd.imageUrl} alt={selectedProd.name} />
                ) : (
                  <span>💊</span>
                )}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <strong>{selectedProd.name}</strong>
                  <span style={{ fontSize: '0.74rem', color: 'var(--primary)', fontWeight: 700 }}>🔍 Ver Ficha</span>
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{selectedProd.brand} · {selectedProd.presentation}</p>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.2rem' }}>
                  <span style={{ color: 'var(--primary-dark)', fontWeight: 700 }}>{money(selectedProd.price)} c/u</span>
                  <span style={{ fontSize: '0.8rem', color: selectedProd.stock > 0 ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                    {selectedProd.stock} disponibles
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="form-field">
            <label>Cantidad</label>
            <input type="number" min="1" value={sale.quantity} onChange={(e) => setSale({ ...sale, quantity: Number(e.target.value) })} />
          </div>

          <button type="button" className="btn-primary" onClick={processSale}>
            Cobrar Venta Físico {selectedProd ? `(${money(selectedProd.price * sale.quantity)})` : ''}
          </button>
        </div>

        <div className="panel-card">
          <div className="panel-head">
            <h2>Órdenes para Retiro en Tienda</h2>
            <span className="pill-tag">{orders.length} pendientes</span>
          </div>
          <div className="item-list-stack">
            {orders.map((order) => (
              <div key={order.id} className="compact-list-row">
                <div>
                  <strong>{order.code}</strong>
                  <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{order.customer?.name ?? 'Cliente'}</p>
                  <small>{money(order.total)} · {order.status}</small>
                </div>
                <button type="button" className="btn-secondary" onClick={() => releaseOrder(order.id)}>
                  Liberar Entrega
                </button>
              </div>
            ))}
          </div>
          {status && <div className="checkout-status-msg">{status}</div>}
        </div>
      </div>

      {/* POS Product Detail Modal */}
      <ProductDetailModal
        product={selectedProductForModal}
        categories={categories ?? []}
        branchName={`Sucursal ${branchId}`}
        onClose={() => setSelectedProductForModal(null)}
        onAddToCart={(productId, quantity) => {
          setSale((prev) => ({ ...prev, productId, quantity }));
          setSelectedProductForModal(null);
        }}
        inCartQuantity={0}
      />
    </div>
  );
}

function WarehousePage({ token, categories: categoriesProp }: { token: string | null; categories?: Category[] }) {
  const [activeTab, setActiveTab] = useState<'new-product' | 'receive-lot' | 'products-list'>('new-product');
  const [lots, setLots] = useState<any[]>([]);
  const [products, setProducts] = useState<ProductCard[]>([]);
  const [categories, setCategories] = useState<Category[]>(categoriesProp ?? []);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [status, setStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedProductForModal, setSelectedProductForModal] = useState<ProductCard | null>(null);
  const [editingProduct, setEditingProduct] = useState<ProductCard | null>(null);
  const [editForm, setEditForm] = useState<Partial<ProductCard>>({});
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [editImagePreview, setEditImagePreview] = useState<string | null>(null);

  const [listSearch, setListSearch] = useState('');
  const [listCategoryId, setListCategoryId] = useState<number | 'all'>('all');
  const [listPrescriptionFilter, setListPrescriptionFilter] = useState<'all' | 'otc' | 'rx'>('all');
  const [lotProductSearch, setLotProductSearch] = useState('');
  const [lotProductCategoryId, setLotProductCategoryId] = useState<number | 'all'>('all');

  const filteredWarehouseProducts = products.filter((p) => {
    if (listPrescriptionFilter === 'otc' && p.requiresPrescription) return false;
    if (listPrescriptionFilter === 'rx' && !p.requiresPrescription) return false;
    if (listCategoryId !== 'all') {
      const allowedIds = getCategoryHierarchyIds(listCategoryId, categories);
      if (!p.categoryId || !allowedIds.includes(p.categoryId)) return false;
    }
    if (listSearch.trim()) {
      const q = listSearch.toLowerCase().trim();
      const cat = categories.find((c) => c.id === p.categoryId);
      const match = [p.name, p.sku, p.brand, p.laboratory, p.sanitaryRegistry ?? '', cat?.name ?? '', p.description].some(
        (f) => f.toLowerCase().includes(q)
      );
      if (!match) return false;
    }
    return true;
  });

  const availableLotProducts = products.filter((p) => {
    if (lotProductCategoryId !== 'all') {
      const allowedIds = getCategoryHierarchyIds(lotProductCategoryId, categories);
      if (!p.categoryId || !allowedIds.includes(p.categoryId)) return false;
    }
    if (lotProductSearch.trim()) {
      const q = lotProductSearch.toLowerCase().trim();
      const cat = categories.find((c) => c.id === p.categoryId);
      const match = [p.name, p.sku, p.brand, cat?.name ?? ''].some((f) => f.toLowerCase().includes(q));
      if (!match) return false;
    }
    return true;
  });

  // New Product Form State
  const [newProd, setNewProd] = useState({
    sku: 'SKU-AMOX-875',
    name: 'Amoxicilina + Ácido Clavulánico 875mg',
    categoryId: null as number | null,
    brand: 'Genfar',
    laboratory: 'Laboratorios Genfar S.A.',
    presentation: 'Caja x 14 tabletas recubiertas',
    unitMeasure: 'tableta',
    sanitaryRegistry: 'MSPAS-2026-9412',
    requiresPrescription: true,
    price: 165,
    cost: 110,
    description: 'Antibiótico bactericida de amplio espectro para infecciones respiratorias.',
    imageUrl: '',
    includeInitialStock: false,
    initialBranchId: 1,
    initialSupplierId: 1,
    initialBatchCode: 'LOT-2026-AMX8',
    initialExpirationDate: '2027-10-31',
    initialProductionDate: '2026-08-01',
    initialQuantity: 20
  });

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageMode, setImageMode] = useState<'file' | 'url'>('file');

  // Lot Reception Form State
  const [lotForm, setLotForm] = useState({
    branchId: 1,
    supplierId: 1,
    productId: 1,
    batchCode: 'LOT-2026-N1',
    expirationDate: '2027-06-30',
    productionDate: '2026-08-01',
    quantity: 20,
    costPrice: 20,
    salePrice: 35
  });

  async function loadAllData() {
    if (!token) return;
    try {
      const [lotsData, prodsData, catsData, suppsData, branchesData] = await Promise.all([
        apiRequest<any[]>(`/api/warehouse/lots?branchId=${lotForm.branchId}`, {}, token),
        apiRequest<ProductCard[]>('/api/warehouse/products', {}, token),
        apiRequest<Category[]>('/api/warehouse/categories', {}, token),
        apiRequest<Supplier[]>('/api/warehouse/suppliers', {}, token),
        apiRequest<Branch[]>('/api/public/branches')
      ]);
      setLots(lotsData);
      setProducts(prodsData);
      setCategories(catsData);
      setSuppliers(suppsData);
      setBranches(branchesData);
      if (prodsData.length > 0 && !lotForm.productId) {
        setLotForm((prev) => ({ ...prev, productId: prodsData[0].id }));
      }
    } catch (error) {
      console.error(error);
    }
  }

  useEffect(() => {
    loadAllData().catch((error) => setStatus(error.message));
  }, [token, lotForm.branchId]);

  function handleImageFile(file: File | null) {
    if (!file) {
      setImageFile(null);
      setImagePreview(null);
      return;
    }
    setImageFile(file);
    const url = URL.createObjectURL(file);
    setImagePreview(url);
  }

  function handleClearImage() {
    setImageFile(null);
    setImagePreview(null);
    setNewProd((prev) => ({ ...prev, imageUrl: '' }));
  }

  function autoGenerateSku() {
    const cleanName = newProd.name
      .trim()
      .split(' ')
      .slice(0, 2)
      .join('')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase();
    const randomNum = Math.floor(100 + Math.random() * 900);
    const generated = `SKU-${cleanName || 'MED'}-${randomNum}`;
    setNewProd((prev) => ({ ...prev, sku: generated }));
  }

  async function handleCreateProduct() {
    try {
      if (!newProd.name.trim()) throw new Error('El nombre del medicamento es requerido.');
      if (!newProd.sku.trim()) throw new Error('El código SKU es requerido.');

      setIsSubmitting(true);
      setStatus('Guardando medicamento y procesando imagen...');

      let finalImageUrl: string | null = newProd.imageUrl.trim() || null;

      // If user selected a local file, upload it
      if (imageFile) {
        const uploadRes = await uploadProductImage(imageFile, token);
        finalImageUrl = uploadRes.url;
      }

      const payload = {
        sku: newProd.sku,
        name: newProd.name,
        categoryId: newProd.categoryId,
        brand: newProd.brand,
        laboratory: newProd.laboratory,
        presentation: newProd.presentation,
        unitMeasure: newProd.unitMeasure,
        sanitaryRegistry: newProd.sanitaryRegistry,
        requiresPrescription: Boolean(newProd.requiresPrescription),
        price: Number(newProd.price),
        cost: Number(newProd.cost),
        description: newProd.description,
        imageUrl: finalImageUrl,
        initialStock: newProd.includeInitialStock
          ? {
              branchId: Number(newProd.initialBranchId),
              supplierId: Number(newProd.initialSupplierId),
              batchCode: newProd.initialBatchCode,
              expirationDate: newProd.initialExpirationDate,
              productionDate: newProd.initialProductionDate,
              quantity: Number(newProd.initialQuantity)
            }
          : null
      };

      await apiRequest('/api/warehouse/products', {
        method: 'POST',
        body: JSON.stringify(payload)
      }, token);

      setStatus(`✅ ¡Medicamento "${newProd.name}" registrado exitosamente con su imagen!`);
      handleClearImage();
      // Generate next random SKU
      setNewProd((prev) => ({
        ...prev,
        sku: `SKU-MED-${Math.floor(100 + Math.random() * 900)}`,
        name: '',
        description: '',
        initialBatchCode: `LOT-${Date.now().toString().slice(-4)}`
      }));
      loadAllData();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Error al registrar medicamento');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function receiveLot() {
    try {
      setIsSubmitting(true);
      await apiRequest('/api/warehouse/receive', {
        method: 'POST',
        body: JSON.stringify(lotForm)
      }, token);
      setStatus('✅ Lote recibido y registrado en bodega.');
      loadAllData();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Error al registrar lote');
    } finally {
      setIsSubmitting(false);
    }
  }

  function startEditingProduct(product: ProductCard) {
    setEditingProduct(product);
    setEditForm({ ...product });
    setEditImageFile(null);
    setEditImagePreview(product.imageUrl ?? null);
  }

  async function saveProductChanges() {
    if (!editingProduct || !token) return;
    try {
      let imageUrl = editForm.imageUrl ?? null;
      if (editImageFile) {
        const uploadRes = await uploadProductImage(editImageFile, token);
        imageUrl = uploadRes.url;
      }
      await apiRequest(`/api/warehouse/products/${editingProduct.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          sku: editForm.sku,
          name: editForm.name,
          categoryId: editForm.categoryId ? Number(editForm.categoryId) : null,
          brand: editForm.brand ?? '',
          laboratory: editForm.laboratory ?? '',
          presentation: editForm.presentation ?? '',
          unitMeasure: editForm.unitMeasure ?? '',
          sanitaryRegistry: editForm.sanitaryRegistry ?? '',
          requiresPrescription: Boolean(editForm.requiresPrescription),
          description: editForm.description ?? '',
          price: Number(editForm.price),
          cost: Number(editForm.cost),
          imageUrl
        })
      }, token);
      setStatus('Producto actualizado correctamente.');
      setEditingProduct(null);
      setEditImageFile(null);
      setEditImagePreview(null);
      await loadAllData();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'No se pudo actualizar el producto');
    }
  }

  async function removeProduct(product: ProductCard) {
    if (!token || !window.confirm(`¿Deseas eliminar "${product.name}"?`)) return;
    try {
      await apiRequest(`/api/warehouse/products/${product.id}`, { method: 'DELETE' }, token);
      setStatus('Producto eliminado del catálogo.');
      await loadAllData();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'No se pudo eliminar el producto');
    }
  }

  const selectedProduct = products.find((p) => p.id === lotForm.productId);

  return (
    <div className="internal-page-container">
      {/* Tab Navigation Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div className="section-tabs-bar">
          <button
            type="button"
            className={`section-tab-btn ${activeTab === 'new-product' ? 'active' : ''}`}
            onClick={() => setActiveTab('new-product')}
          >
            <span>📦 Registrar Nuevo Medicamento con Foto</span>
          </button>
          <button
            type="button"
            className={`section-tab-btn ${activeTab === 'receive-lot' ? 'active' : ''}`}
            onClick={() => setActiveTab('receive-lot')}
          >
            <span>📥 Recepción de Lotes Existentes</span>
          </button>
          <button
            type="button"
            className={`section-tab-btn ${activeTab === 'products-list' ? 'active' : ''}`}
            onClick={() => setActiveTab('products-list')}
          >
            <span>📋 Catálogo ({products.length} productos)</span>
          </button>
        </div>

        {status && <div className="checkout-status-msg" style={{ margin: 0 }}>{status}</div>}
      </div>

      {/* TAB 1: REGISTRAR NUEVO MEDICAMENTO CON IMAGEN */}
      {activeTab === 'new-product' && (
        <div className="two-col-grid">
          {/* Left Column: Product Information */}
          <div className="panel-card">
            <div className="panel-head">
              <h2>Información del Medicamento</h2>
              <span className="pill-tag">Alta de Producto</span>
            </div>

            <div className="form-grid-2">
              <div className="form-field">
                <label>Nombre Comercial *</label>
                <input
                  type="text"
                  value={newProd.name}
                  onChange={(e) => setNewProd({ ...newProd, name: e.target.value })}
                  placeholder="Ej. Amoxicilina 500mg"
                />
              </div>
              <div className="form-field">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <label>Código SKU *</label>
                  <button
                    type="button"
                    onClick={autoGenerateSku}
                    style={{ background: 'none', border: 'none', color: 'var(--primary)', fontSize: '0.74rem', cursor: 'pointer', fontWeight: 700 }}
                  >
                    ⚡ Generar
                  </button>
                </div>
                <input
                  type="text"
                  value={newProd.sku}
                  onChange={(e) => setNewProd({ ...newProd, sku: e.target.value })}
                  placeholder="SKU-XXXX-000"
                />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-field">
                <label>Categoría</label>
                <select
                  value={newProd.categoryId ?? ''}
                  onChange={(e) => setNewProd({ ...newProd, categoryId: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">Sin categoría</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label>Marca Comercial</label>
                <input
                  type="text"
                  value={newProd.brand}
                  onChange={(e) => setNewProd({ ...newProd, brand: e.target.value })}
                  placeholder="Ej. Genfar, MK, Bayer"
                />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-field">
                <label>Laboratorio Fabricante</label>
                <input
                  type="text"
                  value={newProd.laboratory}
                  onChange={(e) => setNewProd({ ...newProd, laboratory: e.target.value })}
                  placeholder="Ej. Laboratorios Genfar S.A."
                />
              </div>
              <div className="form-field">
                <label>Presentación</label>
                <input
                  type="text"
                  value={newProd.presentation}
                  onChange={(e) => setNewProd({ ...newProd, presentation: e.target.value })}
                  placeholder="Ej. Caja x 20 tabletas, Frasco 120ml"
                />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-field">
                <label>Unidad de Medida</label>
                <input
                  type="text"
                  value={newProd.unitMeasure}
                  onChange={(e) => setNewProd({ ...newProd, unitMeasure: e.target.value })}
                  placeholder="Ej. tableta, frasco, ampolla"
                />
              </div>
              <div className="form-field">
                <label>Registro Sanitario MSPAS</label>
                <input
                  type="text"
                  value={newProd.sanitaryRegistry}
                  onChange={(e) => setNewProd({ ...newProd, sanitaryRegistry: e.target.value })}
                  placeholder="MSPAS-2026-XXXX"
                />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-field">
                <label>Precio de Venta al Público (Q) *</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={newProd.price}
                  onChange={(e) => setNewProd({ ...newProd, price: Number(e.target.value) })}
                />
              </div>
              <div className="form-field">
                <label>Costo de Adquisición (Q) *</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={newProd.cost}
                  onChange={(e) => setNewProd({ ...newProd, cost: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="form-field">
              <label>Descripción y Uso Terapéutico</label>
              <textarea
                rows={2}
                value={newProd.description}
                onChange={(e) => setNewProd({ ...newProd, description: e.target.value })}
                placeholder="Descripción, indicaciones terapéuticas, precauciones..."
              />
            </div>

            {/* Requires Prescription Switch */}
            <div className="form-field">
              <label className="checkbox-inline-label">
                <input
                  type="checkbox"
                  checked={newProd.requiresPrescription}
                  onChange={(e) => setNewProd({ ...newProd, requiresPrescription: e.target.checked })}
                />
                <span>📋 Requiere Receta Médica Retenida (Control Sanitario MSPAS)</span>
              </label>
            </div>

            {/* Optional Initial Stock */}
            <div style={{ marginTop: '0.5rem', borderTop: '1px solid var(--border-light)', paddingTop: '0.85rem' }}>
              <label className="checkbox-inline-label" style={{ marginBottom: '0.75rem' }}>
                <input
                  type="checkbox"
                  checked={newProd.includeInitialStock}
                  onChange={(e) => setNewProd({ ...newProd, includeInitialStock: e.target.checked })}
                />
                <strong>Ingresar Lote / Stock Inicial en Bodega</strong>
              </label>

              {newProd.includeInitialStock && (
                <div className="form-grid-2" style={{ background: 'var(--bg-subtle)', padding: '0.85rem', borderRadius: 'var(--radius-sm)' }}>
                  <div className="form-field">
                    <label>Sucursal Destino</label>
                    <select
                      value={newProd.initialBranchId}
                      onChange={(e) => setNewProd({ ...newProd, initialBranchId: Number(e.target.value) })}
                    >
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({b.city})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-field">
                    <label>Proveedor</label>
                    <select
                      value={newProd.initialSupplierId}
                      onChange={(e) => setNewProd({ ...newProd, initialSupplierId: Number(e.target.value) })}
                    >
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-field">
                    <label>Código de Lote</label>
                    <input
                      type="text"
                      value={newProd.initialBatchCode}
                      onChange={(e) => setNewProd({ ...newProd, initialBatchCode: e.target.value })}
                    />
                  </div>
                  <div className="form-field">
                    <label>Cantidad Inicial</label>
                    <input
                      type="number"
                      min="1"
                      value={newProd.initialQuantity}
                      onChange={(e) => setNewProd({ ...newProd, initialQuantity: Number(e.target.value) })}
                    />
                  </div>
                  <div className="form-field">
                    <label>Fecha Vencimiento</label>
                    <input
                      type="date"
                      value={newProd.initialExpirationDate}
                      onChange={(e) => setNewProd({ ...newProd, initialExpirationDate: e.target.value })}
                    />
                  </div>
                  <div className="form-field">
                    <label>Fecha Fabricación</label>
                    <input
                      type="date"
                      value={newProd.initialProductionDate}
                      onChange={(e) => setNewProd({ ...newProd, initialProductionDate: e.target.value })}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Image Upload & Preview */}
          <div className="panel-card">
            <div className="panel-head">
              <h2>Fotografía / Imagen del Medicamento</h2>
              <span className="pill-tag">Multimedia</span>
            </div>

            {/* Mode selector */}
            <div className="delivery-toggle-group">
              <button
                type="button"
                className={`delivery-toggle-btn ${imageMode === 'file' ? 'active' : ''}`}
                onClick={() => setImageMode('file')}
              >
                📁 Subir Archivo desde PC
              </button>
              <button
                type="button"
                className={`delivery-toggle-btn ${imageMode === 'url' ? 'active' : ''}`}
                onClick={() => setImageMode('url')}
              >
                🔗 Enlace / URL Web
              </button>
            </div>

            {/* File Upload Dropzone */}
            {imageMode === 'file' && (
              <div className="image-upload-card">
                <label className="image-drop-area">
                  <div className="image-drop-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                  </div>
                  <div className="image-drop-text">
                    <strong>{imageFile ? imageFile.name : 'Haz clic o arrastra la foto del medicamento aquí'}</strong>
                    <span>Formatos admitidos: PNG, JPG, JPEG, WEBP</span>
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleImageFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
            )}

            {/* URL Input */}
            {imageMode === 'url' && (
              <div className="form-field">
                <label>URL de la Imagen (HTTPS)</label>
                <input
                  type="url"
                  value={newProd.imageUrl}
                  onChange={(e) => {
                    setNewProd({ ...newProd, imageUrl: e.target.value });
                    setImagePreview(e.target.value);
                  }}
                  placeholder="https://ejemplo.com/fotos/medicamento.jpg"
                />
              </div>
            )}

            {/* Live Image Preview */}
            <div className="form-field">
              <label>Vista Previa de la Imagen</label>
              <div className="image-preview-box">
                {imagePreview || newProd.imageUrl ? (
                  <>
                    <img
                      src={imagePreview || newProd.imageUrl}
                      alt="Vista previa medicamento"
                      className="image-preview-img"
                      onError={() => setStatus('⚠️ No se pudo cargar la imagen desde la URL especificada.')}
                    />
                    <button
                      type="button"
                      className="remove-img-btn"
                      onClick={handleClearImage}
                      title="Quitar imagen"
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <div style={{ textAlign: 'center', color: 'var(--text-light)' }}>
                    <p style={{ fontSize: '1.8rem', marginBottom: '0.25rem' }}>📷</p>
                    <span style={{ fontSize: '0.84rem' }}>Sin imagen seleccionada (se usará diseño estándar)</span>
                  </div>
                )}
              </div>
            </div>

            {/* Live Product Card Mockup */}
            <div className="form-field">
              <label>Simulación en Catálogo Público</label>
              <div style={{ background: 'var(--bg-page)', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                <div style={{ maxWidth: '300px', margin: '0 auto' }}>
                  <article className="product-card" style={{ padding: '0.9rem' }}>
                    <div className="product-image-wrap" style={{ height: '140px' }}>
                      {imagePreview || newProd.imageUrl ? (
                        <img
                          src={imagePreview || newProd.imageUrl}
                          alt={newProd.name}
                          className="product-card-img"
                        />
                      ) : (
                        <div className="product-img-fallback">
                          <span>💊 Derkas</span>
                        </div>
                      )}
                      <div className="product-card-badges-overlay">
                        <span className="badge-sku">{newProd.sku || 'SKU-000'}</span>
                        <span className={`badge-prescription ${newProd.requiresPrescription ? 'rx' : 'otc'}`}>
                          {newProd.requiresPrescription ? '📋 Con Receta' : '🟢 Venta Libre'}
                        </span>
                      </div>
                    </div>
                    <div>
                      <span className="product-brand" style={{ fontSize: '0.74rem' }}>{newProd.brand || 'Marca'}</span>
                      <h4 style={{ fontSize: '0.95rem', fontWeight: 700, margin: '0.2rem 0' }}>{newProd.name || 'Nombre del Medicamento'}</h4>
                      <p className="product-desc" style={{ fontSize: '0.78rem' }}>{newProd.description || 'Descripción del producto...'}</p>
                    </div>
                    <div className="product-price-row" style={{ marginTop: '0.5rem' }}>
                      <strong className="product-price" style={{ fontSize: '1.15rem' }}>{money(newProd.price || 0)}</strong>
                      <span style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 700 }}>
                        {newProd.includeInitialStock ? `${newProd.initialQuantity} en stock` : 'Sin stock'}
                      </span>
                    </div>
                  </article>
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="button"
              className="btn-primary"
              disabled={isSubmitting}
              onClick={handleCreateProduct}
              style={{ width: '100%', padding: '0.95rem', fontSize: '1.02rem', marginTop: '0.5rem' }}
            >
              {isSubmitting ? 'Guardando...' : '✨ Guardar y Publicar Medicamento con Foto'}
            </button>
          </div>
        </div>
      )}

      {/* TAB 2: RECEPCION DE LOTES EXISTENTES */}
      {activeTab === 'receive-lot' && (
        <div className="two-col-grid">
          <div className="panel-card">
            <div className="panel-head">
              <h2>Recepción de Lotes para Medicamentos Existentes</h2>
              <span className="pill-tag">Ingreso PEPS</span>
            </div>

            {/* Product Selector with Search & Category */}
            <div className="form-grid-2" style={{ marginBottom: '0.4rem' }}>
              <div className="form-field">
                <label>🔍 Buscar Medicamento</label>
                <input
                  type="text"
                  placeholder="Nombre o SKU..."
                  value={lotProductSearch}
                  onChange={(e) => setLotProductSearch(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label>📁 Filtrar por Categoría</label>
                <select
                  value={lotProductCategoryId}
                  onChange={(e) => setLotProductCategoryId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                >
                  <option value="all">Todas las Categorías ({products.length})</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-field">
              <label>Seleccionar Medicamento * ({availableLotProducts.length} encontrados)</label>
              <select
                value={lotForm.productId}
                onChange={(e) => {
                  const pId = Number(e.target.value);
                  const prod = products.find((p) => p.id === pId);
                  setLotForm({
                    ...lotForm,
                    productId: pId,
                    costPrice: prod?.cost ?? lotForm.costPrice,
                    salePrice: prod?.price ?? lotForm.salePrice
                  });
                }}
              >
                {availableLotProducts.length === 0 ? (
                  <option value="">No hay medicamentos con los filtros actuales</option>
                ) : (
                  availableLotProducts.map((p) => {
                    const cat = categories.find((c) => c.id === p.categoryId);
                    return (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.sku}) · {cat ? `[${cat.name}] · ` : ''}{money(p.price)}
                      </option>
                    );
                  })
                )}
              </select>
            </div>

            {selectedProduct && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', padding: '0.75rem', background: 'var(--bg-subtle)', borderRadius: 'var(--radius-sm)' }}>
                <div className="cart-item-thumb" style={{ width: '56px', height: '56px' }}>
                  {selectedProduct.imageUrl ? (
                    <img src={selectedProduct.imageUrl} alt={selectedProduct.name} />
                  ) : (
                    <span>💊</span>
                  )}
                </div>
                <div>
                  <strong>{selectedProduct.name}</strong>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{selectedProduct.brand} · {selectedProduct.presentation}</p>
                  <small style={{ color: 'var(--primary-dark)', fontWeight: 700 }}>Precio actual: {money(selectedProduct.price)}</small>
                </div>
              </div>
            )}

            <div className="form-grid-2">
              <div className="form-field">
                <label>Sucursal Destino</label>
                <select
                  value={lotForm.branchId}
                  onChange={(e) => setLotForm({ ...lotForm, branchId: Number(e.target.value) })}
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.city})
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label>Proveedor</label>
                <select
                  value={lotForm.supplierId}
                  onChange={(e) => setLotForm({ ...lotForm, supplierId: Number(e.target.value) })}
                >
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-field">
                <label>Código de Lote *</label>
                <input
                  type="text"
                  value={lotForm.batchCode}
                  onChange={(e) => setLotForm({ ...lotForm, batchCode: e.target.value })}
                />
              </div>
              <div className="form-field">
                <label>Cantidad de Unidades *</label>
                <input
                  type="number"
                  min="1"
                  value={lotForm.quantity}
                  onChange={(e) => setLotForm({ ...lotForm, quantity: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-field">
                <label>Costo Unitario (Q)</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={lotForm.costPrice}
                  onChange={(e) => setLotForm({ ...lotForm, costPrice: Number(e.target.value) })}
                />
              </div>
              <div className="form-field">
                <label>Precio Venta al Público (Q)</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={lotForm.salePrice}
                  onChange={(e) => setLotForm({ ...lotForm, salePrice: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-field">
                <label>Fecha de Fabricación</label>
                <input
                  type="date"
                  value={lotForm.productionDate}
                  onChange={(e) => setLotForm({ ...lotForm, productionDate: e.target.value })}
                />
              </div>
              <div className="form-field">
                <label>Fecha de Vencimiento *</label>
                <input
                  type="date"
                  value={lotForm.expirationDate}
                  onChange={(e) => setLotForm({ ...lotForm, expirationDate: e.target.value })}
                />
              </div>
            </div>

            <button
              type="button"
              className="btn-primary"
              disabled={isSubmitting}
              onClick={receiveLot}
              style={{ width: '100%', padding: '0.85rem', marginTop: '0.5rem' }}
            >
              {isSubmitting ? 'Procesando...' : '📥 Registrar Ingreso de Lote'}
            </button>
          </div>

          <div className="panel-card">
            <div className="panel-head">
              <h2>Lotes en Existencia</h2>
              <span className="pill-tag">{lots.length} lotes en inventario</span>
            </div>
            <div className="item-list-stack">
              {lots.map((lot) => {
                const prod = products.find((p) => p.id === lot.productId);
                return (
                  <div key={lot.id} className="compact-list-row">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div className="cart-item-thumb" style={{ width: '42px', height: '42px' }}>
                        {prod?.imageUrl ? (
                          <img src={prod.imageUrl} alt={prod.name} />
                        ) : (
                          <span>💊</span>
                        )}
                      </div>
                      <div>
                        <strong>{lot.batchCode}</strong>
                        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                          {prod?.name ?? `Prod #${lot.productId}`} · Sucursal #{lot.branchId}
                        </p>
                        <small>{lot.quantityAvailable} uds · Vence: {lot.expirationDate} · PVP: {money(lot.salePrice)}</small>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: LISTA DE PRODUCTOS REGISTRADOS CON FOTO */}
      {activeTab === 'products-list' && (
        <div className="panel-card">
          <div className="panel-head">
            <h2>Medicamentos Registrados en el Sistema</h2>
            <button
              type="button"
              className="btn-primary"
              onClick={() => setActiveTab('new-product')}
            >
              + Registrar Nuevo Medicamento
            </button>
          </div>

          {/* Search & Category Filter Controls */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1rem' }}>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: '240px' }}>
                <input
                  type="text"
                  placeholder="🔍 Buscar por nombre, SKU, marca, laboratorio o registro sanitario..."
                  value={listSearch}
                  onChange={(e) => setListSearch(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.85rem',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    fontSize: '0.9rem'
                  }}
                />
              </div>
              <div style={{ minWidth: '220px' }}>
                <select
                  value={listCategoryId}
                  onChange={(e) => setListCategoryId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.85rem',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    fontSize: '0.9rem'
                  }}
                >
                  <option value="all">📁 Todas las Categorías ({products.length})</option>
                  {categories.map((cat) => {
                    const allowedIds = getCategoryHierarchyIds(cat.id, categories);
                    const count = products.filter((p) => p.categoryId && allowedIds.includes(p.categoryId)).length;
                    return (
                      <option key={cat.id} value={cat.id}>
                        {cat.name} ({count})
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            {/* Category pills for quick click */}
            {categories.length > 0 && (
              <div className="filter-pills-row" style={{ marginTop: '0.2rem' }}>
                <button
                  type="button"
                  className={`filter-pill-btn ${listCategoryId === 'all' ? 'active' : ''}`}
                  onClick={() => setListCategoryId('all')}
                >
                  <span>Todas ({products.length})</span>
                </button>
                {categories.map((cat) => {
                  const allowedIds = getCategoryHierarchyIds(cat.id, categories);
                  const count = products.filter((p) => p.categoryId && allowedIds.includes(p.categoryId)).length;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      className={`filter-pill-btn ${listCategoryId === cat.id ? 'active' : ''}`}
                      onClick={() => setListCategoryId(listCategoryId === cat.id ? 'all' : cat.id)}
                    >
                      <span>{cat.name}</span>
                      <span className="filter-pill-count">{count}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Prescription filter & count & clear */}
            <div className="filter-pills-row">
              <button
                type="button"
                className={`filter-pill-btn ${listPrescriptionFilter === 'all' ? 'active' : ''}`}
                onClick={() => setListPrescriptionFilter('all')}
              >
                <span>Todos</span>
              </button>
              <button
                type="button"
                className={`filter-pill-btn ${listPrescriptionFilter === 'otc' ? 'active' : ''}`}
                onClick={() => setListPrescriptionFilter('otc')}
              >
                <span>🟢 Venta Libre</span>
              </button>
              <button
                type="button"
                className={`filter-pill-btn ${listPrescriptionFilter === 'rx' ? 'active' : ''}`}
                onClick={() => setListPrescriptionFilter('rx')}
              >
                <span>📋 Con Receta</span>
              </button>

              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                Mostrando {filteredWarehouseProducts.length} de {products.length} medicamentos
              </span>

              {(listSearch || listCategoryId !== 'all' || listPrescriptionFilter !== 'all') && (
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem', marginLeft: 'auto', borderRadius: 'var(--radius-full)' }}
                  onClick={() => {
                    setListSearch('');
                    setListCategoryId('all');
                    setListPrescriptionFilter('all');
                  }}
                >
                  ✕ Limpiar Filtros
                </button>
              )}
            </div>
          </div>

          {filteredWarehouseProducts.length === 0 ? (
            <div className="catalog-empty-state" style={{ marginTop: '1.5rem' }}>
              <h3>No se encontraron medicamentos</h3>
              <p>No hay medicamentos que coincidan con la búsqueda o categoría seleccionada.</p>
              <button
                type="button"
                className="btn-secondary"
                style={{ marginTop: '0.75rem' }}
                onClick={() => {
                  setListSearch('');
                  setListCategoryId('all');
                  setListPrescriptionFilter('all');
                }}
              >
                Limpiar Filtros
              </button>
            </div>
          ) : (
            <div className="products-grid" style={{ marginTop: '1rem' }}>
              {filteredWarehouseProducts.map((p) => {
                const cat = categories.find((c) => c.id === p.categoryId);
                return (
                  <article
                    key={p.id}
                    className="product-card product-card-clickable"
                    style={{ padding: '1rem' }}
                    onClick={() => setSelectedProductForModal(p)}
                    title="Haz clic para ver especificaciones y detalles completos"
                  >
                    <div className="product-image-wrap" style={{ height: '160px' }}>
                      {p.imageUrl ? (
                        <img src={p.imageUrl} alt={p.name} className="product-card-img" />
                      ) : (
                        <div className="product-img-fallback">
                          <span>💊 {p.brand}</span>
                        </div>
                      )}
                      <div className="product-card-badges-overlay">
                        <span className="badge-sku">{p.sku}</span>
                        {cat && (
                          <span
                            className="badge-sku"
                            style={{ background: 'rgba(15, 23, 42, 0.75)', cursor: 'pointer' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setListCategoryId(cat.id);
                            }}
                            title={`Filtrar por ${cat.name}`}
                          >
                            📁 {cat.name}
                          </span>
                        )}
                        <span className={`badge-prescription ${p.requiresPrescription ? 'rx' : 'otc'}`}>
                          {p.requiresPrescription ? '📋 Con Receta' : '🟢 Venta Libre'}
                        </span>
                      </div>
                    </div>

                    <div className="product-content">
                      <span className="product-brand">
                        {cat ? `${cat.name} · ` : ''}{p.brand} · {p.laboratory}
                      </span>
                      <h3 className="product-name" style={{ fontSize: '1.05rem' }}>{p.name}</h3>
                      <span className="product-presentation">{p.presentation}</span>
                      <p className="product-desc">{p.description}</p>
                      <span className="quick-view-badge">
                        🔍 Ver ficha técnica y especificaciones
                      </span>
                    </div>

                    <div className="product-footer" style={{ marginTop: '0.5rem' }}>
                      <div className="product-price-row">
                        <span className="product-price">{money(p.price)}</span>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Costo: {money(p.cost ?? 0)}</span>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.65rem' }} onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="btn-secondary" onClick={() => startEditingProduct(p)}>Editar</button>
                        <button type="button" className="btn-secondary" onClick={() => removeProduct(p)}>Eliminar</button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {editingProduct && (
            <div className="modal-backdrop" onClick={() => setEditingProduct(null)}>
              <div className="product-detail-modal" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="modal-close-btn" onClick={() => setEditingProduct(null)} title="Cerrar">✕</button>
                <h2 className="modal-title">Editar medicamento</h2>
                <div className="form-grid-2">
                  {([
                    { key: 'name', label: 'Nombre comercial' },
                    { key: 'sku', label: 'Código SKU' },
                    { key: 'brand', label: 'Marca' },
                    { key: 'laboratory', label: 'Laboratorio' },
                    { key: 'presentation', label: 'Presentación' },
                    { key: 'unitMeasure', label: 'Unidad de medida' },
                    { key: 'sanitaryRegistry', label: 'Registro Sanitario' }
                  ] as const).map(({ key, label }) => (
                    <div className="form-field" key={key}>
                      <label>{label}</label>
                      <input value={String(editForm[key] ?? '')} onChange={(e) => setEditForm({ ...editForm, [key]: e.target.value })} />
                    </div>
                  ))}
                  <div className="form-field">
                    <label>Categoría</label>
                    <select value={editForm.categoryId ?? ''} onChange={(e) => setEditForm({ ...editForm, categoryId: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">Sin categoría</option>
                      {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                    </select>
                  </div>
                  <div className="form-field"><label>Precio</label><input type="number" min="0.01" step="0.01" value={Number(editForm.price ?? 0)} onChange={(e) => setEditForm({ ...editForm, price: Number(e.target.value) })} /></div>
                  <div className="form-field"><label>Costo</label><input type="number" min="0.01" step="0.01" value={Number(editForm.cost ?? 0)} onChange={(e) => setEditForm({ ...editForm, cost: Number(e.target.value) })} /></div>
                </div>
                <div className="form-field"><label>Descripción</label><textarea rows={3} value={String(editForm.description ?? '')} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} /></div>
                <label className="checkbox-inline-label"><input type="checkbox" checked={Boolean(editForm.requiresPrescription)} onChange={(e) => setEditForm({ ...editForm, requiresPrescription: e.target.checked })} /> Requiere receta</label>
                <div className="form-field">
                  <label>Fotografía del medicamento</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      setEditImageFile(file);
                      setEditImagePreview(file ? URL.createObjectURL(file) : editingProduct.imageUrl ?? null);
                    }}
                  />
                  {editImagePreview && <img src={editImagePreview} alt="Vista previa" className="image-preview-img" style={{ maxHeight: '160px', marginTop: '0.5rem' }} />}
                </div>
                <button type="button" className="btn-primary" onClick={saveProductChanges}>Guardar cambios</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Warehouse Product Detail Modal */}
      <ProductDetailModal
        product={selectedProductForModal}
        categories={categories}
        branchName="Inventario de Bodega"
        onClose={() => setSelectedProductForModal(null)}
        onAddToCart={() => {
          setSelectedProductForModal(null);
        }}
        inCartQuantity={0}
      />
    </div>
  );
}


function RouteMap({ origin, destination }: { origin: string; destination: string }) {
  const mapElement = useRef<HTMLDivElement | null>(null);
  const [mapStatus, setMapStatus] = useState('Calculando ruta...');

  useEffect(() => {
    let map: L.Map | null = null;
    let cancelled = false;

    async function loadMap() {
      try {
        const geocode = async (address: string) => {
          const cleanedAddress = address.replace(/\s+/g, ' ').trim();
          const withoutHouseNumber = cleanedAddress
            .replace(/,?\s*(casa|casa no\.?|#)\s*[^,]+/i, '')
            .replace(/,\s*$/, '')
            .trim();
          const municipalityMatch = cleanedAddress.match(/(Jocotenango|Antigua Guatemala|Ciudad Vieja|Pastores|San Lucas Sacatepequez|Santa Maria de Jesus)/i);
          const municipality = municipalityMatch?.[1] ?? 'Sacatepequez';
          const street = withoutHouseNumber.split(',')[0].trim();
          const queries = Array.from(new Set([
            `${cleanedAddress}, Sacatepequez, Guatemala`,
            `${withoutHouseNumber}, ${municipality}, Sacatepequez, Guatemala`,
            `${street}, ${municipality}, Sacatepequez, Guatemala`,
            `${municipality}, Sacatepequez, Guatemala`
          ].filter(Boolean)));

          for (const query of queries) {
            const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=gt&q=${encodeURIComponent(query)}`);
            if (!response.ok) continue;
            const results = await response.json() as Array<{ lat: string; lon: string }>;
            if (results[0]) {
              return { lat: Number(results[0].lat), lon: Number(results[0].lon), approximate: query !== queries[0] };
            }
          }

          throw new Error(`No se encontró una ubicación para: ${address}`);
        };

        const [start, end] = await Promise.all([geocode(`${origin}, Sacatepéquez, Guatemala`), geocode(`${destination}, Sacatepéquez, Guatemala`)]);
        if (cancelled || !mapElement.current) return;

        map = L.map(mapElement.current).setView([end.lat, end.lon], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);
        L.circleMarker([start.lat, start.lon], { radius: 8, color: '#0f766e', fillColor: '#14b8a6', fillOpacity: 1 }).addTo(map).bindPopup('Sucursal de salida');
        L.circleMarker([end.lat, end.lon], { radius: 8, color: '#b91c1c', fillColor: '#ef4444', fillOpacity: 1 }).addTo(map).bindPopup(end.approximate ? 'Ubicación aproximada de entrega' : 'Dirección de entrega');

        const routeResponse = await fetch(`https://router.project-osrm.org/route/v1/driving/${start.lon},${start.lat};${end.lon},${end.lat}?overview=full&geometries=geojson`);
        if (!routeResponse.ok) throw new Error('No se pudo calcular la ruta');
        const routeData = await routeResponse.json() as { routes?: Array<{ geometry: { coordinates: [number, number][] } }> };
        const coordinates = routeData.routes?.[0]?.geometry.coordinates;
        if (!coordinates?.length) throw new Error('No se encontró una ruta para la dirección');
        const line = L.polyline(coordinates.map(([lon, lat]) => [lat, lon] as [number, number]), { color: '#2563eb', weight: 5 }).addTo(map);
        map.fitBounds(line.getBounds(), { padding: [24, 24] });
        setMapStatus(start.approximate || end.approximate
          ? 'Ruta aproximada calculada. El número de casa no está registrado en el mapa.'
          : 'Ruta calculada dentro de la aplicación');
      } catch (error) {
        if (!cancelled) setMapStatus(error instanceof Error ? error.message : 'No se pudo cargar la ruta');
      }
    }

    loadMap();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [origin, destination]);

  return (
    <div>
      <div ref={mapElement} style={{ width: '100%', height: '360px', borderRadius: '8px', overflow: 'hidden', marginTop: '0.75rem' }} />
      <p className="checkout-status-msg" style={{ marginTop: '0.5rem' }}>{mapStatus}</p>
    </div>
  );
}

function DeliveryPage({ token }: { token: string | null }) {
  const [orders, setOrders] = useState<any[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [status, setStatus] = useState('');
  const [recipe, setRecipe] = useState<File | null>(null);
  const [orderId, setOrderId] = useState('');

  async function loadRoute() {
    if (!token) return;
    const data = await apiRequest<any[]>(`/api/pos/deliveries?branchId=1`, {}, token);
    setOrders(data);
  }

  useEffect(() => {
    loadRoute().catch((error) => setStatus(error.message));
  }, [token]);

  async function uploadProof() {
    try {
      if (!recipe) throw new Error('Selecciona la foto de la receta entregada');
      const result = await uploadPrescription(recipe, Number(orderId), 'delivery', token);
      setStatus(`Evidencia subida correctamente: ${result.url}`);
      loadRoute();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Error al subir evidencia');
    }
  }

  async function updateDeliveryLocation(orderId: number, nextStatus = 'IN_ROUTE') {
    if (!token || !navigator.geolocation) {
      setStatus('Este dispositivo no permite compartir ubicación');
      return;
    }
    navigator.geolocation.getCurrentPosition(async (position) => {
      try {
        await apiRequest(`/api/pos/deliveries/${orderId}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: nextStatus, latitude: position.coords.latitude, longitude: position.coords.longitude })
        }, token);
        setStatus(nextStatus === 'DELIVERED' ? 'Entrega marcada como completada.' : 'Ubicación compartida. El cliente ya puede verla.');
        await loadRoute();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'No se pudo actualizar la entrega');
      }
    }, () => setStatus('Debes permitir la ubicación para iniciar la entrega'));
  }

  return (
    <div className="internal-page-container">
      <div className="two-col-grid">
        <div className="panel-card">
          <div className="panel-head">
            <h2>Hoja de Ruta de Reparto</h2>
            <span className="pill-tag">{orders.length} entregas</span>
          </div>
          <div className="item-list-stack">
            {orders.map((order, idx) => (
              <button key={order.id} type="button" className="route-row" onClick={() => setSelectedOrder(order)} style={{ width: '100%', textAlign: 'left', border: 0, cursor: 'pointer' }}>
                <div className="route-num">{idx + 1}</div>
                <div>
                  <strong>{order.code}</strong>
                  <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{order.customer?.name ?? 'Cliente'} · {order.branch?.name}</p>
                  <small>{order.address || 'Sin dirección registrada'}</small>
                  <small>{money(order.total)} · {order.status}</small>
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }} onClick={(event) => event.stopPropagation()}>
                    <button type="button" className="btn-secondary" onClick={() => updateDeliveryLocation(order.id)}>Iniciar / actualizar ruta</button>
                    <button type="button" className="btn-secondary" onClick={() => updateDeliveryLocation(order.id, 'DELIVERED')}>Marcar entregado</button>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {selectedOrder && (
          <div className="panel-card">
            <div className="panel-head">
              <h2>Ruta de entrega {selectedOrder.code}</h2>
              <button type="button" className="btn-secondary" onClick={() => setSelectedOrder(null)}>Cerrar</button>
            </div>
            <p><strong>Sale de:</strong> {selectedOrder.branch?.name ?? 'Sucursal asignada'}</p>
            <p><strong>Dirección:</strong> {selectedOrder.address || 'No registrada'}</p>
            {selectedOrder.address ? (
              <>
                <RouteMap
                  origin={selectedOrder.branch?.address || selectedOrder.branch?.name || 'Sacatepéquez'}
                  destination={selectedOrder.address}
                />
              </>
            ) : <p className="checkout-status-msg">Esta orden no tiene una dirección de entrega.</p>}
          </div>
        )}

        <div className="panel-card">
          <div className="panel-head">
            <h2>Evidencia de Entrega</h2>
            <span className="pill-tag">Cargar Receta</span>
          </div>
          <div className="form-field">
            <label>ID de Orden</label>
            <input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="Ej. 1" />
          </div>
          <div className="form-field">
            <label>Foto de la Receta Firmada</label>
            <label className="prescription-dropzone">
              <span>📷</span>
              <span>{recipe ? recipe.name : 'Tomar foto o elegir imagen...'}</span>
              <input type="file" accept="image/*" onChange={(e) => setRecipe(e.target.files?.[0] ?? null)} />
            </label>
          </div>
          <button type="button" className="btn-primary" onClick={uploadProof}>
            Cargar y Validar Entrega
          </button>
          {status && <div className="checkout-status-msg">{status}</div>}
        </div>
      </div>
    </div>
  );
}

function AdminPage({ token }: { token: string | null }) {
  const [dashboard, setDashboard] = useState<DashboardMetrics | null>(null);
  const [reports, setReports] = useState<any>(null);
  const [status, setStatus] = useState('');
  const [employee, setEmployee] = useState({ fullName: 'Nuevo Usuario', email: 'nuevo@derkas.com', password: 'Clave123*', role: 'Cajero', branchId: 1, supervisorId: null as number | null });
  const [crosscheckOrderId, setCrosscheckOrderId] = useState('1');
  const [categories, setCategories] = useState<Category[]>([]);
  const [newCategory, setNewCategory] = useState({ name: '', parentId: null as number | null });

  async function loadAll() {
    if (!token) return;
    const [dash, rep, categoryData] = await Promise.all([
      apiRequest<DashboardMetrics>('/api/admin/dashboard', {}, token),
      apiRequest('/api/admin/reports', {}, token),
      apiRequest<Category[]>('/api/admin/categories', {}, token)
    ]);
    setDashboard(dash);
    setReports(rep);
    setCategories(categoryData);
  }

  useEffect(() => {
    loadAll().catch((error) => setStatus(error.message));
  }, [token]);

  async function createEmployee() {
    try {
      await apiRequest('/api/admin/employees', {
        method: 'POST',
        body: JSON.stringify(employee)
      }, token);
      setStatus('Empleado registrado con éxito.');
      loadAll();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Error al registrar empleado');
    }
  }

  async function doCrosscheck() {
    try {
      await apiRequest(`/api/admin/orders/${crosscheckOrderId}/crosscheck`, {
        method: 'POST',
        body: JSON.stringify({ reviewerEmployeeId: 2, approved: true, notes: 'Receta validada y archivada' })
      }, token);
      setStatus(`Crosscheck registrado para orden #${crosscheckOrderId}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Error en crosscheck');
    }
  }

  async function addCategory() {
    try {
      if (!newCategory.name.trim()) throw new Error('Escribe el nombre de la categoría');
      await apiRequest('/api/admin/categories', { method: 'POST', body: JSON.stringify(newCategory) }, token);
      setNewCategory({ name: '', parentId: null });
      setStatus('Categoría creada correctamente.');
      await loadAll();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'No se pudo crear la categoría');
    }
  }

  async function removeCategory(category: Category) {
    if (!window.confirm(`¿Eliminar la categoría "${category.name}"?`)) return;
    try {
      await apiRequest(`/api/admin/categories/${category.id}`, { method: 'DELETE' }, token);
      setStatus('Categoría eliminada correctamente.');
      await loadAll();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'No se pudo eliminar la categoría');
    }
  }

  return (
    <div className="internal-page-container">
      {/* Metric Cards */}
      <div className="stats-grid-4">
        <div className="stat-metric-card">
          <p>Ventas del Día</p>
          <strong>{dashboard ? money(dashboard.salesToday) : '...'}</strong>
          <span>Cajas POS + En Línea</span>
        </div>
        <div className="stat-metric-card">
          <p>Ventas del Mes</p>
          <strong>{dashboard ? money(dashboard.salesMonth) : '...'}</strong>
          <span>Total acumulado</span>
        </div>
        <div className="stat-metric-card">
          <p>Stock Bajo</p>
          <strong>{dashboard ? String(dashboard.lowStockCount) : '...'}</strong>
          <span>Medicamentos críticos</span>
        </div>
        <div className="stat-metric-card">
          <p>Pedidos Pendientes</p>
          <strong>{dashboard ? String(dashboard.pendingOrders) : '...'}</strong>
          <span>Empaque o entrega</span>
        </div>
      </div>

      <div className="two-col-grid">
        <div className="panel-card">
          <div className="panel-head">
            <h2>Alta de Colaborador</h2>
            <span className="pill-tag">Control RBAC</span>
          </div>
          <div className="form-grid-2">
            <div className="form-field">
              <label>Nombre</label>
              <input value={employee.fullName} onChange={(e) => setEmployee({ ...employee, fullName: e.target.value })} />
            </div>
            <div className="form-field">
              <label>Correo</label>
              <input value={employee.email} onChange={(e) => setEmployee({ ...employee, email: e.target.value })} />
            </div>
          </div>
          <div className="form-grid-2">
            <div className="form-field">
              <label>Rol</label>
              <select value={employee.role} onChange={(e) => setEmployee({ ...employee, role: e.target.value })}>
                <option>Administrador</option>
                <option>Gerente</option>
                <option>Cajero</option>
                <option>Bodeguero</option>
                <option>Repartidor</option>
              </select>
            </div>
            <div className="form-field">
              <label>Contraseña</label>
              <input type="password" value={employee.password} onChange={(e) => setEmployee({ ...employee, password: e.target.value })} />
            </div>
          </div>
          <button type="button" className="btn-primary" onClick={createEmployee}>
            Crear Usuario
          </button>
        </div>

        <div className="panel-card">
          <div className="panel-head">
            <h2>Auditoría & Crosscheck MSPAS</h2>
            <span className="pill-tag">Validación Sanitaria</span>
          </div>
          <div className="form-field">
            <label>ID de Orden a Validar</label>
            <input value={crosscheckOrderId} onChange={(e) => setCrosscheckOrderId(e.target.value)} />
          </div>
          <button type="button" className="btn-primary" onClick={doCrosscheck}>
            Registrar Validación de Receta
          </button>
          <div className="reports-summary-grid">
            <div className="report-summary-box">
              <strong>{reports?.monthlySales?.length ?? 0}</strong>
              <span>Ventas Mensuales</span>
            </div>
            <div className="report-summary-box">
              <strong>{reports?.topProducts?.length ?? 0}</strong>
              <span>Top Productos</span>
            </div>
          </div>
          {status && <div className="checkout-status-msg">{status}</div>}
        </div>
      </div>

      <div className="panel-card" style={{ marginTop: '1rem' }}>
        <div className="panel-head"><h2>Categorías de medicamentos</h2><span className="pill-tag">Administrador / Gerente</span></div>
        <div className="form-grid-2">
          <div className="form-field"><label>Nombre de categoría</label><input value={newCategory.name} onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })} placeholder="Ej. Vitaminas" /></div>
          <div className="form-field"><label>Categoría principal</label><select value={newCategory.parentId ?? ''} onChange={(e) => setNewCategory({ ...newCategory, parentId: e.target.value ? Number(e.target.value) : null })}><option value="">Sin categoría principal</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
        </div>
        <button type="button" className="btn-primary" onClick={addCategory}>Agregar categoría</button>
        <div className="item-list-stack" style={{ marginTop: '0.75rem' }}>{categories.map((category) => <div className="compact-list-row" key={category.id}><strong>{category.name}</strong><button type="button" className="btn-secondary" onClick={() => removeCategory(category)}>Eliminar</button></div>)}</div>
      </div>
    </div>
  );
}

/* =========================================================================
   MAIN APP CONTROLLER
   ========================================================================= */

export default function App() {
  const [activePortal, setActivePortal] = useState<Portal>('public');
  const [token, setToken] = useState<string | null>(() => readToken());
  const [profile, setProfile] = useState<EmployeeProfile | null>(() => readProfile());
  const [customer, setCustomer] = useState<CustomerAccount | null>(() => {
    if (readToken()) {
      localStorage.removeItem('derkas.customer');
      return null;
    }
    const raw = localStorage.getItem('derkas.customer');
    return raw ? JSON.parse(raw) as CustomerAccount : null;
  });

  // Public Catalog State
  const [branches, setBranches] = useState<Branch[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<ProductCard[]>([]);
  const [query, setQuery] = useState('');
  const [branchId, setBranchId] = useState(1);
  const [cart, setCart] = useState<Array<{ productId: number; quantity: number }>>([]);
  const [selectedProductForGlobalModal, setSelectedProductForGlobalModal] = useState<ProductCard | null>(null);
  const [recipeFile, setRecipeFile] = useState<File | null>(null);
  const [status, setStatus] = useState('');
  const [paymentUrl, setPaymentUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [checkout, setCheckout] = useState({
    name: '',
    nit: '',
    email: '',
    phone: '',
    deliveryMode: 'DELIVERY' as 'DELIVERY' | 'PICKUP',
    paymentMethod: 'STRIPE' as 'STRIPE' | 'CASH',
    address: '',
    deliveryLatitude: null as number | null,
    deliveryLongitude: null as number | null
  });

  // Verify profile if token exists
  useEffect(() => {
    if (!token || profile) return;
    apiRequest<EmployeeProfile>('/api/auth/me', {}, token)
      .then(setProfile)
      .catch(() => {
        clearSession();
        setToken(null);
        setProfile(null);
      });
  }, [token, profile]);

  // Load branches & categories
  useEffect(() => {
    apiRequest<Branch[]>('/api/public/branches')
      .then(setBranches)
      .catch((error) => console.error(error.message));

    apiRequest<Category[]>('/api/public/categories')
      .then(setCategories)
      .catch((error) => console.error(error.message));
  }, []);

  // Load catalog when query or branch changes
  useEffect(() => {
    const timer = window.setTimeout(() => {
      apiRequest<ProductCard[]>(`/api/public/catalog?q=${encodeURIComponent(query)}&branchId=${branchId}`)
        .then(setProducts)
        .catch((error) => console.error(error.message));
    }, 150);
    return () => window.clearTimeout(timer);
  }, [query, branchId]);

  function handleAddToCart(productId: number, quantity: number = 1) {
    const product = products.find((p) => p.id === productId);
    if (!product || product.stock <= 0) {
      setToastMessage('Sin stock disponible para este medicamento');
      return;
    }

    setCart((current) => {
      const existing = current.find((item) => item.productId === productId);
      const currentQuantity = existing?.quantity ?? 0;
      const allowedQuantity = Math.min(quantity, product.stock - currentQuantity);
      if (allowedQuantity <= 0) {
        setToastMessage('Stock insuficiente para este medicamento');
        return current;
      }
      if (existing) {
        return current.map((item) =>
          item.productId === productId ? { ...item, quantity: item.quantity + allowedQuantity } : item
        );
      }
      return [...current, { productId, quantity: allowedQuantity }];
    });

    setToastMessage(`Añadido arriba para pagar: ${product.name}`);
    setTimeout(() => {
      setToastMessage(null);
    }, 2500);

    // Smooth scroll to top payment if needed
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleUpdateQuantity(productId: number, delta: number) {
    setCart((current) => {
      return current
        .map((item) => {
          if (item.productId === productId) {
            const nextQty = item.quantity + delta;
            const product = products.find((candidate) => candidate.id === productId);
            if (product && nextQty > product.stock) {
              setToastMessage('Stock insuficiente para este medicamento');
              return item;
            }
            return nextQty > 0 ? { ...item, quantity: nextQty } : null;
          }
          return item;
        })
        .filter((item): item is { productId: number; quantity: number } => item !== null);
    });
  }

  function handleRemoveItem(productId: number) {
    setCart((current) => current.filter((item) => item.productId !== productId));
  }

  async function handleCheckoutCart() {
    try {
      if (checkout.deliveryMode === 'DELIVERY' && !customer) {
        throw new Error('Inicia sesión o crea una cuenta para poder rastrear tu entrega a domicilio.');
      }
      setIsSubmitting(true);
      setStatus('Procesando orden y validación sanitaria...');
      const requiresPrescription = products.some(
        (product) => cart.some((item) => item.productId === product.id) && product.requiresPrescription
      );
      let prescriptionWebUrl: string | null = null;
      if (requiresPrescription) {
        if (!recipeFile) {
          throw new Error('Este pedido incluye medicamentos con receta médica obligatoria. Adjunta la foto de tu receta.');
        }
        const uploaded = await uploadTemporaryPrescription(recipeFile);
        prescriptionWebUrl = uploaded.url;
      }

      const result = await apiRequest<{ paymentUrl: string | null; mode: string; order: { code: string; total: number } }>(
        '/api/public/checkout',
        {
          method: 'POST',
          headers: customer ? { 'X-Customer-Id': String(customer.customerId) } : undefined,
          body: JSON.stringify({
            branchId,
            deliveryMode: checkout.deliveryMode,
            paymentMethod: checkout.paymentMethod,
            address: checkout.deliveryMode === 'DELIVERY' ? checkout.address : null,
            deliveryLatitude: checkout.deliveryMode === 'DELIVERY' ? checkout.deliveryLatitude : null,
            deliveryLongitude: checkout.deliveryMode === 'DELIVERY' ? checkout.deliveryLongitude : null,
            customer: {
              name: checkout.name,
              nit: checkout.nit,
              email: checkout.email,
              phone: checkout.phone
            },
            items: cart,
            prescriptionWebUrl
          })
        }
      );

      setPaymentUrl(result.paymentUrl ?? '');
      if (result.mode === 'stripe' && result.paymentUrl) {
        window.location.assign(result.paymentUrl);
        return;
      }
      setStatus(result.mode === 'cash'
        ? `¡Pedido ${result.order.code} recibido! ${checkout.deliveryMode === 'DELIVERY' ? 'Pagarás en efectivo al recibirlo.' : 'Pagarás en efectivo al recogerlo.'}`
        : `¡Orden ${result.order.code} generada exitosamente!`);
      setCart([]);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'No se pudo procesar el pago');
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleLogin(nextToken: string, nextProfile: EmployeeProfile) {
    localStorage.removeItem('derkas.customer');
    setCustomer(null);
    saveSession(nextToken, nextProfile);
    setToken(nextToken);
    setProfile(nextProfile);
  }

  function handleLogout() {
    clearSession();
    setToken(null);
    setProfile(null);
    setActivePortal('public');
  }

  function handleCustomerLogin(nextCustomer: CustomerAccount) {
    clearSession();
    setToken(null);
    setProfile(null);
    localStorage.setItem('derkas.customer', JSON.stringify(nextCustomer));
    setCustomer(nextCustomer);
    setCheckout((previous) => ({
      ...previous,
      name: nextCustomer.fullName,
      email: nextCustomer.email,
      phone: nextCustomer.phone,
      nit: nextCustomer.nit,
      address: nextCustomer.address || previous.address
    }));
    setActivePortal('public');
  }

  function handleCustomerLogout() {
    localStorage.removeItem('derkas.customer');
    setCustomer(null);
    setActivePortal('public');
  }

  function handleCustomerUpdate(nextCustomer: CustomerAccount) {
    localStorage.setItem('derkas.customer', JSON.stringify(nextCustomer));
    setCustomer(nextCustomer);
    setCheckout((previous) => ({
      ...previous,
      name: nextCustomer.fullName,
      email: nextCustomer.email,
      phone: nextCustomer.phone,
      nit: nextCustomer.nit,
      address: nextCustomer.address || previous.address
    }));
  }

  const cartTotal = cart.reduce((sum, item) => {
    const product = products.find((candidate) => candidate.id === item.productId);
    return sum + (product?.price ?? 0) * item.quantity;
  }, 0);

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const selectedBranch = branches.find((b) => b.id === branchId);
  const activeInCartItemForGlobal = selectedProductForGlobalModal
    ? cart.find((i) => i.productId === selectedProductForGlobalModal.id)
    : null;

  return (
    <div className="app-container">
      {/* 1. TOP HEADER */}
      <TopHeader
        branches={branches}
        branchId={branchId}
        onSelectBranch={setBranchId}
        cartCount={cartCount}
        cartTotal={cartTotal}
        activePortal={activePortal}
        onNavigatePortal={setActivePortal}
        token={token}
        profile={profile}
        onLogout={handleLogout}
        customer={customer}
        onCustomerLogout={handleCustomerLogout}
      />

      {/* 2. TOP PAYMENT SECTION DIRECTLY ABOVE CATALOG */}
      {activePortal === 'public' && (
        <TopPaymentBar
          cart={cart}
          products={products}
          onUpdateQuantity={handleUpdateQuantity}
          onRemoveItem={handleRemoveItem}
          onSelectProductForModal={setSelectedProductForGlobalModal}
          branchId={branchId}
          branches={branches}
          recipeFile={recipeFile}
          onSetRecipeFile={setRecipeFile}
          checkout={checkout}
          onUpdateCheckout={(fields) => setCheckout((prev) => ({ ...prev, ...fields }))}
          onSubmitPayment={handleCheckoutCart}
          isSubmitting={isSubmitting}
          status={status}
          paymentUrl={paymentUrl}
        />
      )}

      {/* 3. MAIN PRODUCT CATALOG BELOW TOP PAYMENT */}
      {activePortal === 'public' && (
        <PublicCatalogView
          branches={branches}
          branchId={branchId}
          categories={categories}
          products={products}
          query={query}
          onQueryChange={setQuery}
          cart={cart}
          onAddToCart={handleAddToCart}
          toastMessage={toastMessage}
        />
      )}

      {/* GLOBAL MODAL WHEN OPENED FROM TOP CART BAR */}
      <ProductDetailModal
        product={selectedProductForGlobalModal}
        categories={categories}
        branchName={selectedBranch ? `${selectedBranch.name} (${selectedBranch.city})` : undefined}
        onClose={() => setSelectedProductForGlobalModal(null)}
        onAddToCart={(id, quantity) => {
          handleAddToCart(id, quantity);
          setSelectedProductForGlobalModal(null);
        }}
        inCartQuantity={activeInCartItemForGlobal?.quantity ?? 0}
      />

      {/* INTERNAL PORTALS */}
      {activePortal === 'login' && (
        <LoginPage onLogin={handleLogin} onSuccess={() => setActivePortal('admin')} />
      )}
      {activePortal === 'customer' && !customer && <CustomerAuthPage onLogin={handleCustomerLogin} />}
      {customer && activePortal === 'customer' && <CustomerOrdersPage customer={customer} onUpdate={handleCustomerUpdate} onLogout={handleCustomerLogout} />}

      {activePortal === 'pos' && <PosPage token={token} profile={profile} categories={categories} />}
      {activePortal === 'warehouse' && <WarehousePage token={token} categories={categories} />}
      {activePortal === 'delivery' && <DeliveryPage token={token} />}
      {activePortal === 'admin' && <AdminPage token={token} />}
    </div>
  );
}
