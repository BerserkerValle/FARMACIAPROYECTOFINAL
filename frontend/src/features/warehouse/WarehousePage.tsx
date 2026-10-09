import { useEffect, useState } from 'react';
import { apiRequest, uploadProductImage } from '../../api';
import type { Branch, Category, ProductCard, Supplier } from '../../types';
import { money, getCategoryHierarchyIds } from '../../lib/catalog';
import { ProductDetailModal } from '../../components/ProductDetailModal';

export function WarehousePage({ token, categories: categoriesProp }: { token: string | null; categories?: Category[] }) {
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

      setStatus(`Medicamento "${newProd.name}" registrado exitosamente con su imagen.`);
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
      setStatus('Lote recibido y registrado en bodega.');
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
            <span>Registrar nuevo medicamento con foto</span>
          </button>
          <button
            type="button"
            className={`section-tab-btn ${activeTab === 'receive-lot' ? 'active' : ''}`}
            onClick={() => setActiveTab('receive-lot')}
          >
            <span>Recepción de Lotes Existentes</span>
          </button>
          <button
            type="button"
            className={`section-tab-btn ${activeTab === 'products-list' ? 'active' : ''}`}
            onClick={() => setActiveTab('products-list')}
          >
            <span>Catálogo ({products.length} productos)</span>
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
                    Generar SKU
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
                <span>Requiere receta médica retenida (Control Sanitario MSPAS)</span>
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
                Subir archivo desde PC
              </button>
              <button
                type="button"
                className={`delivery-toggle-btn ${imageMode === 'url' ? 'active' : ''}`}
                onClick={() => setImageMode('url')}
              >
                Enlace / URL web
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
                      onError={() => setStatus('No se pudo cargar la imagen desde la URL especificada.')}
                    />
                    <button
                      type="button"
                      className="remove-img-btn"
                      onClick={handleClearImage}
                      title="Quitar imagen"
                    >
                      Quitar imagen
                    </button>
                  </>
                ) : (
                  <div style={{ textAlign: 'center', color: 'var(--text-light)' }}>
                    <p style={{ fontSize: '1.8rem', marginBottom: '0.25rem' }}>Sin imagen</p>
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
                          <span>Farmacia FJK</span>
                        </div>
                      )}
                      <div className="product-card-badges-overlay">
                        <span className="badge-sku">{newProd.sku || 'SKU-000'}</span>
                        <span className={`badge-prescription ${newProd.requiresPrescription ? 'rx' : 'otc'}`}>
                          {newProd.requiresPrescription ? 'Con receta' : 'Venta libre'}
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
              {isSubmitting ? 'Guardando...' : 'Guardar y publicar medicamento con foto'}
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
                <label>Buscar Medicamento</label>
                <input
                  type="text"
                  placeholder="Nombre o SKU..."
                  value={lotProductSearch}
                  onChange={(e) => setLotProductSearch(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label>Filtrar por categoría</label>
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
                    <span>Medicamento</span>
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
              {isSubmitting ? 'Procesando...' : 'Registrar Ingreso de Lote'}
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
                          <span>Medicamento</span>
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
                  placeholder="Buscar por nombre, SKU, marca, laboratorio o registro sanitario..."
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
                  <option value="all">Todas las categorías ({products.length})</option>
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
                <span>Venta libre</span>
              </button>
              <button
                type="button"
                className={`filter-pill-btn ${listPrescriptionFilter === 'rx' ? 'active' : ''}`}
                onClick={() => setListPrescriptionFilter('rx')}
              >
                <span>Con receta</span>
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
                  Limpiar filtros
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
                          <span>{p.brand}</span>
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
                            {cat.name}
                          </span>
                        )}
                        <span className={`badge-prescription ${p.requiresPrescription ? 'rx' : 'otc'}`}>
                          {p.requiresPrescription ? 'Con receta' : 'Venta libre'}
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
                        Ver ficha técnica y especificaciones
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
                <button type="button" className="modal-close-btn" onClick={() => setEditingProduct(null)} title="Cerrar">Cerrar</button>
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



export default WarehousePage;
