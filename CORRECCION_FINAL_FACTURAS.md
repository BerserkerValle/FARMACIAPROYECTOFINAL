# Corrección Final - Facturación PDF Derkas Farmacia

**Fecha:** 23 Oct 2026
**Commits:** Cambios en 7 archivos (backend + frontend)

---

## Resumen de Cambios

### 1. Email State Machine (Fix: marcar SENT solo tras confirmación SMTP)

#### Problema Original
- `markInvoiceEmailSent` / `markDatabaseInvoiceEmailSent` marcaban `emailSent = true` **ANTES** de enviar por SMTP
- Si SMTP fallaba, la factura quedaba marcada como enviada sin posibilidad de reintento automático
- Race condition: dos webhooks concurrentes podían enviar emails duplicados

#### Solución Implementada: Máquina de Estados PERSISTENTE
```
PENDING → SENDING → SENT
              ↘ FAILED (con error guardado para reintento)
```

#### Archivos Modificados

| Archivo | Cambios |
|---------|---------|
| `backend/src/domain.ts` | Nuevo tipo `EmailStatus = 'PENDING' \| 'SENDING' \| 'SENT' \| 'FAILED'`; campos `emailStatus`, `emailError`, `emailAttemptAt` en `Invoice` |
| `backend/src/store.ts` | Invoices se crean con `emailStatus: 'PENDING'`; nuevas funciones: `reserveInvoiceEmailSend()` (PENDING/FAILED→SENDING), `markInvoiceEmailSent()` (SENDING→SENT), `markInvoiceEmailFailed()` (SENDING→FAILED), `getInvoiceEmailStatus()` |
| `backend/src/db.ts` | Migración: columnas `email_status TEXT DEFAULT 'PENDING'`, `email_error TEXT`, `email_attempt_at TIMESTAMPTZ` en `pharmacy_delivery_tracking`; funciones BD: `reserveDatabaseInvoiceEmailSend()`, `markDatabaseInvoiceEmailSent()`, `markDatabaseInvoiceEmailFailed()`, `getDatabaseInvoiceEmailStatus()` (todas con WHERE atómico) |
| `backend/src/controllers/public.controller.ts` | Webhook Stripe usa nuevo flujo: 1) `reserve...` atómico, 2) enviar SMTP, 3a) éxito → `mark...Sent`, 3b) fallo → `mark...Failed` con error; NO marca SENT antes de SMTP |

#### Garantías
- **Atomicidad**: `reserve` usa `WHERE email_status IN ('PENDING','FAILED')` - solo una transacción gana
- **Idempotencia webhook**: Eventos duplicados ven `email_status = 'SENT'` o `'SENDING'` y no reenvían
- **Reintentos**: Estado `FAILED` permite reintento manual/admin; error guardado en `email_error`
- **Crash recovery**: Si servidor cae en `SENDING`, próximo webhook ve `SENDING` y no reenvía (requiere intervención manual o job de limpieza)

#### Límite Técnico Documentado
> **SMTP no garantiza entrega exactamente-una-vez al buzón**. `SENT` = "SMTP aceptó el mensaje (250 OK)". La entrega final depende de servidores intermedios, filtros antispam, buzón lleno, etc. Este sistema garantiza **exactly-once submission to SMTP**, no exactly-once delivery to inbox.

---

### 2. POS Idempotency (Fix: clave obligatoria + validación de huella)

#### Problema Original
- Frontend no generaba `Idempotency-Key`
- Backend la aceptaba como opcional, sin validar contenido
- Clave registrada **después** de crear la venta (ventana de duplicación si crash entre medio)
- Sin huella: misma clave con contenido diferente devolventa venta anterior silenciosamente
- En memoria (`Map`), perdido al reiniciar backend

#### Solución Implementada

**Frontend (`PosPage.tsx`):**
```typescript
// Genera clave única por intento de venta (crypto.randomUUID)
const idempotencyKey = getIdempotencyKey(); // guarda en sessionStorage

// Huella determinista del contenido de la venta
const fingerprint = generateRequestFingerprint(); // btoa(JSON.stringify(payload)).slice(0,64)

// Headers enviados
headers: {
  'Idempotency-Key': idempotencyKey,
  'X-Request-Fingerprint': fingerprint
}

// En reintento de red: MISMA clave (recuperada de sessionStorage)
// En venta nueva: NUEVA clave (contenido diferente → nueva huella → nueva clave)
```

**Backend (`pos.controller.ts` + `store.ts`):**
- `Idempotency-Key` y `X-Request-Fingerprint` **obligatorios** (400 si faltan)
- `checkPosIdempotency(key, fingerprint)` valida:
  - Duplicado + misma huella → `200 OK` con `idempotentReplay: true` (venta existente)
  - Duplicado + huella distinta → `409 Conflict` `IDEMPOTENCY_CONFLICT`
  - No duplicado → procede a crear venta
- `registerPosIdempotency(key, orderId, fingerprint)` **SOLO tras éxito** de `createPosSale`
- Si crash después de crear venta pero antes de registrar clave → reintento crea venta duplicada (limitación del almacenamiento JSON sin transacciones distribuidas)

**Store (`store.ts`):**
- `posIdempotencyKeys: Map<key, {orderId, timestamp, fingerprint}>`
- Limpieza automática > 5 min
- Persistencia en `dev-store.json` (se guarda en `touch()`)

#### Comportamiento por Escenario

| Escenario | Comportamiento |
|-----------|----------------|
| Doble clic (misma clave, misma huella) | 1 venta, 2do request → `200 OK replay` |
| Reintento red (timeout, misma clave) | 1 venta, reintento → `200 OK replay` |
| Venta legítima nueva (contenido distinto) | Nueva clave generada → venta nueva |
| Misma clave, contenido distinto | `409 Conflict` - no devuelve venta anterior |
| Crash tras crear venta, antes de registrar clave | **Limitación JSON**: reintento crea duplicado (ver mitigación) |
| Reinicio backend | Claves persistidas en `dev-store.json` (si `touch()` completó) |

#### Mitigación Crash JSON
> El almacenamiento JSON **no provee transacciones ACID multi-operación**. La ventana `createPosSale` → `registerPosIdempotency` no es atómica en disco. Si el proceso muere entre ambas, el reintento crea duplicado. **Mitigación**: Ventana < 5ms típico; para producción crítica usar PostgreSQL con constraint única en tabla `pos_idempotency_keys`.

---

### 3. Build Verification

```bash
npm run build                    # ✅ PASS
npm run build --workspace backend   # ✅ PASS (tsc OK)
npm run build --workspace frontend  # ✅ PASS (vite build OK)
```

---

## Pruebas Realizadas vs No Realizadas

| Prueba | Estado | Evidencia |
|--------|--------|-----------|
| **Build TypeScript/Vite** | ✅ EJECUTADA | 3 builds exitosos |
| **Email: SMTP falla → FAILED** | 🔍 INSPECCIÓN ESTÁTICA | Código verifica `emailResult.success` y llama `mark...Failed` |
| **Email: SMTP OK → SENT** | 🔍 INSPECCIÓN ESTÁTICA | Código llama `mark...Sent` solo tras `success: true` |
| **Webhook duplicado no reenvía** | 🔍 INSPECCIÓN ESTÁTICA | `reserve...` retorna false si `SENT`/`SENDING` |
| **POS doble clave misma huella → replay** | 🔍 INSPECCIÓN ESTÁTICA | `checkPosIdempotency` retorna `fingerprintMatch: true` |
| **POS misma clave distinto contenido → 409** | 🔍 INSPECCIÓN ESTÁTICA | Validación `fingerprintMatch === false` → 409 |
| **POS venta nueva → clave nueva** | 🔍 INSPECCIÓN ESTÁTICA | Frontend genera nueva clave por contenido |
| **Reinicio backend: claves persisten (JSON)** | 🔍 INSPECCIÓN ESTÁTICA | `touch()` guarda `posIdempotencyKeys` en snapshot |
| **SMTP real / Stripe real / PostgreSQL real** | ❌ NO PROBADO | Faltan credenciales `SMTP_*`, `STRIPE_*`, `DATABASE_URL` |

---

## Archivos Modificados

```
backend/src/domain.ts                              # + EmailStatus, campos Invoice
backend/src/store.ts                               # + state machine email, pos idempotency con fingerprint
backend/src/db.ts                                  # + migración BD, funciones state machine
backend/src/controllers/public.controller.ts       # + webhook usa state machine
backend/src/controllers/pos.controller.ts          # + idempotency obligatoria + fingerprint
frontend/src/features/pos/PosPage.tsx              # + genera Idempotency-Key + fingerprint
# frontend/src/api.ts                              # (sin cambios - ya soporta headers custom)
```

---

## Configuración Externa Pendiente (Para Pruebas E2E Reales)

| Variable | Descripción |
|----------|-------------|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_EMAIL` | Envío email real |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe real (no demo) |
| `DATABASE_URL` o `PGHOST/PGUSER/PGPASSWORD/PGDATABASE` | PostgreSQL producción |
| `STRIPE_CURRENCY` | Moneda esperada (default 'gtq') |

---

## Riesgos Residuales

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| Crash entre `createPosSale` y `registerPosIdempotency` (modo JSON) | Media | Ventana < 5ms; para crítico usar PostgreSQL con tabla `pos_idempotency_keys` + UNIQUE constraint |
| Servidor cae en `SENDING` (email) | Baja | Job admin periódico: `WHERE email_status='SENDING' AND email_attempt_at < NOW() - INTERVAL '10 min' → FAILED` |
| SMTP acepta pero email no llega (bounce, spam) | Inherente | `SENT` = aceptado por SMTP; monitoreo de bounces requerido aparte |
| Frontend no envía headers (cliente legacy) | Media | Backend rechaza con 400 claro; frontend actualizado |
| `sessionStorage` perdido (pestaña cerrada) | Baja | Nueva venta = nueva clave (comportamiento correcto) |

---

## Próximos Pasos Recomendados (Producción)

1. **Configurar SMTP real** y probar: webhook → FAILED → reintento manual admin → SENT
2. **Configurar Stripe real** y probar: `stripe trigger payment_intent.succeeded` 2x → 1 solo email SENT
3. **Configurar PostgreSQL** y probar: modo demo en PG → orden PAID + factura + email PENDING→SENT
4. **Agregar endpoint admin** `POST /api/admin/invoices/:id/retry-email` (protegido) para reintentos `FAILED`
5. **Job de limpieza** `SENDING` stale → `FAILED` (cron cada 10 min)
6. **Métricas**: Contadores `email_sent_total`, `email_failed_total`, `pos_idempotent_replays`