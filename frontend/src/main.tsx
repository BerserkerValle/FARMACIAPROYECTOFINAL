/**
 * ============================================================================
 * PROYECTO FARMACIA - PUNTO DE ENTRADA DEL CLIENTE REACT (FRONTEND)
 * ============================================================================
 * Este archivo inicializa el árbol de componentes React montándolo en el DOM:
 * 1. `createRoot`: API concurrente de React 18+ sobre el elemento contenedor `#root`.
 * 2. `StrictMode`: Modo estricto para detectar efectos secundarios y ciclos inseguros.
 * 3. `BrowserRouter`: Enrutador para navegación mediante URLs amigables (HTML5 History API).
 * 4. `ToastProvider`: Sistema global de notificaciones (toasts) para FARMACIA FJK.
 * 5. `App`: Componente maestro que contiene todos los portales y vistas del sistema.
 * ============================================================================
 */

import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ToastProvider, useToast } from './components/ToastProvider';
import { setGlobalErrorHandler } from './api';
import './styles.css';

// Componente interno para registrar el handler global de errores
function GlobalErrorHandlerRegistrar() {
  const { error: showError } = useToast();
  
  useEffect(() => {
    setGlobalErrorHandler(showError);
    return () => setGlobalErrorHandler(null);
  }, [showError]);
  
  return null;
}

// Montaje del componente raíz en el nodo DOM #root de index.html
createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <GlobalErrorHandlerRegistrar />
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>
);