/**
 * ============================================================================
 * PROYECTO FARMACIA - PUNTO DE ENTRADA DEL CLIENTE REACT (FRONTEND)
 * ============================================================================
 * Este archivo inicializa el árbol de componentes React montándolo en el DOM:
 * 1. `createRoot`: API concurrente de React 18+ sobre el elemento contenedor `#root`.
 * 2. `StrictMode`: Modo estricto para detectar efectos secundarios y ciclos inseguros.
 * 3. `BrowserRouter`: Enrutador para navegación mediante URLs amigables (HTML5 History API).
 * 4. `App`: Componente maestro que contiene todos los portales y vistas del sistema.
 * ============================================================================
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

// Montaje del componente raíz en el nodo DOM #root de index.html
createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
