import { useState } from 'react';
import { ProductDetailModal } from '../../components/ProductDetailModal';
import type { Branch, Category, ProductCard } from '../../types';
import { getCategoryHierarchyIds, money } from '../../lib/catalog';

export function PublicCatalogView({
  branches,
  branchId,
  categories,
  products,
  cart,
  onAddToCart,
  toastMessage,
  minPrice,
  maxPrice,
  onMinPriceChange,
  onMaxPriceChange,
  selectedCategoryId,
  onCategorySelect,
  query,
  onQueryChange
}: {
  branches: Branch[];
  branchId: number;
  categories: Category[];
  products: ProductCard[];
  cart: Array<{ productId: number; quantity: number }>;
  onAddToCart: (productId: number, quantity?: number) => void;
  toastMessage: string | null;
  minPrice: number | '';
  maxPrice: number | '';
  onMinPriceChange: (value: number | '') => void;
  onMaxPriceChange: (value: number | '') => void;
  selectedCategoryId: number | 'all';
  onCategorySelect: (categoryId: number | 'all') => void;
  query: string;
  onQueryChange: (query: string) => void;
}) {
  const [recentlyAddedId, setRecentlyAddedId] = useState<number | null>(null);
  const [selectedProductForModal, setSelectedProductForModal] = useState<ProductCard | null>(null);

  const selectedBranch = branches.find((b) => b.id === branchId);

  // Price filtering is handled by the backend; category filtering is hierarchical here.
  const filteredProducts = products.filter((product) => {
    if (selectedCategoryId !== 'all') {
      const allowedCategoryIds = getCategoryHierarchyIds(selectedCategoryId, categories);
      if (!product.categoryId || !allowedCategoryIds.includes(product.categoryId)) return false;
    }
    return true;
  });

  const handleAdd = (e: React.MouseEvent, productId: number) => {
    e.stopPropagation();
    onAddToCart(productId, 1);
    setRecentlyAddedId(productId);
    setTimeout(() => setRecentlyAddedId(null), 1200);
  };

  const activeInCartItem = selectedProductForModal
    ? cart.find((i) => i.productId === selectedProductForModal.id)
    : null;

  return (
    <main className="catalog-layout">
      <div className="catalog-control-bar">
        <div className="catalog-header-row">
          <div className="catalog-title-block">
            <h2>Catálogo de Medicamentos</h2>
            <p>
              Inventario disponible en{' '}
              <strong>{selectedBranch ? `${selectedBranch.name}, ${selectedBranch.city}` : 'Sucursal'}</strong>
            </p>
          </div>
        </div>

        {(selectedCategoryId !== 'all' || query) && (
          <div className="filter-pills-row" style={{ marginTop: '0.5rem', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn-secondary"
              style={{ padding: '0.4rem 0.9rem', fontSize: '0.82rem', borderRadius: 'var(--radius-full)' }}
              onClick={() => {
                onCategorySelect('all');
                onQueryChange('');
              }}
            >
              Limpiar filtros
            </button>
          </div>
        )}
      </div>

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
                    <div className="product-img-fallback" style={{ display: product.imageUrl ? 'none' : 'flex' }}>
                      <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10.5 20.5l10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" />
                        <path d="m8.5 8.5 7 7" />
                      </svg>
                      <span>{product.brand || 'Farmacia FJK'}</span>
                    </div>

                    <div className="product-card-badges-overlay">
                      <span className="badge-sku">{product.sku}</span>
                      {productCategory && (
                        <span
                          className="badge-sku"
                          style={{ background: 'rgba(15, 23, 42, 0.75)', cursor: 'pointer' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onCategorySelect(productCategory.id);
                          }}
                          title={`Filtrar por ${productCategory.name}`}
                        >
                          {productCategory.name}
                        </span>
                      )}
                      <span className={`badge-prescription ${product.requiresPrescription ? 'rx' : 'otc'}`}>
                        {product.requiresPrescription ? 'Con receta' : 'Venta libre'}
                      </span>
                    </div>
                  </div>

                  <div className="product-content">
                    <span className="product-brand">
                      {productCategory ? `${productCategory.name} · ` : ''}{product.brand} · {product.laboratory}
                    </span>
                    <h3 className="product-name">{product.name}</h3>
                    {product.presentation && <span className="product-presentation">{product.presentation}</span>}
                    <p className="product-desc">{product.description}</p>
                    <span className="quick-view-badge">Ver especificaciones y detalles completos</span>
                  </div>
                </div>

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
                      <span>✓ Agregado a la forma de pago arriba</span>
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

      <ProductDetailModal
        product={selectedProductForModal}
        categories={categories}
        branchName={selectedBranch ? `${selectedBranch.name} (${selectedBranch.city})` : undefined}
        onClose={() => setSelectedProductForModal(null)}
        onAddToCart={(id, quantity) => onAddToCart(id, quantity)}
        inCartQuantity={activeInCartItem?.quantity ?? 0}
      />

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

export default PublicCatalogView;
