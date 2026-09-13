/**
 * ============================================================================
 * PROYECTO FARMACIA - PUNTO DE ENTRADA DEL SERVIDOR (BOOTSTRAP)
 * ============================================================================
 * Este archivo inicializa y arranca el servidor HTTP de Node.js:
 * 1. Espera a que el almacén de datos (`store.waitUntilReady()`) complete su
 *    conexión e inicialización (migraciones de PostgreSQL o carga del snapshot local).
 * 2. Inicia la escucha de peticiones en el puerto configurado (default: 4000).
 * 3. Captura y reporta cualquier error fatal durante el arranque del proceso.
 * ============================================================================
 */

import app from './app.js';
import { store } from './store.js';

// Puerto de ejecución obtenido de variables de entorno (por defecto 4000)
const port = Number(process.env.PORT ?? 4000);

/**
 * Función de inicialización asíncrona (Bootstrap).
 * Garantiza que la persistencia y la base de datos estén listas antes de aceptar conexiones.
 */
async function bootstrap() {
  // Espera la conexión con PostgreSQL o lectura de datos locales
  await store.waitUntilReady();
  
  // Puesta en marcha del servidor Express
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Derkas Farmacia API escuchando en http://localhost:${port}`);
  });
}

// Ejecución con captura de excepciones no controladas en el ciclo inicial
void bootstrap().catch((error) => {
  console.error('No se pudo iniciar Derkas Farmacia. Verifica PORT y las credenciales de PostgreSQL.', error);
  process.exitCode = 1;
});
