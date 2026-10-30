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

import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ToastProvider, useToast } from './components/ToastProvider';
import { setGlobalErrorHandler, setGlobalRequestHandlers } from './api';
import './styles.css';

// Componente interno para registrar el handler global de errores
function GlobalErrorHandlerRegistrar() {
  const { showToast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const activeRequests = useRef(0);

  const startRequest = useCallback(() => {
    activeRequests.current += 1;
    setIsProcessing(true);
  }, []);

  const finishRequest = useCallback(() => {
    activeRequests.current = Math.max(0, activeRequests.current - 1);
    if (activeRequests.current === 0) setIsProcessing(false);
  }, []);
  
  useEffect(() => {
    setGlobalErrorHandler((message) => showToast('error', message));
    setGlobalRequestHandlers({
      start: startRequest,
      finish: finishRequest,
      success: (message) => showToast('success', message)
    });
    return () => {
      setGlobalErrorHandler(null);
      setGlobalRequestHandlers(null);
    };
  }, [finishRequest, showToast, startRequest]);
  
  return isProcessing ? <div className="request-progress-overlay" role="status" aria-live="polite" aria-busy="true">
    <div className="request-progress-dialog">
      <span className="request-progress-spinner" aria-hidden="true" />
      <strong>Procesando...</strong>
      <span>Espera un momento, estamos completando tu solicitud.</span>
    </div>
  </div> : null;
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