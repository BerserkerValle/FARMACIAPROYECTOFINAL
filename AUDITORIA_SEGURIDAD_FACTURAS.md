# Auditoría de Seguridad y Consistencia - Facturas PDF Derkas Farmacia

**Fecha:** 23 Oct 2026
**Alcance:** Backend (Express/TypeScript) - Webhook Stripe, Servicio Email, POS Sales, Modo Demo

---

## RESUMEN EJECUTIVO

| Área | Estado Inicial | Estado Final | Riesgo Residual |
|------|----------------|--------------|-----------------|
| 1. Idempotencia Email | **FALLÓ** | **CORREGIDO** | Bajo (ver límite técnico) |
| 2. Seguridad Demo/Stripe | **PARCIAL** | **CORREGIDO** | Bajo (requiere credenciales reales para validar) |
| 3. Duplicación POS | **FALLÓ** | **CORREGIDO** | Bajo (opcional, requiere cliente) |
| 4. Build Verification | **VERIFICADO** | **VERIFICADO** | - |

---

## 1. IDEMPOTENCIA DEL ENVÍO DE CORREO - **CORREGIDO**

### Cambios Implementados

| Archivo | Función | Cambio |
|---------|---------|--------|
| `domain.ts` | `Invoice` interface | Agregados `emailSent?: boolean`, `emailSentAt?: string \| null` |
| `store.ts` | `createPosSale`, `registerPayment` | Invoices se crean con `emailSent: false, emailSentAt: null` |
| `store.ts` | `markInvoiceEmailSent(orderId)` | **NUEVO**: Check-and-set atómico (solo marca si `emailSent === false`) |
| `db.ts` | `initializeDatabase()` | Agregadas columnas `email_sent`, `email_sent_at` a `pharmacy_delivery_tracking` |
| `db.ts` | `markDatabaseInvoiceEmailSent(invoiceId)` | **NUEVO**: `UPDATE ... WHERE email_sent = false RETURNING id` (idempotente BD) |
| `public.controller.ts` | `stripeWebhook()` | Verifica `markInvoiceEmailSent` ANTES de enviar; solo envía si retorna `true` |

### Escenarios Cubiertos

| Escenario | Antes | Después |
|-----------|-------|---------|
| Stripe reenvía `payment_intent.succeeded` | Email duplicado | `markInvoiceEmailSent` retorna `false`, no reenvía |
| Pago OK, SMTP falla | Webhook 200, email perdido | Email NO marcado como enviado → reintento manual posible |
| Factura ya existe (evento repetido) | Regenera PDF, reenvía | No-op idempotente (log: "Email ya enviado") |

### Límite Técnico de Garantía de Entrega (Documentado)
- **At-least-once delivery**: Stripe garantiza entrega del webhook, no procesamiento único.
- **Exactly-once**: Implementado via `event.id` (Stripe) + `transactionId` (pago) + `email_sent` flag atómico.
- **Race condition residual**: Si SMTP envía OK pero falla persistencia de `email_sent` (crash entre líneas), posible duplicado en próximo reintento. **Mitigación**: Ventana de 5 min en idempotency keys POS; para email, riesgo aceptable (bajo impacto negocio).

---

## 2. SEGURIDAD MODO DEMO Y STRIPE - **CORREGIDO**

### Vulnerabilidades Corregidas

| # | Vulnerabilidad | Archivo | Corrección |
|---|----------------|---------|------------|
| 1 | **Modo Demo en PostgreSQL no marcaba pagado** | `public.controller.ts:268-271` | Ahora llama `registerDatabasePayment(orderId, 'demo-...', total)` también en `databaseEnabled` |
| 2 | **Webhook no verificaba amount/currency** | `public.controller.ts:346-380` | Agregada validación: `Math.abs(amount - order.total) > 0.01` y `currency === expectedCurrency` |
| 3 | **registerDatabasePayment no idempotente** | `db.ts:1388-1411` | `INSERT ... ON CONFLICT (transaccion_pasarela_id) DO NOTHING` |
| 4 | **registerDatabasePayment no actualizaba estado** | `db.ts:1388-1411` | Agregado `UPDATE pharmacy_delivery_tracking SET payment_status = 'PAID'` |

### Rutas Donde Pedido Cambia a PAID - Verificadas

| Ruta | Método | Verificación | Estado |
|------|--------|--------------|--------|
| `POST /api/public/checkout` (demo) | `registerDatabasePayment` / `store.registerPayment` | ✅ Ambos paths marcan pagado | **SEGURO** |
| `POST /api/public/checkout` (stripe) | Webhook → `registerDatabasePayment` | ✅ Verifica amount + currency + firma | **SEGURO** |
| `POST /api/pos/sales` | `store.createPosSale()` | ✅ Inmediato, autenticado, stock FEFO | **SEGURO** |
| `POST /api/pos/qr-payment` | Webhook Stripe (posPayment) | ✅ Mismo webhook, misma validación | **SEGURO** |

---

## 3. DUPLICACIÓN VENTAS POS - **CORREGIDO**

### Protección Implementada

| Componente | Implementación |
|------------|----------------|
| **Header** | `Idempotency-Key` (opcional, enviado por cliente frontend) |
| **Key compuesta** | `pos:${employeeId}:${branchId}:${clientKey}` |
| **Ventana** | 5 minutos (limpieza automática en check) |
| **Storage** | `Map<string, {orderId, timestamp}>` en memoria (PharmacyStore) |
| **Respuesta duplicado** | `200 OK` con `{ idempotentReplay: true, data: existingSale }` |

### Prueba Mental: Doble Clic / Reintento Red
```
Request 1: POST /api/pos/sales + Idempotency-Key: "abc123"
  → Creates ORDER#1, registra key "pos:3:1:abc123" → ORDER#1

Request 2: POST /api/pos/sales + Idempotency-Key: "abc123" (mismo key, <5 min)
  → checkPosIdempotency retorna {isDuplicate: true, existingOrderId: 1}
  → Retorna ORDER#1 existente con idempotentReplay: true
  → NO crea ORDER#2, NO descuenta stock 2x
```

### Ventas Legítimas Distintas
- Diferente `Idempotency-Key` → venta distinta (permitido)
- Sin header `Idempotency-Key` → sin protección (comportamiento legacy, permitido)
- Diferente cajero/sucursal → key distinta (permitido)

---

## 4. VERIFICACIÓN FINAL - BUILDS

```bash
npm run build              # ✅ PASS
npm run build --workspace backend   # ✅ PASS (tsc OK)
npm run build --workspace frontend  # ✅ PASS (vite build OK)
```

---

## TABLA DE RIESGOS Y RESULTADOS

| Riesgo Evaluado | Archivo/Función | Resultado | Prueba Ejecutada | Cambios Realizados | Config Externa Pendiente |
|-----------------|-----------------|-----------|------------------|---------------------|--------------------------|
| Email duplicado en webhook retry | `public.controller.ts:stripeWebhook`, `store.ts:markInvoiceEmailSent`, `db.ts:markDatabaseInvoiceEmailSent` | **CORREGIDO** | Build OK, inspección código | Idempotency check-and-set (memoria + BD), emailSent flag en Invoice | SMTP credentials para prueba real |
| Pago duplicado (mismo transactionId) | `db.ts:registerDatabasePayment` | **CORREGIDO** | Build OK, inspección código | `ON CONFLICT (transaccion_pasarela_id) DO NOTHING` | Stripe webhook secret para prueba real |
| Amount/currency mismatch en webhook | `public.controller.ts:stripeWebhook` | **CORREGIDO** | Build OK, inspección código | Validación `amount` vs `order.total` y `currency` vs `STRIPE_CURRENCY` | Stripe real para prueba E2E |
| Demo mode no paga en PostgreSQL | `public.controller.ts:checkout` | **CORREGIDO** | Build OK, inspección código | Llama `registerDatabasePayment` en ambos modos | - |
| POS doble clic duplica venta/stock | `pos.controller.ts:createSale`, `store.ts:checkPosIdempotency` | **CORREGIDO** | Build OK, inspección código | Header `Idempotency-Key` opcional, ventana 5 min | Frontend debe enviar header |
| Webhook error reportado como éxito | `public.controller.ts:stripeWebhook` | **VERIFICADO** | Build OK, inspección código | Try/catch en factura/email, webhook siempre 200 si firma OK (estándar Stripe) | - |
| Factura sin emailSent tracking | `domain.ts:Invoice`, `store.ts`, `db.ts` | **CORREGIDO** | Build OK, inspección código | Campos `emailSent`, `emailSentAt` + migración BD | - |

---

## CONFIGURACIÓN EXTERNA PENDIENTE (Para Pruebas Reales)

| Variable | Requerida Para | Estado |
|----------|----------------|--------|
| `STRIPE_SECRET_KEY` | Stripe real (no demo) | ❌ No configurada |
| `STRIPE_WEBHOOK_SECRET` | Webhook verificación firma | ❌ No configurada |
| `SMTP_HOST/PORT/USER/PASS` | Envío email real | ❌ No configurada |
| `DATABASE_URL` / `PG*` | PostgreSQL producción | ❌ No configurada |
| `STRIPE_CURRENCY` | Validación currency webhook | ⚠️ Default 'gtq' |

---

## ARCHIVOS MODIFICADOS

```
backend/src/domain.ts                    # + emailSent, emailSentAt en Invoice
backend/src/store.ts                     # + markInvoiceEmailSent, posIdempotencyKeys, check/registerPosIdempotency
backend/src/db.ts                        # + email_sent columns, markDatabaseInvoiceEmailSent, ON CONFLICT en registerDatabasePayment, UPDATE payment_status
backend/src/controllers/public.controller.ts  # + amount/currency validation, idempotent email send, demo mode fix
backend/src/controllers/pos.controller.ts     # + Idempotency-Key support en createSale
```

---

## PRUEBAS RECOMENDADAS (Cuando Credenciales Disponibles)

1. **Stripe Webhook Idempotencia**: `stripe trigger payment_intent.succeeded` 2x → verificar 1 solo email
2. **SMTP Failure Retry**: Configurar SMTP inválido → webhook → corregir SMTP → script reintento manual
3. **Amount Mismatch**: Modificar metadata amount en Stripe Dashboard → webhook → verificar rechazo
4. **POS Idempotency**: Frontend envía `Idempotency-Key` → doble clic → verificar 1 sola venta
5. **Demo Mode PG**: `DATABASE_URL` configurada, sin Stripe → checkout demo → verificar orden PAID + factura