-- ─────────────────────────────────────────────────────────────────────────────
-- FASE A3 — Imputación de créditos (NC ↔ FA)
--
-- Problema: las notas de crédito nacían con saldo_pendiente negativo pero
-- NUNCA se imputaban contra las facturas que anulaban/acreditaban. En datos:
-- 2 FA + 2 NCA espejo, las 4 con saldo_pendiente completo y estado
-- 'pendiente' eternamente — el cliente "debe" y "tiene crédito" a la vez.
--
-- Solución:
--   1. imputaciones soporta imputación crédito→débito sin pago:
--      nueva columna credito_comprobante_id; pago_id pasa a nullable con
--      CHECK de que al menos uno de los dos esté presente.
--   2. cc_imputar_credito(): baja el saldo de ambos comprobantes de forma
--      atómica. NO postea al libro mayor (ambos documentos ya están
--      posteados; la imputación es solo aplicación de saldos).
--   3. Backfill idempotente: imputa las NC existentes contra su FA espejo
--      (mismo cliente + mismo pedido, hasta agotar saldos).
--
-- Idempotente: IF NOT EXISTS / CREATE OR REPLACE / guards en el backfill.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- 1. Esquema: imputaciones sin pago (crédito documental)
-- ═════════════════════════════════════════════════════════════════════════
ALTER TABLE public.imputaciones
  ADD COLUMN IF NOT EXISTS credito_comprobante_id uuid REFERENCES comprobantes_venta(id);

ALTER TABLE public.imputaciones ALTER COLUMN pago_id DROP NOT NULL;

DO $$
BEGIN
  ALTER TABLE public.imputaciones
    ADD CONSTRAINT imputaciones_origen_check
    CHECK (pago_id IS NOT NULL OR credito_comprobante_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_imputaciones_credito
  ON public.imputaciones (credito_comprobante_id)
  WHERE credito_comprobante_id IS NOT NULL;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. cc_imputar_credito — aplica una NC/REV contra una FA/ND/PRES
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cc_imputar_credito(
  p_credito_id uuid,   -- comprobante NC/NCA/NCB/NCC/REV (saldo_pendiente < 0)
  p_debito_id  uuid,   -- comprobante FA/FB/ND*/PRES (saldo_pendiente > 0)
  p_monto      numeric DEFAULT NULL,  -- NULL = máximo imputable
  p_usuario_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cred          record;
  v_deb           record;
  v_disponible    numeric;
  v_pendiente     numeric;
  v_monto         numeric;
  v_nuevo_cred    numeric;
  v_nuevo_deb     numeric;
BEGIN
  IF p_credito_id = p_debito_id THEN
    RAISE EXCEPTION 'cc_imputar_credito: crédito y débito no pueden ser el mismo comprobante';
  END IF;

  -- Lock en orden determinístico para evitar deadlocks
  IF p_credito_id < p_debito_id THEN
    SELECT id, cliente_id, tipo_comprobante, saldo_pendiente INTO v_cred
    FROM comprobantes_venta WHERE id = p_credito_id FOR UPDATE;
    SELECT id, cliente_id, tipo_comprobante, total_factura, saldo_pendiente INTO v_deb
    FROM comprobantes_venta WHERE id = p_debito_id FOR UPDATE;
  ELSE
    SELECT id, cliente_id, tipo_comprobante, total_factura, saldo_pendiente INTO v_deb
    FROM comprobantes_venta WHERE id = p_debito_id FOR UPDATE;
    SELECT id, cliente_id, tipo_comprobante, saldo_pendiente INTO v_cred
    FROM comprobantes_venta WHERE id = p_credito_id FOR UPDATE;
  END IF;

  IF v_cred.id IS NULL THEN RAISE EXCEPTION 'cc_imputar_credito: crédito % no encontrado', p_credito_id; END IF;
  IF v_deb.id IS NULL THEN RAISE EXCEPTION 'cc_imputar_credito: débito % no encontrado', p_debito_id; END IF;
  IF v_cred.cliente_id <> v_deb.cliente_id THEN
    RAISE EXCEPTION 'cc_imputar_credito: los comprobantes pertenecen a clientes distintos';
  END IF;
  IF v_cred.tipo_comprobante NOT IN ('NC', 'NCA', 'NCB', 'NCC', 'REV') THEN
    RAISE EXCEPTION 'cc_imputar_credito: % no es un comprobante de crédito', v_cred.tipo_comprobante;
  END IF;
  IF v_deb.tipo_comprobante IN ('NC', 'NCA', 'NCB', 'NCC', 'REV') THEN
    RAISE EXCEPTION 'cc_imputar_credito: el destino % también es un crédito', v_deb.tipo_comprobante;
  END IF;

  v_disponible := GREATEST(0, -COALESCE(v_cred.saldo_pendiente, 0)); -- NC guarda saldo negativo
  v_pendiente  := GREATEST(0, COALESCE(v_deb.saldo_pendiente, 0));

  IF v_disponible <= 0 THEN
    RAISE EXCEPTION 'cc_imputar_credito: el crédito no tiene saldo disponible';
  END IF;
  IF v_pendiente <= 0 THEN
    RAISE EXCEPTION 'cc_imputar_credito: el débito no tiene saldo pendiente';
  END IF;

  v_monto := COALESCE(p_monto, LEAST(v_disponible, v_pendiente));
  IF v_monto <= 0 OR v_monto > v_disponible OR v_monto > v_pendiente THEN
    RAISE EXCEPTION 'cc_imputar_credito: monto % fuera de rango (disponible %, pendiente %)',
      v_monto, v_disponible, v_pendiente;
  END IF;

  -- Aplicar saldos
  v_nuevo_cred := v_cred.saldo_pendiente + v_monto;  -- hacia 0
  v_nuevo_deb  := v_deb.saldo_pendiente - v_monto;

  UPDATE comprobantes_venta
  SET saldo_pendiente = v_nuevo_cred,
      estado_pago = CASE WHEN v_nuevo_cred >= 0 THEN 'pagado' ELSE 'parcial' END
  WHERE id = p_credito_id;

  UPDATE comprobantes_venta
  SET saldo_pendiente = v_nuevo_deb,
      estado_pago = CASE WHEN v_nuevo_deb <= 0 THEN 'pagado' ELSE 'parcial' END
  WHERE id = p_debito_id;

  INSERT INTO imputaciones (
    pago_id, credito_comprobante_id, comprobante_id,
    tipo_comprobante, monto_imputado, estado
  ) VALUES (
    NULL, p_credito_id, p_debito_id,
    'nota_credito', v_monto, 'confirmado'
  );

  RETURN jsonb_build_object(
    'success', true,
    'monto_imputado', v_monto,
    'credito_saldo_restante', v_nuevo_cred,
    'debito_saldo_restante', v_nuevo_deb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cc_imputar_credito(uuid, uuid, numeric, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cc_imputar_credito(uuid, uuid, numeric, uuid) TO authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. Backfill: imputar NC existentes contra su FA espejo
--    Criterio: mismo cliente + mismo pedido, NC con crédito disponible y
--    débito con saldo pendiente. Idempotente: si ya no hay saldos, no matchea.
-- ═════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_par record;
BEGIN
  FOR v_par IN
    SELECT nc.id AS credito_id, fa.id AS debito_id
    FROM comprobantes_venta nc
    JOIN comprobantes_venta fa
      ON fa.cliente_id = nc.cliente_id
     AND fa.pedido_id IS NOT DISTINCT FROM nc.pedido_id
     AND fa.tipo_comprobante NOT IN ('NC', 'NCA', 'NCB', 'NCC', 'REV')
     AND COALESCE(fa.saldo_pendiente, 0) > 0
    WHERE nc.tipo_comprobante IN ('NC', 'NCA', 'NCB', 'NCC', 'REV')
      AND COALESCE(nc.saldo_pendiente, 0) < 0
      AND COALESCE(nc.estado_pago, '') <> 'anulado'
      AND COALESCE(fa.estado_pago, '') <> 'anulado'
    ORDER BY nc.created_at NULLS LAST, fa.fecha
  LOOP
    BEGIN
      PERFORM cc_imputar_credito(v_par.credito_id, v_par.debito_id, NULL, NULL);
      RAISE NOTICE 'Backfill: NC % imputada contra FA %', v_par.credito_id, v_par.debito_id;
    EXCEPTION WHEN OTHERS THEN
      -- Los saldos pudieron agotarse en una vuelta anterior del loop
      RAISE NOTICE 'Backfill NC %: % (omitido)', v_par.credito_id, SQLERRM;
    END;
  END LOOP;
END $$;
