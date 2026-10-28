import { useEffect, useRef, useState, type FormEvent } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { apiRequest } from '../../api';
import { money } from '../../lib/catalog';
import { isValidGuatemalaPhone, sanitizePhoneInput } from '../../lib/validation';
import type { Branch, ProductCard } from '../../types';

const stripePromise = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)
  : null;

type StripePaymentFormProps = { clientSecret: string; onPaymentSuccess?: () => void };

export function StripePaymentForm({ clientSecret, onPaymentSuccess }: StripePaymentFormProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<any>(null);
  const elementsRef = useRef<any>(null);
  const [status, setStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let paymentElement: { unmount: () => void } | null = null;
    async function mountPaymentElement() {
      const stripe = await stripePromise;
      if (!stripe || cancelled || !containerRef.current) return;
      const elements = stripe.elements({
        clientSecret,
        appearance: {
          theme: 'stripe',
          variables: { colorPrimary: '#0d9488', colorBackground: '#ffffff', colorText: '#0f172a', colorTextSecondary: '#475569', colorDanger: '#dc2626', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', borderRadius: '10px', spacingUnit: '4px' },
          rules: { '.Input': { border: '1px solid #cbd5e1', boxShadow: 'none' }, '.Input:focus': { border: '1px solid #0d9488', boxShadow: '0 0 0 3px rgba(13, 148, 136, 0.14)' }, '.Label': { fontWeight: '600' } }
        }
      });
      const element = elements.create('payment');
      if (cancelled || !containerRef.current) { element.unmount(); return; }
      element.mount(containerRef.current);
      stripeRef.current = stripe;
      elementsRef.current = elements;
      paymentElement = element;
    }
    void mountPaymentElement();
    return () => { cancelled = true; paymentElement?.unmount(); stripeRef.current = null; elementsRef.current = null; };
  }, [clientSecret]);

  if (!stripePromise) return <div className="checkout-status-msg">Falta configurar VITE_STRIPE_PUBLISHABLE_KEY.</div>;
  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stripeRef.current || !elementsRef.current) return;
    setIsSubmitting(true); setStatus('Confirmando pago...');
    const { error, paymentIntent } = await stripeRef.current.confirmPayment({ elements: elementsRef.current, confirmParams: { return_url: window.location.href }, redirect: 'if_required' });
    if (error) setStatus(error.message ?? 'No se pudo confirmar el pago.');
    else if (paymentIntent?.status === 'succeeded') {
      setStatus('Pago confirmado correctamente.');
      onPaymentSuccess?.();
    } else if (paymentIntent?.status === 'processing') setStatus('Pago en procesamiento.');
    else setStatus('El pago requiere una validación adicional.');
    setIsSubmitting(false);
  }
  return <form className="custom-stripe-form" onSubmit={submitPayment}>
    <div className="custom-stripe-heading"><div className="custom-stripe-icon">+</div><div><strong>Pago seguro</strong><span>Procesado de forma segura por Stripe</span></div></div>
    <div className="form-field"><label>Datos de pago</label><div ref={containerRef} /></div>
    <button type="submit" className="btn-primary" disabled={isSubmitting}>{isSubmitting ? 'Confirmando pago...' : 'Confirmar pago'}</button>
    {status && <div className="checkout-status-msg">{status}</div>}
  </form>;
}

type Checkout = { name: string; nit: string; email: string; phone: string; deliveryMode: 'DELIVERY' | 'PICKUP'; paymentMethod: 'STRIPE' | 'CASH'; address: string; deliveryLatitude: number | null; deliveryLongitude: number | null };
type DiscountQuote = { code: string; subtotal: number; discountAmount: number; total: number; cartSignature: string; email: string };
type Props = { cart: Array<{ productId: number; quantity: number }>; products: ProductCard[]; onUpdateQuantity: (productId: number, delta: number) => void; onRemoveItem: (productId: number) => void; onSelectProductForModal?: (product: ProductCard) => void; branchId: number; branches: Branch[]; recipeFile: File | null; onSetRecipeFile: (file: File | null) => void; checkout: Checkout; onUpdateCheckout: (fields: Partial<Checkout>) => void; onSubmitPayment: (discountCode?: string) => void; isSubmitting: boolean; status: string; paymentClientSecret: string; isExpanded: boolean; onToggleExpand: () => void; onClosePayment?: () => void; onPaymentSuccess?: () => void; StripePaymentFormComponent?: typeof StripePaymentForm };

export function TopPaymentBar({ StripePaymentFormComponent = StripePaymentForm, ...props }: Props) {
  const { cart, products, branches, branchId, checkout, recipeFile, onSetRecipeFile, onUpdateCheckout, onUpdateQuantity, onRemoveItem, onSelectProductForModal, onSubmitPayment, isSubmitting, status, paymentClientSecret, isExpanded, onToggleExpand, onClosePayment, onPaymentSuccess } = props;
  const [couponCode, setCouponCode] = useState('');
  const [couponMessage, setCouponMessage] = useState('');
  const [isCheckingCoupon, setIsCheckingCoupon] = useState(false);
  const [couponQuote, setCouponQuote] = useState<DiscountQuote | null>(null);
  const couponRequestId = useRef(0);
  const cartSignature = cart.map((item) => `${item.productId}:${item.quantity}`).join('|');
  useEffect(() => {
    couponRequestId.current += 1;
    setCouponQuote(null);
    setCouponMessage('');
  }, [cartSignature, branchId, checkout.email]);
  const selectedBranch = branches.find((branch) => branch.id === branchId);
  const items = cart.map((item) => ({ ...item, product: products.find((product) => product.id === item.productId), subtotal: (products.find((product) => product.id === item.productId)?.price ?? 0) * item.quantity }));
  const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  const validCoupon = couponQuote?.cartSignature === cartSignature &&
    couponQuote.email === checkout.email.trim().toLowerCase()
    ? couponQuote
    : null;
  const total = validCoupon?.total ?? subtotal;
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0); const hasPrescriptionItems = items.some((item) => item.product?.requiresPrescription); const billingAsCf = checkout.nit === 'CF';
  async function applyCoupon() {
    if (!couponCode.trim()) {
      setCouponMessage('Ingresa un código de descuento.');
      return;
    }
    setIsCheckingCoupon(true);
    setCouponQuote(null);
    setCouponMessage('');
    const requestId = ++couponRequestId.current;
    const requestedEmail = checkout.email.trim().toLowerCase();
    const requestedCartSignature = cartSignature;
    try {
      const quote = await apiRequest<Omit<DiscountQuote, 'cartSignature'>>('/api/public/discounts/validate', {
        method: 'POST',
        body: JSON.stringify({
          code: couponCode,
          email: checkout.email,
          branchId,
          items: cart
        })
      });
      if (requestId !== couponRequestId.current) return;
      setCouponCode(quote.code);
      setCouponQuote({ ...quote, cartSignature: requestedCartSignature, email: requestedEmail });
      setCouponMessage(`Descuento aplicado: ${money(quote.discountAmount)}`);
    } catch (error) {
      if (requestId !== couponRequestId.current) return;
      setCouponMessage(error instanceof Error ? error.message : 'No se pudo validar el código.');
    } finally {
      if (requestId === couponRequestId.current) setIsCheckingCoupon(false);
    }
  }
  return <section className="top-payment-section"><div className="top-payment-container">
    <div className="top-payment-header"><div className="top-payment-title-group"><div className="pay-icon-badge">$</div><div><h2>Forma de Pago</h2><p>{cartCount > 0 ? `${cartCount} medicamento${cartCount > 1 ? 's' : ''} en carrito para ${selectedBranch?.name ?? 'sucursal'}` : 'Agrega medicamentos del catálogo abajo para completar tu compra'}</p></div></div><div className="top-payment-actions"><div className="top-total-badge"><span>Total:</span><strong>{money(total)}</strong></div><button type="button" className="toggle-expand-btn" onClick={onToggleExpand}><span>{isExpanded ? 'Ocultar detalles' : 'Ver formulario de pago'}</span></button></div></div>
    {isExpanded && <div className="top-payment-body"><div className="top-payment-grid"><div className="top-cart-col"><div className="top-col-header"><h3>Artículos en Carrito ({cartCount})</h3></div>{cart.length === 0 ? <div className="top-cart-empty"><p>Carrito vacío</p><span>Haz clic en "Agregar al Carrito" en cualquier producto del catálogo abajo.</span></div> : <div className="top-cart-items-scroll">{items.map((item) => <div key={item.productId} className="top-cart-item-row"><div className="top-item-row-left" onClick={() => item.product && onSelectProductForModal?.(item.product)}><div className="cart-item-thumb">{item.product?.imageUrl ? <img src={item.product.imageUrl} alt={item.product.name} /> : <span className="cart-item-thumb-fallback">Medicamento</span>}</div><div className="top-item-info"><span className="top-item-name">{item.product?.name ?? `Producto #${item.productId}`}</span><span className="top-item-unit-price">{money(item.product?.price ?? 0)} c/u{item.product?.requiresPrescription && <span className="top-item-rx-tag"> • Receta requerida</span>}</span></div></div><div className="top-qty-group"><button type="button" className="top-qty-btn" onClick={() => onUpdateQuantity(item.productId, -1)}>-</button><span className="top-qty-text">{item.quantity}</span><button type="button" className="top-qty-btn" onClick={() => onUpdateQuantity(item.productId, 1)}>+</button></div><strong className="top-item-subtotal">{money(item.subtotal)}</strong><button type="button" className="top-item-del-btn" onClick={() => onRemoveItem(item.productId)}>Quitar</button></div>)}</div>}{hasPrescriptionItems && <div className="prescription-alert-box"><span>Aviso</span><div><strong>Receta médica requerida</strong><p>Has seleccionado medicamentos éticos. Adjunta la foto de tu receta a la derecha.</p></div></div>}</div>
      <div className="top-form-col"><div className="top-col-header"><h3>Datos de Facturación y Entrega</h3></div><div className="form-grid-2"><div className="form-field"><label>Nombre y Apellido</label><input value={checkout.name} onChange={(event) => onUpdateCheckout({ name: event.target.value })} placeholder="Ej. Juan Pérez" /></div><div className="form-field"><label>Tipo de facturación</label><div className="billing-type-options"><label className={`billing-type-option ${!billingAsCf ? 'active' : ''}`}><input type="radio" checked={!billingAsCf} onChange={() => onUpdateCheckout({ nit: checkout.nit === 'CF' ? '' : checkout.nit })} />NIT</label><label className={`billing-type-option ${billingAsCf ? 'active' : ''}`}><input type="radio" checked={billingAsCf} onChange={() => onUpdateCheckout({ nit: 'CF' })} />C/F</label></div>{!billingAsCf && <input value={checkout.nit} onChange={(event) => onUpdateCheckout({ nit: event.target.value })} placeholder="Ej. 1234567-8" />}</div></div>
      <div className="form-grid-2"><div className="form-field"><label>Correo Electrónico</label><input type="email" value={checkout.email} onChange={(event) => onUpdateCheckout({ email: event.target.value })} placeholder="cliente@correo.com" /></div><div className="form-field"><label htmlFor="checkout-phone">Teléfono celular (8 dígitos)</label><input id="checkout-phone" type="tel" inputMode="numeric" pattern="[0-9]{8}" maxLength={8} required aria-invalid={checkout.phone.length > 0 && !isValidGuatemalaPhone(checkout.phone)} value={checkout.phone} onChange={(event) => onUpdateCheckout({ phone: sanitizePhoneInput(event.target.value) })} placeholder="42501265" /><small>Ingresa exactamente 8 números, sin guiones.</small></div></div>
      <div className="form-grid-2"><div className="form-field"><label htmlFor="checkout-discount-code">Código de descuento</label><input id="checkout-discount-code" value={couponCode} onChange={(event) => { couponRequestId.current += 1; setCouponCode(event.target.value.toUpperCase()); setCouponQuote(null); setCouponMessage(''); }} placeholder="Ingresa tu código" maxLength={32} /></div><div className="form-field" style={{ display: 'flex', justifyContent: 'end' }}><button type="button" className="btn-secondary" disabled={isCheckingCoupon || cart.length === 0} onClick={applyCoupon}>{isCheckingCoupon ? 'Validando...' : 'Aplicar código'}</button></div></div>
      {couponMessage && <div className="checkout-status-msg" role="status" aria-live="polite">{couponMessage}</div>}
      {validCoupon && <div className="checkout-status-msg" role="status">Subtotal {money(validCoupon.subtotal)} · Descuento {money(validCoupon.discountAmount)} · Total {money(validCoupon.total)}</div>}
      <div className="form-field"><label>Método de Entrega</label><div className="delivery-toggle-group"><button type="button" className={`delivery-toggle-btn ${checkout.deliveryMode === 'DELIVERY' ? 'active' : ''}`} onClick={() => onUpdateCheckout({ deliveryMode: 'DELIVERY' })}>Envío a domicilio</button><button type="button" className={`delivery-toggle-btn ${checkout.deliveryMode === 'PICKUP' ? 'active' : ''}`} onClick={() => onUpdateCheckout({ deliveryMode: 'PICKUP' })}>Retiro en sucursal ({selectedBranch?.name ?? 'Sede'})</button></div></div>
      {checkout.deliveryMode === 'DELIVERY' && <div className="form-field"><label>Dirección de Entrega</label><input value={checkout.address} onChange={(event) => onUpdateCheckout({ address: event.target.value })} placeholder="Dirección exacta, zona, número de casa..." /><button type="button" className="btn-secondary" onClick={() => navigator.geolocation?.getCurrentPosition((position) => onUpdateCheckout({ deliveryLatitude: position.coords.latitude, deliveryLongitude: position.coords.longitude }), () => onUpdateCheckout({ deliveryLatitude: null, deliveryLongitude: null }))}>{checkout.deliveryLatitude !== null ? 'Ubicación real guardada' : 'Usar mi ubicación actual'}</button></div>}
      <div className="form-field"><label>Método de pago</label><div className="delivery-toggle-group"><button type="button" className={`delivery-toggle-btn ${checkout.paymentMethod === 'STRIPE' ? 'active' : ''}`} onClick={() => onUpdateCheckout({ paymentMethod: 'STRIPE' })}>Pagar con tarjeta</button><button type="button" className={`delivery-toggle-btn ${checkout.paymentMethod === 'CASH' ? 'active' : ''}`} onClick={() => onUpdateCheckout({ paymentMethod: 'CASH' })}>{checkout.deliveryMode === 'DELIVERY' ? 'Efectivo contra entrega' : 'Efectivo en sucursal'}</button></div></div>
      {hasPrescriptionItems && <div className="form-field"><label>Fotografía de Receta Médica</label><label className="prescription-dropzone"><span>Receta</span><span>{recipeFile?.name ?? 'Subir archivo de receta médica...'}</span><input type="file" accept="image/*,.pdf" onChange={(event) => onSetRecipeFile(event.target.files?.[0] ?? null)} /></label></div>}
       <button type="button" className="checkout-submit-btn" disabled={cart.length === 0 || isSubmitting || !isValidGuatemalaPhone(checkout.phone)} onClick={() => onSubmitPayment(validCoupon?.code)}>{isSubmitting ? 'Procesando pago seguro...' : `${checkout.paymentMethod === 'CASH' ? 'CONFIRMAR PEDIDO' : 'PAGAR ORDEN'}${total > 0 ? ` (${money(total)})` : ''}`}</button>{!isValidGuatemalaPhone(checkout.phone) && <div className="checkout-status-msg" role="status">Ingresa un teléfono de exactamente 8 dígitos para continuar.</div>}{status && <div className="checkout-status-msg">{status}</div>}</div>
     </div></div>}
   </div>
   {paymentClientSecret && (
     <div className="stripe-payment-modal-backdrop" role="presentation" onClick={onClosePayment}>
       <div className="stripe-payment-modal" role="dialog" aria-modal="true" aria-labelledby="stripe-payment-title" onClick={(event) => event.stopPropagation()}>
         <div className="stripe-payment-modal-header">
           <div><span className="stripe-payment-kicker">Pago con tarjeta</span><h2 id="stripe-payment-title">Completa tu pago</h2><p>Total de la orden: {money(total)}</p></div>
           <button type="button" className="modal-close-btn" onClick={onClosePayment}>Cerrar</button>
         </div>
         <StripePaymentFormComponent clientSecret={paymentClientSecret} onPaymentSuccess={onPaymentSuccess} />
       </div>
     </div>
   )}
 </section>;
}
