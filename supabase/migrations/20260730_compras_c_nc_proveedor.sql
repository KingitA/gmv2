-- ─────────────────────────────────────────────────────────────────────────────
-- FASE C Compras: NC de proveedor + descuentos fuera de factura (30/07/2026)
--
-- Modelo (sin tablas nuevas): las "NC esperadas" son filas de comprobantes_compra
-- con estado='esperada' — lo que el proveedor nos debe enviar como nota de
-- crédito (descuento fuera de factura, faltante, devolución, dif. de precio).
--   · origen_nc: por qué se espera la NC
--   · comprobante_asociado_id: factura contra la que se imputará
--
-- Circuito: verificación detecta diferencia → NC 'esperada' → llega el
-- documento real → ncp_registrar() la confirma (CC proveedor, saldos) →
-- ccp_imputar_credito() la aplica contra la factura (imputaciones_proveedores
-- + reduce el vencimiento). Espeja cc_imputar_credito de ventas (20260706_a3).
--
-- Integración con el circuito de pagos existente (op_confirmar 20260726_i1):
-- los vencimientos de compras se referencian por movimiento de CC
-- (referencia_tipo='cuenta_corriente'), igual que los que las OP marcan pagados.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Columnas nuevas
ALTER TABLE comprobantes_compra
  ADD COLUMN IF NOT EXISTS origen_nc varchar,
  ADD COLUMN IF NOT EXISTS comprobante_asociado_id uuid REFERENCES comprobantes_compra(id);

COMMENT ON COLUMN comprobantes_compra.origen_nc IS
  'Para NC: descuento_fuera_factura | faltante | devolucion | diferencia_precio';

CREATE INDEX IF NOT EXISTS idx_cc_nc_esperadas
  ON comprobantes_compra (proveedor_id, estado) WHERE estado = 'esperada';

-- Backfill de saldos para comprobantes existentes (facturas positivas)
UPDATE comprobantes_compra
SET saldo_pendiente = total_factura_declarado
WHERE saldo_pendiente IS NULL
  AND tipo_comprobante NOT IN ('NC', 'NCA', 'NCB', 'NCC', 'Reversa');

UPDATE comprobantes_compra
SET estado_pago = 'pendiente'
WHERE estado_pago IS NULL;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. ncp_registrar — confirma una NC esperada cuando llega el documento real
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.ncp_registrar(
  p_nc_id      uuid,
  p_datos      jsonb DEFAULT '{}'::jsonb,  -- {numero_comprobante, fecha_comprobante, total, tipo_comprobante}
  p_usuario_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nc      record;
  v_total   numeric;
  v_numero  text;
  v_fecha   date;
  v_tipo    text;
  v_mov_id  uuid;
BEGIN
  SELECT * INTO v_nc FROM comprobantes_compra WHERE id = p_nc_id FOR UPDATE;
  IF v_nc.id IS NULL THEN RAISE EXCEPTION 'ncp_registrar: NC % no encontrada', p_nc_id; END IF;
  IF v_nc.estado <> 'esperada' THEN
    RAISE EXCEPTION 'ncp_registrar: la NC está en estado % (se esperaba ''esperada'')', v_nc.estado;
  END IF;

  v_total  := COALESCE((p_datos->>'total')::numeric, v_nc.total_factura_declarado);
  v_numero := COALESCE(NULLIF(p_datos->>'numero_comprobante', ''), v_nc.numero_comprobante);
  v_fecha  := COALESCE((p_datos->>'fecha_comprobante')::date, (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date);
  v_tipo   := COALESCE(NULLIF(p_datos->>'tipo_comprobante', ''), v_nc.tipo_comprobante);

  IF v_total IS NULL OR v_total <= 0 THEN
    RAISE EXCEPTION 'ncp_registrar: total inválido (%)', v_total;
  END IF;

  UPDATE comprobantes_compra
  SET numero_comprobante = v_numero,
      tipo_comprobante   = v_tipo,
      fecha_comprobante  = v_fecha,
      total_factura_declarado = v_total,
      total_neto         = COALESCE((p_datos->>'total_neto')::numeric, v_total),
      total_iva          = COALESCE((p_datos->>'total_iva')::numeric, 0),
      estado             = 'validado',
      saldo_pendiente    = -v_total,      -- crédito: saldo negativo (patrón ventas)
      estado_pago        = 'pendiente',
      fecha_validacion   = now(),
      updated_at         = now()
  WHERE id = p_nc_id;

  -- Movimiento en CC proveedor (crédito: monto negativo)
  INSERT INTO cuenta_corriente_proveedores (
    proveedor_id, tipo_movimiento, monto, descripcion,
    referencia_id, referencia_tipo, numero_comprobante, tipo_comprobante, fecha
  ) VALUES (
    v_nc.proveedor_id, 'nota_credito', -v_total,
    'NC ' || v_numero || COALESCE(' (' || v_nc.origen_nc || ')', ''),
    p_nc_id, 'comprobante_compra', v_numero, v_tipo, now()
  ) RETURNING id INTO v_mov_id;

  RETURN jsonb_build_object('success', true, 'nc_id', p_nc_id, 'movimiento_cc_id', v_mov_id, 'total', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.ncp_registrar(uuid, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ncp_registrar(uuid, jsonb, uuid) TO authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. ccp_imputar_credito — aplica una NC de proveedor contra una factura
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.ccp_imputar_credito(
  p_credito_id uuid,                 -- comprobante_compra NC (saldo_pendiente < 0)
  p_debito_id  uuid,                 -- comprobante_compra FA/Adquisición (saldo > 0)
  p_monto      numeric DEFAULT NULL, -- NULL = máximo imputable
  p_usuario_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cred       record;
  v_deb        record;
  v_disponible numeric;
  v_pendiente  numeric;
  v_monto      numeric;
  v_nuevo_cred numeric;
  v_nuevo_deb  numeric;
  v_mov_nc     uuid;
  v_mov_fa     uuid;
BEGIN
  IF p_credito_id = p_debito_id THEN
    RAISE EXCEPTION 'ccp_imputar_credito: crédito y débito no pueden ser el mismo comprobante';
  END IF;

  -- Lock en orden determinístico para evitar deadlocks
  IF p_credito_id < p_debito_id THEN
    SELECT id, proveedor_id, tipo_comprobante, saldo_pendiente INTO v_cred
    FROM comprobantes_compra WHERE id = p_credito_id FOR UPDATE;
    SELECT id, proveedor_id, tipo_comprobante, saldo_pendiente INTO v_deb
    FROM comprobantes_compra WHERE id = p_debito_id FOR UPDATE;
  ELSE
    SELECT id, proveedor_id, tipo_comprobante, saldo_pendiente INTO v_deb
    FROM comprobantes_compra WHERE id = p_debito_id FOR UPDATE;
    SELECT id, proveedor_id, tipo_comprobante, saldo_pendiente INTO v_cred
    FROM comprobantes_compra WHERE id = p_credito_id FOR UPDATE;
  END IF;

  IF v_cred.id IS NULL THEN RAISE EXCEPTION 'ccp_imputar_credito: crédito % no encontrado', p_credito_id; END IF;
  IF v_deb.id IS NULL THEN RAISE EXCEPTION 'ccp_imputar_credito: débito % no encontrado', p_debito_id; END IF;
  IF v_cred.proveedor_id <> v_deb.proveedor_id THEN
    RAISE EXCEPTION 'ccp_imputar_credito: los comprobantes pertenecen a proveedores distintos';
  END IF;
  IF v_cred.tipo_comprobante NOT IN ('NC', 'NCA', 'NCB', 'NCC', 'Reversa') THEN
    RAISE EXCEPTION 'ccp_imputar_credito: % no es un comprobante de crédito', v_cred.tipo_comprobante;
  END IF;
  IF v_deb.tipo_comprobante IN ('NC', 'NCA', 'NCB', 'NCC', 'Reversa') THEN
    RAISE EXCEPTION 'ccp_imputar_credito: el destino % también es un crédito', v_deb.tipo_comprobante;
  END IF;

  v_disponible := GREATEST(0, -COALESCE(v_cred.saldo_pendiente, 0));
  v_pendiente  := GREATEST(0, COALESCE(v_deb.saldo_pendiente, 0));

  IF v_disponible <= 0 THEN RAISE EXCEPTION 'ccp_imputar_credito: el crédito no tiene saldo disponible'; END IF;
  IF v_pendiente <= 0 THEN RAISE EXCEPTION 'ccp_imputar_credito: la factura no tiene saldo pendiente'; END IF;

  v_monto := COALESCE(p_monto, LEAST(v_disponible, v_pendiente));
  IF v_monto <= 0 OR v_monto > v_disponible OR v_monto > v_pendiente THEN
    RAISE EXCEPTION 'ccp_imputar_credito: monto % fuera de rango (disponible %, pendiente %)',
      v_monto, v_disponible, v_pendiente;
  END IF;

  v_nuevo_cred := v_cred.saldo_pendiente + v_monto;
  v_nuevo_deb  := v_deb.saldo_pendiente - v_monto;

  UPDATE comprobantes_compra
  SET saldo_pendiente = v_nuevo_cred,
      estado_pago = CASE WHEN v_nuevo_cred >= 0 THEN 'pagado' ELSE 'parcial' END
  WHERE id = p_credito_id;

  UPDATE comprobantes_compra
  SET saldo_pendiente = v_nuevo_deb,
      estado_pago = CASE WHEN v_nuevo_deb <= 0 THEN 'pagado' ELSE 'parcial' END
  WHERE id = p_debito_id;

  -- Registrar la imputación entre los movimientos de CC (patrón op_confirmar:
  -- id_movimiento_pago = el crédito que cancela, id_movimiento_documento = el débito)
  SELECT id INTO v_mov_nc FROM cuenta_corriente_proveedores
  WHERE referencia_id = p_credito_id AND referencia_tipo = 'comprobante_compra'
    AND tipo_movimiento = 'nota_credito'
  ORDER BY created_at DESC LIMIT 1;

  SELECT id INTO v_mov_fa FROM cuenta_corriente_proveedores
  WHERE referencia_id = p_debito_id AND referencia_tipo = 'comprobante_compra'
  ORDER BY created_at DESC LIMIT 1;

  IF v_mov_nc IS NOT NULL AND v_mov_fa IS NOT NULL THEN
    INSERT INTO imputaciones_proveedores (id_movimiento_pago, id_movimiento_documento, monto_imputado, fecha_imputacion)
    VALUES (v_mov_nc, v_mov_fa, v_monto, now());
  END IF;

  -- Reducir el vencimiento de la factura (referenciado por movimiento de CC)
  IF v_mov_fa IS NOT NULL THEN
    UPDATE vencimientos
    SET monto = GREATEST(0, monto - v_monto),
        estado = CASE WHEN monto - v_monto <= 0 THEN 'pagado' ELSE estado END,
        updated_at = now()
    WHERE referencia_id = v_mov_fa
      AND referencia_tipo = 'cuenta_corriente'
      AND estado = 'pendiente';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'monto_imputado', v_monto,
    'credito_saldo_restante', v_nuevo_cred,
    'debito_saldo_restante', v_nuevo_deb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ccp_imputar_credito(uuid, uuid, numeric, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ccp_imputar_credito(uuid, uuid, numeric, uuid) TO authenticated, service_role;

-- Control
SELECT count(*) FILTER (WHERE estado = 'esperada') AS nc_esperadas,
       count(*) FILTER (WHERE saldo_pendiente IS NOT NULL) AS con_saldo
FROM comprobantes_compra;
