import app from './app.js';
import { store } from './store.js';

const port = Number(process.env.PORT ?? 4000);

async function bootstrap() {
  await store.waitUntilReady();
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Derkas Farmacia API escuchando en http://localhost:${port}`);
  });
}

void bootstrap().catch((error) => {
  console.error('No se pudo iniciar Derkas Farmacia. Verifica PORT y las credenciales de PostgreSQL.', error);
  process.exitCode = 1;
});
