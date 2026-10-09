import { useEffect, useState } from 'react';
import type { Category, ProductCard } from '../types';
import { money } from '../lib/catalog';

export function ProductDetailModal({
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
          Cerrar
        </button>

        {/* Modal Top Badges Header */}
        <div className="modal-top-bar">
          <div className="modal-header-badges">
            <span className="modal-cat-badge">{categoryName}</span>
            <span className="badge-sku">SKU: {product.sku}</span>
            <span className={`badge-prescription ${product.requiresPrescription ? 'rx' : 'otc'}`}>
              {product.requiresPrescription ? 'Requiere receta médica MSPAS' : 'Venta libre (OTC)'}
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
                <span>Farmacia FJK</span>
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
                    <strong>{product.brand || 'Farmacia FJK'}</strong>
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
                Especificaciones
              </button>
              <button
                type="button"
                className={`modal-tab-btn ${activeTab === 'desc' ? 'active' : ''}`}
                onClick={() => setActiveTab('desc')}
              >
                Uso Terapéutico
              </button>
              <button
                type="button"
                className={`modal-tab-btn ${activeTab === 'lots' ? 'active' : ''}`}
                onClick={() => setActiveTab('lots')}
              >
                Lotes ({product.lots?.length ?? 0})
              </button>
              <button
                type="button"
                className={`modal-tab-btn ${activeTab === 'safety' ? 'active' : ''}`}
                onClick={() => setActiveTab('safety')}
              >
                Normativa & Conservación
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
                        ? 'Medicamento bajo prescripción médica retenida (MSPAS)'
                        : 'Venta libre (OTC) - dispensación directa'}
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
                      <span>Aviso</span>
                      <div>
                        <strong>Medicamento Ético con Receta Obligatoria</strong>
                        <p>De acuerdo con la legislación sanitaria del MSPAS, este medicamento requiere receta médica válida emitida por un profesional de la salud colegiado.</p>
                      </div>
                    </div>
                  )}
                  <div className="storage-card">
                    <h5>Condiciones de Almacenamiento y Conservación</h5>
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
   CLEAN MAIN CATALOG SECTION - Catálogo FARMACIA FJK
   ========================================================================= */


export default ProductDetailModal;