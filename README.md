# Farmacia los pollos hermanos

Proyecto fullstack para farmacia con backend en Express/TypeScript y frontend en React/Vite.

## Módulos
- Portal público de catálogo y checkout con Stripe
- Panel POS para cajero
- Panel de bodega
- Panel de repartidor
- Consola gerencial y administrativa
- Acceso interno por correo y contraseña contra `Empleados`
- Persistencia PostgreSQL para Render cuando existe `DATABASE_URL` o `PGHOST`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`

## Ejecutar
1. Instalar dependencias en root, backend y frontend.
2. Configurar variables de entorno.
3. Levantar backend y frontend.

## Variables de entorno backend
- `PORT=4000`
- `DATABASE_URL=postgresql://...` (preferida en Render; no la subas al repositorio)
- Alternativa: `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGSSL=require`
- También acepta las variables usadas en tu servicio Render: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.
- `STRIPE_SECRET_KEY=...`
- `STRIPE_WEBHOOK_SECRET=...`
- `APP_BASE_URL=http://localhost:5173`
- `API_BASE_URL=http://localhost:4000`

## Variables de entorno frontend
- `VITE_API_URL=http://localhost:4000`

## Stripe Checkout

El checkout crea una orden pendiente y, cuando existe `STRIPE_SECRET_KEY`, crea una sesión real de Stripe Checkout. El navegador se redirige automáticamente a `paymentUrl`.

Configura en Render:

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
APP_BASE_URL=https://farmaciaproyectofinalf.onrender.com
API_BASE_URL=https://farmaciaproyectofinalweb.onrender.com
```

En Stripe crea un webhook con esta URL:

```text
https://farmaciaproyectofinalweb.onrender.com/api/webhooks/stripe
```

Selecciona el evento `checkout.session.completed`. El webhook valida la firma y marca el pedido como pagado. No pongas claves `sk_` ni `whsec_` en el frontend ni en el repositorio.

## Despliegue en Render

1. Crea un Web Service para `backend` usando `npm install && npm run build --workspace backend` y `npm run start --workspace backend`.
2. Configura `PORT` con el puerto asignado por Render, `JWT_SECRET` con un secreto nuevo y las variables PostgreSQL del panel de Render.
3. Crea un Static Site para `frontend` usando `npm install && npm run build --workspace frontend`, publicando `frontend/dist`.
4. Define `VITE_API_URL` con la URL pública del Web Service del backend y `APP_BASE_URL` con la URL pública del frontend.
5. La primera ejecución crea automáticamente la tabla `pharmacy_state` como respaldo de desarrollo. Para el acceso interno se consulta directamente la tabla `Empleados` del esquema PostgreSQL.

No incluyas credenciales de PostgreSQL en archivos `.env` versionados, capturas, frontend ni código fuente. Como las credenciales fueron compartidas en este chat, conviene regenerar la contraseña desde Render antes de producción.

## API disponible

Todas las respuestas usan `{ success, data }`. Las rutas internas requieren `Authorization: Bearer <JWT>`.

| Módulo | GET | POST | PUT | DELETE |
| --- | --- | --- | --- | --- |
| Auth | `/api/auth/me` | `/api/auth/login` | - | - |
| Público | `/api/public/branches`, `/categories`, `/suppliers`, `/catalog`, `/orders/:id`, `/orders/code/:code` | `/api/public/checkout`, `/prescriptions/temp`, `/orders/prescription` | - | - |
| POS | `/api/pos/pickup-orders` | `/api/pos/sales`, `/orders/:id/release` | - | - |
| Bodega | `/api/warehouse/lots`, `/products`, `/categories`, `/suppliers` | `/receive`, `/products`, `/products/upload-image` | `/products/:id` | `/products/:id` |
| Administración | `/api/admin/dashboard`, `/reports`, `/employees`, `/branches`, `/categories`, `/suppliers`, `/products` | CRUD de empleados, sucursales, categorías, proveedores y productos; `/orders/:id/crosscheck`, `/orders/:id/returns` | CRUD de empleados, sucursales, categorías, proveedores y productos | CRUD de empleados, sucursales, categorías, proveedores y productos |

El acceso interno no usa JWT: el backend valida `correo_corporativo` y `contrasena` en `Empleados`, y las rutas internas reciben `X-Employee-Id` después del login. La persistencia de Render usa las tablas reales del esquema para autenticación.
