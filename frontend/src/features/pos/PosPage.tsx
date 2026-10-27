import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { apiRequest } from "../../api";
import { ProductDetailModal } from "../../components/ProductDetailModal";
import type { Category, EmployeeProfile, ProductCard } from "../../types";
import { getCategoryHierarchyIds, money } from "../../lib/catalog";

export function PosPage({ token, profile, categories }: { token: string | null; profile: EmployeeProfile | null; categories?: Category[] }) {
  const [orders, setOrders] = useState<any[]>([]);
  const [products, setProducts] = useState<ProductCard[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | "all">("all");
  const [status, setStatus] = useState("");
  const [branchId] = useState(profile?.branchId ?? 1);
  const [sale, setSale] = useState({ name: "Cliente de mostrador", nit: "CF", email: "mostrador@demo.com", phone: "0000-0000", productId: 1, quantity: 1, cashReceived: "" });
  const [saleLines, setSaleLines] = useState<Array<{ productId: number; quantity: number }>>([]);
  const [discountCode, setDiscountCode] = useState("");
  const [discountMessage, setDiscountMessage] = useState("");
  const [discountQuote, setDiscountQuote] = useState<{ code: string; subtotal: number; discountAmount: number; total: number; quoteKey: string } | null>(null);
  const [selectedProductForModal, setSelectedProductForModal] = useState<ProductCard | null>(null);
  const [qrPayment, setQrPayment] = useState<{ orderCode: string; total: number; paymentUrl: string; imageUrl: string } | null>(null);
  const [lastSaleOrderId, setLastSaleOrderId] = useState<number | null>(null);
  const [downloadingInvoice, setDownloadingInvoice] = useState(false);

  async function loadData() {
    if (!token) return;
    const [ordersData, prodsData] = await Promise.all([
      apiRequest<any[]>("/api/pos/pickup-orders?branchId=" + branchId, {}, token),
      apiRequest<ProductCard[]>("/api/public/catalog?branchId=" + branchId)
    ]);
    setOrders(ordersData);
    setProducts(prodsData);
    if (prodsData.length > 0 && !prodsData.some((product) => product.id === sale.productId)) {
      setSale((prev) => ({ ...prev, productId: prodsData[0].id }));
    }
  }

  useEffect(() => {
    loadData().catch((error) => setStatus(error.message));
  }, [token, branchId]);

  const filteredProducts = products.filter((p) => {
    if (selectedCategoryId !== "all") {
      const allowedIds = getCategoryHierarchyIds(selectedCategoryId, categories ?? []);
      if (!p.categoryId || !allowedIds.includes(p.categoryId)) return false;
    }
    if (productSearch.trim()) {
      const q = productSearch.toLowerCase().trim();
      const cat = (categories ?? []).find((c) => c.id === p.categoryId);
      if (![p.name, p.sku, p.brand, p.laboratory, cat?.name ?? "", p.presentation].some((f) => f.toLowerCase().includes(q))) return false;
    }
    return true;
  });

  const selectedProd = products.find((p) => p.id === sale.productId);
  const catalogSubtotal = saleLines.reduce((sum, line) => {
    const product = products.find((candidate) => candidate.id === line.productId);
    return sum + (product?.price ?? 0) * line.quantity;
  }, 0);
  const quoteKey = JSON.stringify({
    branchId,
    email: sale.email.trim().toLowerCase(),
    code: discountCode.trim().toUpperCase(),
    items: saleLines
  });
  const appliedDiscount = discountQuote?.quoteKey === quoteKey ? discountQuote : null;
  const discountAmount = appliedDiscount?.discountAmount ?? 0;
  const subtotal = appliedDiscount?.subtotal ?? catalogSubtotal;
  const total = appliedDiscount?.total ?? (catalogSubtotal - discountAmount);

  function addProductToSale(productId = sale.productId, quantity = sale.quantity) {
    const product = products.find((candidate) => candidate.id === productId);
    if (!product || product.stock <= 0) {
      setStatus("Selecciona un medicamento disponible en esta sucursal.");
      return;
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setStatus("La cantidad debe ser un número entero mayor a cero.");
      return;
    }
    const existing = saleLines.find((line) => line.productId === productId);
    const nextQuantity = (existing?.quantity ?? 0) + quantity;
    if (nextQuantity > product.stock) {
      setStatus(`Stock insuficiente para ${product.name}. Disponible: ${product.stock}.`);
      return;
    }
    setSaleLines((lines) => existing
      ? lines.map((line) => line.productId === productId ? { ...line, quantity: nextQuantity } : line)
      : [...lines, { productId, quantity }]);
    setDiscountMessage("");
    setStatus("");
  }

  function updateSaleQuantity(productId: number, quantity: number) {
    const product = products.find((candidate) => candidate.id === productId);
    if (!product) return;
    const safeQuantity = Math.min(product.stock, Math.max(1, Math.floor(quantity) || 1));
    setSaleLines((lines) => lines.map((line) => line.productId === productId ? { ...line, quantity: safeQuantity } : line));
    setDiscountMessage("");
  }

  async function applyDiscountCode() {
    try {
      if (!discountCode.trim()) throw new Error("Escribe un código de descuento.");
      if (!saleLines.length) throw new Error("Agrega medicamentos antes de aplicar el descuento.");
      const quote = await apiRequest<{ code: string; subtotal: number; discountAmount: number; total: number }>("/api/public/discounts/validate", {
        method: "POST",
        body: JSON.stringify({
          code: discountCode.trim(),
          email: sale.email.trim(),
          branchId,
          items: saleLines
        })
      });
      setDiscountQuote({ code: quote.code, subtotal: quote.subtotal, discountAmount: quote.discountAmount, total: quote.total, quoteKey });
      setDiscountMessage(`Código ${quote.code} aplicado. Ahorras ${money(quote.discountAmount)}.`);
      setStatus("");
    } catch (error) {
      setDiscountQuote(null);
      setDiscountMessage(error instanceof Error ? error.message : "No se pudo validar el descuento.");
    }
  }

  // Generar huella de la solicitud para validación de idempotencia
  // SHA-256 de una estructura estable para repetir una venta de forma segura
  async function generateRequestFingerprint(items: Array<{ productId: number; quantity: number }>, appliedCode?: string, cashReceived?: number): Promise<string> {
    const payload = {
      branchId,
      customer: { name: sale.name, nit: sale.nit, email: sale.email, phone: sale.phone },
      items,
      discountCode: appliedCode ?? null,
      cashReceived: cashReceived ?? null
    };
    const canonicalJson = JSON.stringify(payload);
    const encoder = new TextEncoder();
    const data = encoder.encode(canonicalJson);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 64);
  }

  // Obtener o generar Idempotency-Key para esta venta
  // La clave se deriva del contenido para ser determinista en reintentos
  function getIdempotencyKey(fingerprint: string): string {
    const storageKey = `pos_idempotency_${fingerprint}`;
    let key = sessionStorage.getItem(storageKey);
    if (!key) {
      key = crypto.randomUUID();
      sessionStorage.setItem(storageKey, key);
    }
    return key;
  }

  // Mantener la clave en errores para que un reintento no duplique la venta
  function clearIdempotencyKey(fingerprint: string) {
    const storageKey = `pos_idempotency_${fingerprint}`;
    sessionStorage.removeItem(storageKey);
  }

  async function processSale() {
    try {
      const cashReceived = Number(sale.cashReceived);
      if (!saleLines.length || total <= 0) throw new Error("Agrega al menos un medicamento válido.");
      if (!Number.isFinite(cashReceived) || cashReceived < total) throw new Error("El pago es insuficiente. Debe recibir al menos " + money(total) + ".");

      const items = saleLines.map((line) => ({ ...line }));
      const appliedCode = appliedDiscount?.code;
      const fingerprint = await generateRequestFingerprint(items, appliedCode, cashReceived);
      const idempotencyKey = getIdempotencyKey(fingerprint);

      const headers: Record<string, string> = {
        'Idempotency-Key': idempotencyKey,
        'X-Request-Fingerprint': fingerprint
      };

      const result = await apiRequest("/api/pos/sales", {
        method: "POST",
        body: JSON.stringify({ branchId, customer: { name: sale.name, nit: sale.nit, email: sale.email, phone: sale.phone }, items, cashReceived, ...(appliedCode ? { discountCode: appliedCode } : {}) }),
        headers
      }, token);

      const orderCode = (result as any).order.code;
      const orderId = (result as any).order.id;
      const isReplay = (result as any).idempotentReplay === true;

      clearIdempotencyKey(fingerprint);

      setStatus((isReplay ? "Reintento detectado - " : "Venta procesada exitosamente: ") + orderCode + ". Vuelto: " + money(cashReceived - total));
      setLastSaleOrderId(orderId);
      setQrPayment(null);
      setSaleLines([]);
      setDiscountCode("");
      setDiscountQuote(null);
      setDiscountMessage("");
      setSale((previous) => ({ ...previous, cashReceived: "" }));
      await loadData().catch((error) => {
        setStatus(`Venta ${orderCode} registrada, pero no se pudo actualizar la lista: ${error instanceof Error ? error.message : "error desconocido"}`);
      });
    } catch (error) {
      // En caso de error de red, NO limpiar la clave para permitir reintento
      setStatus(error instanceof Error ? error.message : "Error al procesar venta");
    }
  }

  async function createQrPayment() {
    try {
      if (!saleLines.length || total <= 0) throw new Error("Agrega al menos un medicamento válido.");
      const result = await apiRequest<{ order: { code: string; total: number }; paymentUrl: string }>("/api/pos/qr-payment", {
        method: "POST",
        body: JSON.stringify({
          branchId,
          customer: { name: sale.name, nit: sale.nit, email: sale.email, phone: sale.phone },
          items: saleLines,
          ...(appliedDiscount ? { discountCode: appliedDiscount.code } : {})
        })
      }, token);
      const imageUrl = await QRCode.toDataURL(result.paymentUrl, { width: 280, margin: 2, color: { dark: "#0f172a", light: "#ffffff" } });
      setQrPayment({ orderCode: result.order.code, total: result.order.total, paymentUrl: result.paymentUrl, imageUrl });
      setStatus("QR generado para la orden " + result.order.code + ". Esperando pago del cliente.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No se pudo generar el QR de pago");
    }
  }

  async function releaseOrder(orderId: number) {
    try {
      await apiRequest("/api/pos/orders/" + orderId + "/release", { method: "POST", body: JSON.stringify({ prescriptionDeliveryUrl: null }) }, token);
      setStatus("Orden #" + orderId + " entregada y liberada");
      loadData();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Error al liberar orden");
    }
  }

  async function downloadInvoice(orderId: number) {
    setDownloadingInvoice(true);
    try {
      const response = await fetch((import.meta.env.VITE_API_URL || "http://localhost:4000") + "/api/pos/sales/" + orderId + "/invoice", {
        headers: { Authorization: "Bearer " + token }
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Error descargando la factura");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "factura-pos-" + orderId + ".pdf";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      setStatus("Factura descargada correctamente");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Error descargando factura");
    } finally {
      setDownloadingInvoice(false);
    }
  }

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
              <input value={sale.name} onChange={(event) => setSale({ ...sale, name: event.target.value })} />
            </div>
            <div className="form-field">
              <label>NIT</label>
              <input value={sale.nit} onChange={(event) => setSale({ ...sale, nit: event.target.value })} />
            </div>
            <div className="form-field">
              <label>Correo del cliente</label>
              <input type="email" value={sale.email} onChange={(event) => { setSale({ ...sale, email: event.target.value }); setDiscountMessage(""); }} />
            </div>
          </div>
          <div className="form-grid-2" style={{ marginTop: "0.65rem", marginBottom: "0.35rem" }}>
            <div className="form-field">
              <label>Buscar Medicamento</label>
              <input type="text" placeholder="Nombre, SKU, marca..." value={productSearch} onChange={(event) => setProductSearch(event.target.value)} />
            </div>
            <div className="form-field">
              <label>Filtrar por categoría</label>
              <select value={selectedCategoryId} onChange={(event) => setSelectedCategoryId(event.target.value === "all" ? "all" : Number(event.target.value))}>
                <option value="all">Todas las Categorías ({products.length})</option>
                {(categories ?? []).map((category) => {
                  const allowedIds = getCategoryHierarchyIds(category.id, categories ?? []);
                  const count = products.filter((product) => product.categoryId && allowedIds.includes(product.categoryId)).length;
                  return <option key={category.id} value={category.id}>{category.name} ({count})</option>;
                })}
              </select>
            </div>
          </div>
          {(productSearch || selectedCategoryId !== "all") && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem", fontSize: "0.82rem", color: "var(--text-muted)" }}>
              <span>Mostrando {filteredProducts.length} de {products.length} medicamentos</span>
              <button type="button" className="btn-secondary" style={{ padding: "0.2rem 0.6rem", fontSize: "0.78rem" }} onClick={() => { setProductSearch(""); setSelectedCategoryId("all"); }}>Limpiar búsqueda</button>
            </div>
          )}
          {filteredProducts.length > 0 && (productSearch || selectedCategoryId !== "all") && (
            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.75rem", maxHeight: "120px", overflowY: "auto" }}>
              {filteredProducts.slice(0, 10).map((product) => (
                <button key={product.id} type="button" onClick={() => setSale((previous) => ({ ...previous, productId: product.id }))} style={{ padding: "0.35rem 0.65rem", borderRadius: "var(--radius-sm)", border: product.id === sale.productId ? "2px solid var(--primary)" : "1px solid var(--border)", background: product.id === sale.productId ? "var(--primary-light, #e6fffa)" : "var(--surface)", color: "var(--text-main)", fontSize: "0.78rem", cursor: "pointer", fontWeight: product.id === sale.productId ? 700 : 500 }}>
                  {product.name} · {money(product.price)}
                </button>
              ))}
            </div>
          )}
          <div className="form-field">
            <label>Medicamento para agregar</label>
            <select value={sale.productId} onChange={(event) => setSale({ ...sale, productId: Number(event.target.value) })}>
              {filteredProducts.length === 0
                ? <option value="">No hay medicamentos con los filtros actuales</option>
                : filteredProducts.map((product) => {
                  const category = (categories ?? []).find((item) => item.id === product.categoryId);
                  return <option key={product.id} value={product.id}>{product.name} ({product.sku}) · {category ? `[${category.name}] · ` : ""}{money(product.price)} · Stock: {product.stock}</option>;
                })}
            </select>
          </div>
          {selectedProd && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.85rem", padding: "0.75rem", background: "var(--bg-subtle)", borderRadius: "var(--radius-sm)", cursor: "pointer", border: "1px solid var(--border)" }} onClick={() => setSelectedProductForModal(selectedProd)} title="Haz clic para ver la ficha técnica">
              <div className="cart-item-thumb" style={{ width: "48px", height: "48px" }}>{selectedProd.imageUrl ? <img src={selectedProd.imageUrl} alt={selectedProd.name} /> : <span>Medicamento</span>}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <strong>{selectedProd.name}</strong>
                  <span style={{ fontSize: "0.74rem", color: "var(--primary)", fontWeight: 700 }}>Ver Ficha</span>
                </div>
                <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{selectedProd.brand} · {selectedProd.presentation}</p>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.2rem" }}>
                  <span style={{ color: "var(--primary-dark)", fontWeight: 700 }}>{money(selectedProd.price)} c/u</span>
                  <span style={{ fontSize: "0.8rem", color: selectedProd.stock > 0 ? "#10b981" : "#ef4444", fontWeight: 600 }}>{selectedProd.stock} disponibles</span>
                </div>
              </div>
            </div>
          )}
          <div className="form-grid-2" style={{ alignItems: "end", marginTop: "0.65rem" }}>
            <div className="form-field">
              <label>Cantidad a agregar</label>
              <input type="number" min="1" max={selectedProd?.stock ?? 1} value={sale.quantity} onChange={(event) => setSale({ ...sale, quantity: Number(event.target.value) })} />
            </div>
            <button type="button" className="btn-secondary" onClick={() => addProductToSale()} disabled={!selectedProd || selectedProd.stock < 1}>Agregar medicamento</button>
          </div>

          <div className="panel-head" style={{ marginTop: "1rem" }}>
            <h3>Medicamentos de la venta</h3>
            <span className="pill-tag">{saleLines.length} productos</span>
          </div>
          {saleLines.length === 0 ? <p className="checkout-status-msg">Selecciona medicamentos y agrégalos a la venta.</p> : (
            <div className="item-list-stack">
              {saleLines.map((line) => {
                const product = products.find((candidate) => candidate.id === line.productId);
                if (!product) return null;
                return (
                  <div key={line.productId} className="compact-list-row">
                    <div style={{ flex: 1 }}>
                      <strong>{product.name}</strong>
                      <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>{money(product.price)} c/u · Subtotal {money(product.price * line.quantity)}</p>
                    </div>
                    <label className="form-field" style={{ width: "90px", margin: 0 }}>
                      <span style={{ fontSize: "0.75rem" }}>Cantidad</span>
                      <input type="number" min="1" max={product.stock} value={line.quantity} onChange={(event) => updateSaleQuantity(line.productId, Number(event.target.value))} />
                    </label>
                    <button type="button" className="btn-secondary" aria-label={`Quitar ${product.name}`} onClick={() => { setSaleLines((lines) => lines.filter((item) => item.productId !== line.productId)); setDiscountMessage(""); }}>Quitar</button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="form-grid-2" style={{ alignItems: "end", marginTop: "1rem" }}>
            <div className="form-field">
              <label>Código de descuento</label>
              <input value={discountCode} onChange={(event) => { setDiscountCode(event.target.value.toUpperCase()); setDiscountMessage(""); }} placeholder="Ej. BIENVENIDO10" />
            </div>
            <button type="button" className="btn-secondary" onClick={applyDiscountCode} disabled={!saleLines.length}>Aplicar descuento</button>
          </div>
          {discountMessage && <div className="checkout-status-msg" role="status">{discountMessage}</div>}

          <div className="pos-cash-summary">
            <div><span>Subtotal</span><strong>{money(subtotal)}</strong></div>
            {discountAmount > 0 && <div><span>Descuento ({appliedDiscount?.code})</span><strong>-{money(discountAmount)}</strong></div>}
            <div><span>Total a cobrar</span><strong>{money(total)}</strong></div>
            <div className="form-field">
              <label>Pago recibido (Q)</label>
              <input type="number" min={total} step="0.01" value={sale.cashReceived} onChange={(event) => setSale({ ...sale, cashReceived: event.target.value })} placeholder="Ej. 100" />
            </div>
            <div className="pos-change-row"><span>Vuelto</span><strong>{money(Math.max(0, Number(sale.cashReceived || 0) - total))}</strong></div>
          </div>
          <button type="button" className="btn-primary" onClick={processSale} disabled={!saleLines.length}>Cobrar en efectivo {saleLines.length ? `(${money(total)})` : ""}</button>
          <button type="button" className="btn-secondary pos-qr-button" onClick={createQrPayment} disabled={!saleLines.length}>Generar QR para pago con tarjeta {saleLines.length ? `(${money(total)})` : ""}</button>
          {qrPayment && (
            <div className="pos-qr-card">
              <strong>Orden {qrPayment.orderCode}</strong>
              <p>Total a pagar: <strong>{money(qrPayment.total)}</strong>. El cliente puede escanear el código o abrir la pantalla segura de pago con tarjeta.</p>
              <img src={qrPayment.imageUrl} alt={`QR de pago para ${qrPayment.orderCode}`} />
              <a href={qrPayment.paymentUrl} target="_blank" rel="noreferrer">Abrir pantalla de pago</a>
            </div>
          )}
          {lastSaleOrderId && (
            <div className="pos-invoice-download" style={{ marginTop: "1rem", padding: "1rem", background: "var(--success-light, #ecfdf5)", border: "1px solid var(--success, #10b981)", borderRadius: "var(--radius-md)" }}>
              <strong style={{ color: "var(--success-dark, #065f46)" }}>¡Venta procesada correctamente!</strong>
              <p style={{ margin: "0.5rem 0", color: "var(--text-main)" }}>Genera y descarga la factura PDF de esta venta en efectivo.</p>
              <button type="button" className="btn-primary" onClick={() => downloadInvoice(lastSaleOrderId)} disabled={downloadingInvoice} style={{ width: "100%" }}>{downloadingInvoice ? "Generando factura..." : "Generar factura"}</button>
            </div>
          )}
        </div>
        <div className="panel-card">
          <div className="panel-head"><h2>Órdenes para Retiro en Tienda</h2><span className="pill-tag">{orders.length} pendientes</span></div>
          <div className="item-list-stack">
            {orders.map((order) => (
              <div key={order.id} className="compact-list-row">
                <div><strong>{order.code}</strong><p style={{ fontSize: "0.84rem", color: "var(--text-muted)" }}>{order.customer?.name ?? "Cliente"}</p><small>{money(order.total)} · {order.status}</small></div>
                <button type="button" className="btn-secondary" onClick={() => releaseOrder(order.id)}>Liberar Entrega</button>
              </div>
            ))}
          </div>
          {status && <div className="checkout-status-msg">{status}</div>}
        </div>
      </div>
      <ProductDetailModal
        product={selectedProductForModal}
        categories={categories ?? []}
        branchName={"Sucursal " + branchId}
        onClose={() => setSelectedProductForModal(null)}
        onAddToCart={(productId, quantity) => { addProductToSale(productId, quantity); setSelectedProductForModal(null); }}
        inCartQuantity={selectedProductForModal ? saleLines.find((line) => line.productId === selectedProductForModal.id)?.quantity ?? 0 : 0}
        showInternalInfo={true}
      />
    </div>
  );
}

export default PosPage;
