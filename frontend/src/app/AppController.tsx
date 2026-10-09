import { useEffect, useState } from 'react';
import { TopHeader, HeroCarousel } from '../components/PublicHeader';
import LoginPage from '../features/auth/LoginPage';
import { apiRequest, uploadTemporaryPrescription } from '../api';
import { ProductDetailModal } from '../components/ProductDetailModal';

import type { Portal, Branch, Category, ProductCard, EmployeeProfile, CustomerAccount } from '../types';
import { money } from '../lib/catalog';
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
  const [activePortal, setActivePortal] = useState<Portal>('public');
  const [token, setToken] = useState<string | null>(() => readToken());
  const [profile, setProfile] = useState<EmployeeProfile | null>(() => readProfile());
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

  useEffect(() => {
    localStorage.setItem('farmacia-fjk.cart', JSON.stringify(cart));
  }, [cart]);

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
    setActivePortal('public');
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

      const result = await apiRequest<{ clientSecret?: string | null; mode: string; order: { code: string; total: number } }>(
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
            prescriptionWebUrl
          })
        }, customerToken
      );

      if (result.mode === 'stripe' && result.clientSecret) {
        setPaymentClientSecret(result.clientSecret);
        setStatus('Completa el pago en el formulario seguro de Stripe.');
        return;
      }
      setPaymentClientSecret('');
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
    localStorage.removeItem('farmacia-fjk.customer');
    localStorage.removeItem('farmacia-fjk.customer-token');
    setCustomer(null);
    setCustomerToken(null);
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
    setActivePortal('public');
  }

  function handleCustomerLogout() {
    localStorage.removeItem('farmacia-fjk.customer');
    localStorage.removeItem('farmacia-fjk.customer-token');
    setCustomer(null);
    setCustomerToken(null);
    setActivePortal('public');
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
    const checkoutWindow = window.open(`${window.location.origin}/?checkout=1`, '_blank', 'noopener,noreferrer');
    if (!checkoutWindow) window.location.assign(`${window.location.origin}/?checkout=1`);
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
       StripePaymentFormComponent={StripePaymentForm}
       isExpanded
      onToggleExpand={() => undefined}
    />
  );

  if (checkoutOnly) {
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
        onNavigatePortal={setActivePortal}
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
      {activePortal === 'public' && <HeroCarousel onNavigatePortal={setActivePortal} />}

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

      {/* INTERNAL PORTALS - Portales Internos FARMACIA FJK */}
      {activePortal === 'login' && (
        <LoginPage onLogin={handleLogin} onSuccess={() => setActivePortal('admin')} />
      )}
      {activePortal === 'customer' && !customer && <CustomerAuthPage onLogin={handleCustomerLogin} />}
      {customer && customerToken && activePortal === 'customer' && <CustomerOrdersPage customer={customer} customerToken={customerToken} onUpdate={handleCustomerUpdate} onLogout={handleCustomerLogout} />}

      {activePortal === 'pos' && <PosPage token={token} profile={profile} categories={categories} />}
      {activePortal === 'warehouse' && <WarehousePage token={token} categories={categories} />}
      {activePortal === 'delivery' && <DeliveryPage token={token} />}
      {activePortal === 'admin' && <AdminPage token={token} />}
    </div>
  );
}
