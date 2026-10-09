import { useState } from 'react';
import type { Branch, Category, CustomerAccount, EmployeeProfile, Portal } from '../types';

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
  function submit(event: React.FormEvent) { event.preventDefault(); if (query.trim()) { onQueryChange(query); onNavigatePortal('public'); } }
  return <header className="top-header">
    <div className="header-main"><div className="header-main-inner">
      <div className="header-brand"><div className="brand-icon" onClick={() => onNavigatePortal('login')} role="button" tabIndex={0} title="Acceso Empleados" aria-label="Acceso empleados"><span>+</span></div><div className="brand-text" onClick={() => onNavigatePortal('public')}><h1>FARMACIA FJK</h1><span>Tu farmacia de confianza</span></div></div>
      <div className="header-search"><form onSubmit={submit} className="search-form"><input type="search" className="search-input" placeholder="Buscar medicamentos, marcas, principios activos..." value={query} onChange={(event) => setQuery(event.target.value)} /><button type="submit" className="search-btn" aria-label="Buscar">Buscar</button></form></div>
      <div className="header-actions">{token && profile && <nav className="portal-nav-pills" aria-label="Portales internos">{(['public', 'pos', 'warehouse', 'delivery', 'admin'] as const).map((portal) => <button key={portal} type="button" className={`portal-nav-pill ${activePortal === portal ? 'active' : ''}`} onClick={() => onNavigatePortal(portal)}>{portal === 'public' ? 'Catálogo' : portal === 'warehouse' ? 'Bodega' : portal === 'delivery' ? 'Reparto' : portal === 'pos' ? 'POS' : 'Admin'}</button>)}</nav>}
        {activePortal === 'public' && <button type="button" className="cart-btn" onClick={onOpenCheckout} aria-label={`Carrito: ${cartCount} artículos`}><span>Carrito ({cartCount})</span><strong>Q. {cartTotal.toFixed(2)}</strong></button>}
        <div className="user-menu">{token && profile ? <button type="button" className="user-btn" onClick={onLogout}>{profile.fullName} <small>{profile.role}</small></button> : customer ? <button type="button" className="user-btn" onClick={() => onNavigatePortal('customer')}>{customer.fullName} <small>Mi cuenta</small></button> : <button type="button" className="user-btn login-btn" onClick={() => onNavigatePortal('customer')}>Iniciar Sesión</button>}</div>
      </div>
    </div></div>
    <nav className="header-subnav" aria-label="Navegación principal"><div className="subnav-inner">
      <div className="subnav-dropdown"><button type="button" className="subnav-item" onClick={() => setShowCategories(!showCategories)} aria-expanded={showCategories}>Categorías</button>{showCategories && <div className="category-dropdown-menu"><button type="button" className="category-dropdown-item" onClick={() => { onCategorySelect('all'); setShowCategories(false); onNavigatePortal('public'); }}>Todas las categorías</button>{categories.map((category) => <button key={category.id} type="button" className="category-dropdown-item" onClick={() => { onCategorySelect(category.id); setShowCategories(false); onNavigatePortal('public'); }}>{category.name}</button>)}</div>}</div>
      {isClientPortal && <button type="button" className="subnav-item batres-accent" onClick={() => onNavigatePortal('public')}>Descuentos</button>}
      {!token && !profile && <button type="button" className="subnav-item" onClick={() => setShowContact(true)}>Contáctenos</button>}
      {isClientPortal && <div className="subnav-price-filter-desktop"><label>Precio:</label><input type="number" placeholder="Mín" value={minPrice} onChange={(event) => onMinPriceChange(event.target.value ? Number(event.target.value) : '')} /><span>-</span><input type="number" placeholder="Máx" value={maxPrice} onChange={(event) => onMaxPriceChange(event.target.value ? Number(event.target.value) : '')} /></div>}
      {activePortal === 'public' && branches.length > 0 && <select className="subnav-branch-dropdown" value={branchId} onChange={(event) => onSelectBranch(Number(event.target.value))}>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name} ({branch.city})</option>)}</select>}
    </div></nav>
    {showContact && <div className="modal-backdrop" onClick={() => setShowContact(false)}><div className="contact-modal" onClick={(event) => event.stopPropagation()}><button type="button" className="modal-close-btn" onClick={() => setShowContact(false)}>Cerrar</button><h2>Contáctenos</h2><p>Teléfono: +502 2XXX XXXX</p><p>contacto@farmaciafjk.com</p><p>Ciudad de Guatemala, Guatemala</p></div></div>}
  </header>;
}

export function HeroCarousel({ onNavigatePortal }: { onNavigatePortal: (portal: Portal) => void }) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const slides = [
    ['Bienvenido a FARMACIA FJK', 'Tu farmacia de confianza con los mejores precios', 'Ver Ofertas'],
    ['Descuentos que Cuidan tu Bolsillo', 'Hasta 40% OFF en medicamentos seleccionados', 'Ver Descuentos'],
    ['Servicios Farmacéuticos', 'Asesoría, control y seguimiento especializado', 'Conocer Servicios'],
    ['Entrega a Domicilio', 'Recibe tus medicamentos en la puerta de tu casa', 'Comprar Ahora']
  ];
  const slide = slides[currentSlide];
  return <section className="hero-carousel" aria-label="Banners promocionales"><div className="carousel-container"><div className="carousel-track" style={{ transform: `translateX(-${currentSlide * 100}%)` }}>{slides.map((item, index) => <div key={item[0]} className="carousel-slide" style={{ background: 'linear-gradient(135deg, var(--cv-green) 0%, #007a2e 100%)' }}><div className="slide-content"><div className="slide-text"><h2>{item[0]}</h2><p>{item[1]}</p></div><button type="button" className="slide-cta" onClick={() => onNavigatePortal('public')}>{item[2]}</button></div></div>)}</div><div className="carousel-dots" role="tablist">{slides.map((item, index) => <button key={item[0]} type="button" className={`carousel-dot ${index === currentSlide ? 'active' : ''}`} onClick={() => setCurrentSlide(index)} aria-label={`Banner ${index + 1}`} />)}</div><button type="button" className="carousel-arrow prev" onClick={() => setCurrentSlide((currentSlide - 1 + slides.length) % slides.length)} aria-label="Banner anterior">&lt;</button><button type="button" className="carousel-arrow next" onClick={() => setCurrentSlide((currentSlide + 1) % slides.length)} aria-label="Banner siguiente">&gt;</button></div></section>;
}
