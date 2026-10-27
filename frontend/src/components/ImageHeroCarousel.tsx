import { useState } from 'react';
import type { Portal } from '../types';

const slides = [
  { image: '/banner-salud.png', label: 'Tu salud, nuestra prioridad' },
  { image: '/banner-cuidado.png', label: 'Cuidado personal cada día' },
  { image: '/banner-catalogo.png', label: 'Todo lo que necesitas en un solo lugar' }
];

export function ImageHeroCarousel({ onNavigatePortal }: { onNavigatePortal: (portal: Portal) => void }) {
  const [currentSlide, setCurrentSlide] = useState(0);
  function openCatalog() {
    onNavigatePortal('public');
    window.requestAnimationFrame(() => document.getElementById('catalogo-medicamentos')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  return <section className="hero-carousel" aria-label="Banners promocionales">
    <div className="carousel-container">
      <div className="carousel-track image-banner-track" style={{ transform: `translateX(-${currentSlide * 100 / slides.length}%)` }}>
        {slides.map((slide) => <div key={slide.image} className="carousel-slide image-banner-slide" style={{ backgroundImage: `url('${slide.image}')` }}>
          <button type="button" className="banner-image-hitarea" onClick={openCatalog} aria-label={`${slide.label}. Abrir catálogo`} />
        </div>)}
      </div>
      <div className="carousel-dots" role="tablist">{slides.map((slide, index) => <button key={slide.image} type="button" className={`carousel-dot ${index === currentSlide ? 'active' : ''}`} onClick={() => setCurrentSlide(index)} aria-label={`Banner ${index + 1}: ${slide.label}`} />)}</div>
      <button type="button" className="carousel-arrow prev" onClick={() => setCurrentSlide((currentSlide - 1 + slides.length) % slides.length)} aria-label="Banner anterior">{String.fromCharCode(60)}</button>
      <button type="button" className="carousel-arrow next" onClick={() => setCurrentSlide((currentSlide + 1) % slides.length)} aria-label="Banner siguiente">{String.fromCharCode(62)}</button>
    </div>
  </section>;
}
