import { useEffect, useState } from 'react';
import { TopHeader, HeroCarousel } from '../components/PublicHeader';
import LoginPage from '../features/auth/LoginPage';
import { apiRequest, setUnauthorizedHandler, uploadTemporaryPrescription } from '../api';
import { ProductDetailModal } from '../components/ProductDetailModal';

import type { Portal, Branch, Category, ProductCard, EmployeeProfile, CustomerAccount } from '../types';
import { money } from '../lib/catalog';
import { getAllowedPortals, getDefaultPortal } from '../lib/employeePortals';
import { PosPage } from '../features/pos/PosPage';
import { WarehousePage } from '../features/warehouse/WarehousePage';
import { AdminPage } from '../features/admin/AdminPage';
import { PublicCatalogView } from '../features/catalog/PublicCatalogView';
import { StripePaymentForm, TopPaymentBar } from '../features/checkout/CheckoutPage';
import { CustomerAuthPage, CustomerOrdersPage } from '../features/customer/CustomerPages';
import DeliveryPage from '../features/delivery/DeliveryPage';

function readToken() {
  const token = localStorage.getItem('farmacia-fjk.token') ?? localStorage.getItem('derkas.token');
  if (!token || token.split('.').length !== 3) {
    localStorage.removeItem('farmacia-fjk.token');
    localStorage.removeItem('derkas.token');
    return null;
  }
  return token;
}

function readProfile() {
  const raw = localStorage.getItem('farmacia-fjk.profile');
  return raw ? (JSON.parse(raw) as EmployeeProfile) : null;
}

function readCustomerToken() {
  return localStorage.getItem('farmacia-fjk.customer-token');
}

function saveSession(token: string, profile: EmployeeProfile) {
  localStorage.setItem('farmacia-fjk.token', token);
  localStorage.removeItem('derkas.token');
  localStorage.setItem('farmacia-fjk.profile', JSON.stringify(profile));
}

function clearSession() {
  localStorage.removeItem('farmacia-fjk.token');
  localStorage.removeItem('derkas.token');
  localStorage.removeItem('farmacia-fjk.profile');
}

// =========================================================================
// INTERNAL PORTALS - Portales Internos FARMACIA FJK
// =========================================================================

/* =========================================================================
   MAIN APP CONTROLLER
   ========================================================================= */

export default function AppController() {
  const [token, setToken] = useState<string | null>(() => readToken());
  const [profile, setProfile] = useState<EmployeeProfile | null>(() => readProfile());
  const [selectedPortal, setSelectedPortal] = useState<Portal>(() => {
    const storedToken = readToken();
    const storedProfile = readProfile();
    return storedToken && storedProfile ? getDefaultPortal(storedProfile.role) ?? 'login' : 'public';
  });
  const activePortal = token
    ? profile && getAllowedPortals(profile.role).includes(selectedPortal)
      ? selectedPortal
      : getDefaultPortal(profile?.role ?? null) ?? 'login'
    : selectedPortal;
  const [customerToken, setCustomerToken] = useState<string | null>(() => readCustomerToken());
  const [customer, setCustomer] = useState<CustomerAccount | null>(() => {
    if (readToken()) {
      localStorage.removeItem('farmacia-fjk.customer');
      localStorage.removeItem('farmacia-fjk.customer-token');
      return null;
    }
    if (!readCustomerToken()) return null;
    const raw = localStorage.getItem('farmacia-fjk.customer');
    return raw ? JSON.parse(raw) as CustomerAccount : null;
  });

  useEffect(() => {
    setUnauthorizedHandler((expiredToken) => {
      if (expiredToken === readToken()) {
        clearSession();
        setToken(null);
        setProfile(null);
        setSelectedPortal('public');
      }
      if (expiredToken === readCustomerToken()) {
        localStorage.removeItem('farmacia-fjk.customer');
        localStorage.removeItem('farmacia-fjk.customer-token');
        setCustomer(null);
        setCustomerToken(null);
      }
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // Public Catalog State
  const [branches, setBranches] = useState<Branch[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<ProductCard[]>([]);
  const [query, setQuery] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | 'all'>('all');
  const [branchId, setBranchId] = useState(1);
  const [minPrice, setMinPrice] = useState<number | ''>('');
  const [maxPrice, setMaxPrice] = useState<number | ''>('');
  const [cart, setCart] = useState<Array<{ productId: number; quantity: number }>>(() => {
    try {
      const raw = localStorage.getItem('farmacia-fjk.cart');
      const saved = raw ? JSON.parse(raw) : [];
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });
  const [selectedProductForGlobalModal, setSelectedProductForGlobalModal] = useState<ProductCard | null>(null);
  const [recipeFile, setRecipeFile] = useState<File | null>(null);
  const [status, setStatus] = useState('');
  const [paymentClientSecret, setPaymentClientSecret] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [pendingPaymentOrder, setPendingPaymentOrder] = useState<{ orderCode: string; total: number; invoiceDownloadToken: string } | null>(null);
  const [lastOrder, setLastOrder] = useState<{ orderCode: string; total: number; invoiceDownloadToken: string } | null>(null);

  function navigateToPortal(portal: Portal) {
    if (token && (!profile || !getAllowedPortals(profile.role).includes(portal))) return;
    setSelectedPortal(portal);
  }

  useEffect(() => {
    localStorage.setItem('farmacia-fjk.cart', JSON.stringify(cart));
  }, [cart]);

  // Download invoice function
  const downloadInvoice = async (orderCode: string, invoiceDownloadToken: string) => {
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000';
      let response: Response | null = null;
      let message = 'La factura todavía está siendo preparada.';
      for (let attempt = 0; attempt < 6; attempt += 1) {
        response = await fetch(`${apiUrl}/api/public/orders/${encodeURIComponent(orderCode)}/invoice?token=${encodeURIComponent(invoiceDownloadToken)}`);
        if (response.ok) break;
        const payload = await response.clone().json().catch(() => null) as { message?: string } | null;
        message = payload?.message || message;
        if (response.status !== 400 || !message.toLowerCase().includes('pagada')) break;
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
      }

      if (!response?.ok) {
        throw new Error(message);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `factura-${lastOrder?.orderCode || 'orden'}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'No se pudo descargar la factura');
    }
  };

  function handlePaymentSuccess(orderOverride?: { orderCode: string; total: number; invoiceDownloadToken: string }) {
    const completedOrder = orderOverride ?? pendingPaymentOrder;
    if (!completedOrder) return;
    setPaymentClientSecret('');
    setCart([]);
    setLastOrder(completedOrder);
    setPendingPaymentOrder(null);
    setPaymentSuccess(true);
    setStatus('Pago confirmado correctamente.');
  }

  const [checkout, setCheckout] = useState({
    name: '',
    nit: 'CF',
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

  useEffect(() => {
    const paymentIntentId = new URLSearchParams(window.location.search).get('posPayment');
    if (!paymentIntentId) return;
    setSelectedPortal('public');
    apiRequest<{ clientSecret: string; amount: number }>(`/api/public/pos-payment/${encodeURIComponent(paymentIntentId)}`)
      .then(({ clientSecret }) => {
        setPaymentClientSecret(clientSecret);
        setStatus('Completa el pago de la venta del mostrador.');
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : 'No se pudo cargar el pago'));
  }, []);

  useEffect(() => {
    if (!customer) return;
    setCheckout((previous) => ({
      ...previous,
      name: customer.fullName,
      email: customer.email,
      phone: customer.phone,
      nit: customer.nit || 'CF',
      address: customer.address || previous.address
    }));
  }, [customer]);

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
      const params = new URLSearchParams();
      params.set('q', query);
      params.set('branchId', String(branchId));
      if (minPrice !== '') params.set('minPrice', String(minPrice));
      if (maxPrice !== '') params.set('maxPrice', String(maxPrice));
      apiRequest<ProductCard[]>(`/api/public/catalog?${params.toString()}`)
        .then(setProducts)
        .catch((error) => console.error(error.message));
    }, 150);
    return () => window.clearTimeout(timer);
  }, [query, branchId, minPrice, maxPrice]);

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

  async function handleCheckoutCart(discountCode?: string) {
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

      const result = await apiRequest<{ clientSecret?: string | null; invoiceDownloadToken?: string; mode: string; order: { id: number; code: string; total: number } }>(
        '/api/public/checkout',
        {
          method: 'POST',
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
            prescriptionWebUrl,
            discountCode
          })
        }, customerToken
      );

      if (result.mode === 'stripe' && result.clientSecret) {
        if (!result.invoiceDownloadToken) throw new Error('No se pudo preparar la descarga de la factura.');
        setPendingPaymentOrder({ orderCode: result.order.code, total: result.order.total, invoiceDownloadToken: result.invoiceDownloadToken });
        setPaymentClientSecret(result.clientSecret);
        setStatus('Completa el pago en el formulario seguro de Stripe.');
        return;
      }
      setPaymentClientSecret('');
      if (result.order && result.invoiceDownloadToken) {
        handlePaymentSuccess({ orderCode: result.order.code, total: result.order.total, invoiceDownloadToken: result.invoiceDownloadToken });
      } else {
        setStatus(result.mode === 'cash'
          ? `¡Pedido ${result.order.code} recibido! ${checkout.deliveryMode === 'DELIVERY' ? 'Pagarás en efectivo al recibirlo.' : 'Pagarás en efectivo al recogerlo.'}`
          : `¡Orden ${result.order.code} generada exitosamente!`);
        setCart([]);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'No se pudo procesar el pago');
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleLogin(nextToken: string, nextProfile: EmployeeProfile) {
    localStorage.removeItem('farmacia-fjk.customer');
    localStorage.removeItem('farmacia-fjk.customer-token');
    setCustomer(null);
    setCustomerToken(null);
    saveSession(nextToken, nextProfile);
    setToken(nextToken);
    setProfile(nextProfile);
    setSelectedPortal(getDefaultPortal(nextProfile.role) ?? 'login');
  }

  function handleLogout() {
    clearSession();
    setToken(null);
    setProfile(null);
    setSelectedPortal('public');
  }

  function handleCustomerLogin(nextCustomerToken: string, nextCustomer: CustomerAccount) {
    clearSession();
    setToken(null);
    setProfile(null);
    localStorage.setItem('farmacia-fjk.customer-token', nextCustomerToken);
    localStorage.setItem('farmacia-fjk.customer', JSON.stringify(nextCustomer));
    setCustomerToken(nextCustomerToken);
    setCustomer(nextCustomer);
    setCheckout((previous) => ({
      ...previous,
      name: nextCustomer.fullName,
      email: nextCustomer.email,
      phone: nextCustomer.phone,
      nit: nextCustomer.nit,
      address: nextCustomer.address || previous.address
    }));
    setSelectedPortal('public');
  }

  function handleCustomerLogout() {
    localStorage.removeItem('farmacia-fjk.customer');
    localStorage.removeItem('farmacia-fjk.customer-token');
    setCustomer(null);
    setCustomerToken(null);
    setSelectedPortal('public');
  }

  function handleCustomerUpdate(nextCustomer: CustomerAccount) {
    localStorage.setItem('farmacia-fjk.customer', JSON.stringify(nextCustomer));
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

  function openCheckout() {
    localStorage.setItem('farmacia-fjk.cart', JSON.stringify(cart));
    window.location.assign(`${window.location.origin}/?checkout=1`);
  }

  const checkoutOnly = ['checkout', 'posPayment'].some((key) => new URLSearchParams(window.location.search).has(key));
  const checkoutPanel = (
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
      onUpdateCheckout={(fields) => setCheckout((previous) => ({ ...previous, ...fields }))}
      onSubmitPayment={handleCheckoutCart}
      isSubmitting={isSubmitting}
      status={status}
        paymentClientSecret={paymentClientSecret}
        onClosePayment={() => setPaymentClientSecret('')}
        onPaymentSuccess={handlePaymentSuccess}
        StripePaymentFormComponent={StripePaymentForm}
       isExpanded
      onToggleExpand={() => undefined}
    />
  );

  if (checkoutOnly) {
// Show payment success screen
  if (paymentSuccess && lastOrder) {
    return (
      <div className="app-container">
        <div className="checkout-only-page" style={{ maxWidth: '500px', margin: '0 auto', paddingTop: '2rem' }}>
          <div className="checkout-only-header">
            <div className="checkout-only-brand">
              <div className="brand-icon"><span>+</span></div>
              <div><strong>Gestión de Farmacia</strong><small>Pago completado</small></div>
            </div>
            <button type="button" className="btn-secondary" onClick={() => { window.location.href = '/'; }}>Volver al catálogo</button>
          </div>
          <div className="checkout-only-page" style={{ padding: '2rem', textAlign: 'center' }}>
            <div className="success-icon" style={{ fontSize: '4rem', marginBottom: '1rem' }}>✅</div>
            <h2 style={{ color: 'var(--success, #10b981)', marginBottom: '0.5rem' }}>¡Pago Confirmado!</h2>
            <p style={{ marginBottom: '0.5rem', color: 'var(--text-main)' }}>
              Tu pago ha sido procesado correctamente.
            </p>
            <div style={{ margin: '1.5rem 0', padding: '1rem', background: 'var(--bg-subtle)', borderRadius: 'var(--radius-md)' }}>
              <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>Detalles de la orden</p>
              <p style={{ margin: '0 0 0.25rem' }}>Orden: <strong>{lastOrder?.orderCode}</strong></p>
              <p style={{ margin: '0' }}>Total: <strong>{new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(lastOrder?.total || 0)}</strong></p>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap', marginTop: '1.5rem' }}>
              <button
                type="button"
                className="btn-primary"
                style={{ padding: '0.75rem 1.5rem' }}
                onClick={() => downloadInvoice(lastOrder?.orderCode || '', lastOrder?.invoiceDownloadToken || '')}
              >
                Descargar Factura PDF
              </button>
              <button
                type="button"
                className="btn-secondary"
                style={{ padding: '0.75rem 1.5rem' }}
                onClick={() => { window.location.href = '/'; }}
              >
                Volver al Catálogo
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
      <div className="checkout-only-page">
        <div className="checkout-only-header">
          <div className="checkout-only-brand">
            <div className="brand-icon"><span>+</span></div>
            <div><strong>Gestión de Farmacia</strong><small>Pago seguro de tu pedido</small></div>
          </div>
          <button type="button" className="btn-secondary" onClick={() => { window.location.href = '/'; }}>Volver al catálogo</button>
        </div>
        {checkoutPanel}
      </div>
    );
  }

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
        onNavigatePortal={navigateToPortal}
        token={token}
        profile={profile}
        onLogout={handleLogout}
        customer={customer}
        onCustomerLogout={handleCustomerLogout}
        categories={categories}
        onCategorySelect={setSelectedCategoryId}
        onQueryChange={setQuery}
        minPrice={minPrice}
        maxPrice={maxPrice}
        onMinPriceChange={setMinPrice}
        onMaxPriceChange={setMaxPrice}
        onOpenCheckout={openCheckout}
      />

      {/* HERO CAROUSEL - Solo en portal público */}
      {activePortal === 'public' && <HeroCarousel onNavigatePortal={navigateToPortal} products={products} />}

      {/* MAIN PRODUCT CATALOG */}
      {activePortal === 'public' && (
        <PublicCatalogView
          branches={branches}
          branchId={branchId}
          categories={categories}
          products={products}
          cart={cart}
          onAddToCart={handleAddToCart}
          toastMessage={toastMessage}
          minPrice={minPrice}
          maxPrice={maxPrice}
          onMinPriceChange={setMinPrice}
          onMaxPriceChange={setMaxPrice}
          selectedCategoryId={selectedCategoryId}
          onCategorySelect={setSelectedCategoryId}
          query={query}
          onQueryChange={setQuery}
          showInternalInfo={profile !== null}
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
        showInternalInfo={profile !== null}
      />

      {/* INTERNAL PORTALS - Portales Internos FARMACIA FJK */}
      {activePortal === 'login' && (
        <LoginPage onLogin={handleLogin} />
      )}
      {activePortal === 'customer' && !customer && <CustomerAuthPage onLogin={handleCustomerLogin} />}
      {customer && customerToken && activePortal === 'customer' && <CustomerOrdersPage customer={customer} customerToken={customerToken} onUpdate={handleCustomerUpdate} onLogout={handleCustomerLogout} />}

      {activePortal === 'pos' && <PosPage token={token} profile={profile} categories={categories} branches={branches} />}
      {activePortal === 'warehouse' && <WarehousePage token={token} categories={categories} />}
      {activePortal === 'delivery' && <DeliveryPage token={token} />}
      {activePortal === 'admin' && <AdminPage token={token} canManageDiscountCodes={profile?.role === 'Administrador' || profile?.role === 'Gerente'} />}
    </div>
  );
}
