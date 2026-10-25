-- ============================================================================
-- MIGRACIÓN: Claves de idempotencia POS y mejoras de reintento de correo
-- ============================================================================
-- Ejecutar en PostgreSQL como usuario con permisos de DDL
-- Esta migración es idempotente (usa IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)

-- 1. Tabla de claves de idempotencia POS (persistente, sobrevive a reinicios)
CREATE TABLE IF NOT EXISTS pharmacy_pos_idempotency_keys (
  id BIGSERIAL PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  employee_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  order_id BIGINT NOT NULL DEFAULT 0,
  request_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS pharmacy_pos_idempotency_keys_expires_idx
  ON pharmacy_pos_idempotency_keys (expires_at);

-- 2. Columna contador de intentos de envío de correo
ALTER TABLE pharmacy_delivery_tracking
  ADD COLUMN IF NOT EXISTS email_attempt_count INTEGER NOT NULL DEFAULT 0;

-- 3. Índice para acelerar la recuperación de correos atascados
CREATE INDEX IF NOT EXISTS pharmacy_delivery_tracking_email_status_attempt_idx
  ON pharmacy_delivery_tracking (email_status, email_attempt_at)
  WHERE email_status IN ('SENDING', 'FAILED');

-- 4. Índice para acelerar reintentos de correos fallidos
CREATE INDEX IF NOT EXISTS pharmacy_delivery_tracking_email_failed_retry_idx
  ON pharmacy_delivery_tracking (email_status, email_attempt_count, email_attempt_at)
  WHERE email_status = 'FAILED';

-- 5. Función para limpiar claves de idempotencia POS expiradas (opcional, para pg_cron)
-- SELECT cron.schedule('cleanup-pos-idempotency', '*/5 * * * *',
--   'DELETE FROM pharmacy_pos_idempotency_keys WHERE expires_at < NOW();');

-- 6. Función para recuperar correos atascados (opcional, para pg_cron)
-- SELECT cron.schedule('recover-stuck-emails', '*/10 * * * *',
--   $$UPDATE pharmacy_delivery_tracking
--      SET email_status = 'FAILED',
--          email_error = 'Recuperado automáticamente: envío SENDING por más de 10 minutos (último intento: ' || email_attempt_at || ')',
--          updated_at = NOW()
--    WHERE email_status = 'SENDING'
--      AND email_attempt_at < NOW() - INTERVAL '10 minutes';$$);

-- 7. Función para reintentos de correos fallidos (opcional, para pg_cron)
-- SELECT cron.schedule('retry-failed-emails', '*/15 * * * *',
--   $$DO $$
--   DECLARE
--     r RECORD;
--   BEGIN
--     FOR r IN
--       SELECT dt.id, dt.order_code, dt.email_attempt_count, f.id_factura, f.invoice_number,
--              f.total_neto, c.email, c.full_name
--       FROM pharmacy_delivery_tracking dt
--       JOIN Facturas f ON f.id_factura = (SELECT id_factura FROM Facturas WHERE CONCAT('WEB-', LPAD(id_factura::text, 6, '0')) = dt.order_code LIMIT 1)
--       JOIN Clientes c ON c.id_cliente = f.id_cliente
--      WHERE dt.email_status = 'FAILED'
--        AND dt.email_attempt_count < 3
--      ORDER BY dt.email_attempt_at ASC
--     LOOP
--       -- Aquí se llamaría a la función de envío real
--       -- Por ahora solo incrementamos el contador para demostración
--       UPDATE pharmacy_delivery_tracking
--          SET email_attempt_count = email_attempt_count + 1,
--              email_status = 'SENDING',
--              email_attempt_at = NOW(),
--              email_error = NULL,
--              updated_at = NOW()
--        WHERE id = r.id
--          AND email_status = 'FAILED';
--     END LOOP;
--   END $$;$$);

-- Verificación post-migración
DO $$
BEGIN
  -- Verificar tabla POS idempotency
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pharmacy_pos_idempotency_keys') THEN
    RAISE EXCEPTION 'Tabla pharmacy_pos_idempotency_keys no creada';
  END IF;

  -- Verificar columna email_attempt_count
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'pharmacy_delivery_tracking'
                 AND column_name = 'email_attempt_count') THEN
    RAISE EXCEPTION 'Columna email_attempt_count no añadida';
  END IF;

  RAISE NOTICE 'Migración 001 completada exitosamente';
END $$;