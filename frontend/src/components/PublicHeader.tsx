import { useState } from 'react';
import type { Branch, Category, CustomerAccount, EmployeeProfile, Portal, ProductCard } from '../types';
import { getEmployeePortals } from '../lib/employeePortals';

export type PublicHeaderProps = {
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
  categories: Category[];
  onCategorySelect: (categoryId: number | 'all') => void;
  onQueryChange: (query: string) => void;
  minPrice: number | '';
  maxPrice: number | '';
  onMinPriceChange: (value: number | '') => void;
  onMaxPriceChange: (value: number | '') => void;
  onOpenCheckout: () => void;
};

export function TopHeader({ branches, branchId, onSelectBranch, cartCount, cartTotal, activePortal, onNavigatePortal, token, profile, onLogout, customer, categories, onCategorySelect, onQueryChange, minPrice, maxPrice, onMinPriceChange, onMaxPriceChange, onOpenCheckout }: PublicHeaderProps) {
  const [query, setQuery] = useState('');
  const [showCategories, setShowCategories] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const isClientPortal = activePortal === 'public' || activePortal === 'pos';
  const showCatalogSearch = isClientPortal || (activePortal === 'customer' && Boolean(customer));
  const showCatalogSubnav = showCatalogSearch;
  const employeePortals = profile ? getEmployeePortals(profile.role) : [];
  function submit(event: React.FormEvent) { event.preventDefault(); if (query.trim()) { onQueryChange(query); onNavigatePortal('public'); } }
  return <header className="top-header">
    <div className="header-main"><div className="header-main-inner">
      <div className="header-brand"><button type="button" className="brand-icon" onClick={() => onNavigatePortal('login')} title="Acceso Empleados" aria-label="Acceso empleados"><img src="/fjk-logo.jpeg" alt="Logo FJK Farmacia" /></button><div className="brand-text" onClick={() => onNavigatePortal('public')}><h1>FARMACIA FJK</h1><span>Tu farmacia de confianza</span></div></div>
      {showCatalogSearch && <div className="header-search"><form onSubmit={submit} className="search-form"><svg className="search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg><input type="search" className="search-input" placeholder="Buscar medicamentos, marcas, principios activos..." value={query} onChange={(event) => setQuery(event.target.value)} /></form></div>}
      <div className={`header-actions ${token && profile ? 'has-portal-nav' : ''}`}>{token && profile && <nav className="portal-nav-pills" aria-label="Portales internos">{employeePortals.map((portal) => <button key={portal} type="button" className={`portal-nav-pill ${activePortal === portal ? 'active' : ''}`} onClick={() => onNavigatePortal(portal)}>{portal === 'public' ? 'Catálogo' : portal === 'warehouse' ? 'Bodega' : portal === 'delivery' ? 'Reparto' : portal === 'pos' ? 'POS' : 'Admin'}</button>)}</nav>}
        {activePortal === 'public' && <button type="button" className="cart-btn" onClick={onOpenCheckout} aria-label={`Carrito: ${cartCount} artículos`}><span>Carrito ({cartCount})</span><strong>Q. {cartTotal.toFixed(2)}</strong></button>}
        <div className="user-menu">{token && profile ? <button type="button" className="user-btn" onClick={onLogout}>{profile.fullName} <small>{profile.role}</small></button> : customer ? <button type="button" className="user-btn" onClick={() => onNavigatePortal('customer')}>{customer.fullName} <small>Mi cuenta</small></button> : <button type="button" className="user-btn login-btn" onClick={() => onNavigatePortal('customer')}>Iniciar Sesión</button>}</div>
      </div>
    </div></div>
    {showCatalogSubnav && <nav className="header-subnav" aria-label="Navegación principal"><div className="subnav-inner">
      <div className="subnav-dropdown"><button type="button" className="subnav-item" onClick={() => setShowCategories(!showCategories)} aria-expanded={showCategories}>Categorías</button>{showCategories && <div className="category-dropdown-menu"><button type="button" className="category-dropdown-item" onClick={() => { onCategorySelect('all'); setShowCategories(false); onNavigatePortal('public'); }}>Todas las categorías</button>{categories.map((category) => <button key={category.id} type="button" className="category-dropdown-item" onClick={() => { onCategorySelect(category.id); setShowCategories(false); onNavigatePortal('public'); }}>{category.name}</button>)}</div>}</div>
      {!token && !profile && <button type="button" className="subnav-item" onClick={() => setShowContact(true)}>Contáctenos</button>}
      {isClientPortal && <div className="subnav-price-filter-desktop"><label>Precio:</label><input type="number" placeholder="Mín" value={minPrice} onChange={(event) => onMinPriceChange(event.target.value ? Number(event.target.value) : '')} /><span>-</span><input type="number" placeholder="Máx" value={maxPrice} onChange={(event) => onMaxPriceChange(event.target.value ? Number(event.target.value) : '')} /></div>}
      {activePortal === 'public' && branches.length > 0 && <select className="subnav-branch-dropdown" value={branchId} onChange={(event) => onSelectBranch(Number(event.target.value))}>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name} ({branch.city})</option>)}</select>}
    </div></nav>}
    {showContact && <div className="modal-backdrop" onClick={() => setShowContact(false)}>
      <section className="contact-modal" role="dialog" aria-modal="true" aria-labelledby="contact-modal-title" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close-btn" onClick={() => setShowContact(false)} aria-label="Cerrar contacto">×</button>
        <header className="contact-modal-header">
          <div className="contact-modal-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 3.9a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z" />
            </svg>
          </div>
          <h2 id="contact-modal-title">Estamos para ayudarte</h2>
          <p>Comunícate con tu sucursal más cercana.</p>
        </header>
        <div className="contact-modal-body">
          <div className="contact-info-grid">
            <div className="contact-info-item">
              <span className="contact-info-icon" aria-hidden="true">J</span>
              <div><h4>Jocotenango</h4><a href="tel:+50246932765">+502 4693 2765</a></div>
            </div>
            <div className="contact-info-item">
              <span className="contact-info-icon" aria-hidden="true">A</span>
              <div><h4>Antigua Guatemala</h4><a href="tel:+50248938771">+502 4893 8771</a></div>
            </div>
            <div className="contact-info-item">
              <span className="contact-info-icon" aria-hidden="true">P</span>
              <div><h4>Pastores</h4><a href="tel:+50231043531">+502 3104 3531</a></div>
            </div>
            <div className="contact-info-item">
              <span className="contact-info-icon" aria-hidden="true">X</span>
              <div><h4>Xela</h4><address>Parqueo Interplaza Xela</address></div>
            </div>
          </div>
          <div className="contact-social">
            <h4>Síguenos en redes sociales</h4>
            <a className="contact-facebook-link" href="https://www.facebook.com/profile.php?id=61575011542133&amp;locale=es_LA" target="_blank" rel="noopener noreferrer">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.5 21v-8.2h2.8l.4-3.2h-3.2v-2c0-.9.3-1.6 1.6-1.6h1.7V3.1c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.3H7.3v3.2h2.8V21h3.4z" /></svg>
              Visitar nuestra página de Facebook
            </a>
          </div>
        </div>
      </section>
    </div>}
  </header>;
}

export function HeroCarousel({ onNavigatePortal, products }: { onNavigatePortal: (portal: Portal) => void; products?: ProductCard[] }) {
  const [currentSlide, setCurrentSlide] = useState(0);

  // Seleccionar hasta 3 productos distintos del catálogo
  const highlightedProducts = products?.filter(p => p.imageUrl || (p.discountPercent && p.discountPercent > 0)) || [];
  // Si hay 3 o más, tomar los primeros 3; si hay 1 o 2, tomar todos los disponibles
  const productsToShow = highlightedProducts.slice(0, 3);
  // Asegurar que siempre haya 3 productos (rellenar con el primero si hace falta)
  while (productsToShow.length < 3) {
    const first = products?.[0];
    if (first && !productsToShow.includes(first)) {
      productsToShow.push(first);
    } else {
      // Agadir un objeto genérico si no hay más productos
      productsToShow.push({ name: 'Medicamento', brand: 'Farmacia FJK', presentation: '', discountPercent: 0, imageUrl: '', description: '', laboratory: '', requiresPrescription: false, stock: 0 } as ProductCard);
    }
  }

  const slides = productsToShow.map((product, productIndex) => {
    const p = product;
    return [
      p.name,
      `${p.brand} · ${p.presentation}`,
      'Ver en Catálogo'
    ];
  });

  return <section className="hero-carousel" aria-label="Banners promocionales"><div className="carousel-container"><div className="carousel-track" style={{ transform: `translateX(-${currentSlide * 100}%)` }}>{slides.map((item, index) => { const product = productsToShow[index]; return <div key={index} className="carousel-slide" style={{ background: product && product.imageUrl ? `url('${product.imageUrl}'), linear-gradient(135deg, var(--cv-green) 0%, #007a2e 100%)` : 'linear-gradient(135deg, var(--cv-green) 0%, #007a2e 100%)', backgroundSize: 'cover', backgroundPosition: 'center' }}><div className="slide-overlay" /><div className="slide-content"><div className="slide-text"><h2>{item[0]}</h2><p>{item[1]}</p></div><button type="button" className="slide-cta" onClick={() => onNavigatePortal('public')}>{item[2]}</button></div><div className="slide-brand-lockup"><img src="/fjk-logo.jpeg" alt="FJK Farmacia" /><span>Tu farmacia de confianza</span></div></div>; })}</div><div className="carousel-dots" role="tablist">{slides.map((_, index) => <button key={index} type="button" className={`carousel-dot ${index === currentSlide ? 'active' : ''}`} onClick={() => setCurrentSlide(index)} aria-label={`Banner ${index + 1}`} />)}</div><button type="button" className="carousel-arrow prev" onClick={() => setCurrentSlide((currentSlide - 1 + slides.length) % slides.length)} aria-label="Banner anterior">{String.fromCharCode(60)}</button><button type="button" className="carousel-arrow next" onClick={() => setCurrentSlide((currentSlide + 1) % slides.length)} aria-label="Banner siguiente">{String.fromCharCode(62)}</button></div></section>;
}
