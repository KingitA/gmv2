-- ============================================================================
-- Alta de cobranzas TRANSACCIONAL + IDEMPOTENTE
--
-- Hasta ahora los 4 endpoints de alta (POST /api/pagos-clientes, /api/cobranzas,
-- /api/chofer/viaje/[id]/cobro, /api/viajante/cobro) insertaban pago + detalle +
-- cheques + imputaciones como escrituras sueltas: un fallo a mitad dejaba pagos
-- huérfanos, y un doble click creaba el pago dos veces.
--
-- Este script agrega:
--  1. pagos_clientes.idempotency_key (uuid, único cuando no es null): el front
--     genera la clave al armar el formulario; reintentos/doble click devuelven
--     el MISMO pago en vez de duplicarlo.
--  2. RPC cobranza_crear(p_payload jsonb): inserta pago + pagos_detalle +
--     cheques + pago_deposito_items + imputaciones en UNA transacción, con
--     validaciones que ningún endpoint puede saltear:
--       - Σ detalles == monto (al centavo)
--       - Σ imputaciones ≤ monto (el excedente se recorta en TS antes; acá se
--         rechaza — evita la sobre-imputación al confirmar)
--       - cada comprobante imputado: existe, es del cliente, no está anulado
--         y no es un comprobante de crédito
-- ============================================================================

-- ── Fix estructural: cheques "a cuenta" sin color ──
-- El código TS insertaba cheques con color 'PENDIENTE', pero money_color solo
-- admitía BLANCO/NEGRO: el insert fallaba EN SILENCIO y el cheque nunca entraba
-- a cartera (pagos_detalle quedaba con cheque_id null). resolverColorPendientes
-- ya contempla cheques en PENDIENTE y los pinta al confirmar; solo faltaba que
-- el enum lo permitiera. La confirmación sigue bloqueada mientras quede
-- PENDIENTE (cobranza_confirmar exige BLANCO/NEGRO), así que el color nunca
-- llega a kardex/saldos sin resolver.
ALTER TYPE money_color ADD VALUE IF NOT EXISTS 'PENDIENTE';

ALTER TABLE pagos_clientes ADD COLUMN IF NOT EXISTS idempotency_key uuid;

CREATE UNIQUE INDEX IF NOT EXISTS pagos_clientes_idempotency_key_uniq
  ON pagos_clientes (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.cobranza_crear(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key        uuid := NULLIF(p_payload->>'idempotency_key', '')::uuid;
  v_cliente    uuid := (p_payload->>'cliente_id')::uuid;
  v_monto      numeric := (p_payload->>'monto')::numeric;
  v_estado     text := COALESCE(p_payload->>'estado', 'pendiente');
  v_existente  uuid;
  v_pago_id    uuid;
  v_det        jsonb;
  v_item       jsonb;
  v_imp        jsonb;
  v_chq        jsonb;
  v_cheque_id  uuid;
  v_detalle_id uuid;
  v_sum_det    numeric := 0;
  v_sum_imp    numeric := 0;
  v_comp       record;
BEGIN
  IF v_cliente IS NULL THEN
    RAISE EXCEPTION 'cobranza_crear: cliente_id es obligatorio';
  END IF;
  IF COALESCE(v_monto, 0) <= 0 THEN
    RAISE EXCEPTION 'cobranza_crear: el monto debe ser mayor a 0';
  END IF;
  IF v_estado NOT IN ('pendiente', 'pendiente_rendicion') THEN
    RAISE EXCEPTION 'cobranza_crear: estado inválido % (el alta nunca nace confirmada)', v_estado;
  END IF;

  -- ── Idempotencia: mismo key → devolver el pago ya creado ──
  IF v_key IS NOT NULL THEN
    SELECT id INTO v_existente FROM pagos_clientes WHERE idempotency_key = v_key;
    IF v_existente IS NOT NULL THEN
      RETURN jsonb_build_object('pago_id', v_existente, 'dedup', true);
    END IF;
  END IF;

  -- ── Validar suma de detalles ──
  FOR v_det IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'detalles', '[]'::jsonb))
  LOOP
    v_sum_det := v_sum_det + COALESCE((v_det->>'monto')::numeric, 0);
  END LOOP;
  IF abs(v_sum_det - v_monto) > 0.01 THEN
    RAISE EXCEPTION 'cobranza_crear: la suma de los métodos (%) no coincide con el monto del pago (%)', v_sum_det, v_monto;
  END IF;

  -- ── Validar imputaciones ──
  FOR v_imp IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'imputaciones', '[]'::jsonb))
  LOOP
    IF COALESCE((v_imp->>'monto_imputado')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'cobranza_crear: imputación con monto inválido';
    END IF;
    v_sum_imp := v_sum_imp + (v_imp->>'monto_imputado')::numeric;

    SELECT id, cliente_id, tipo_comprobante, numero_comprobante, anulado_en
    INTO v_comp
    FROM comprobantes_venta WHERE id = (v_imp->>'comprobante_id')::uuid;

    IF v_comp.id IS NULL THEN
      RAISE EXCEPTION 'cobranza_crear: comprobante % no existe', v_imp->>'comprobante_id';
    END IF;
    IF v_comp.cliente_id <> v_cliente THEN
      RAISE EXCEPTION 'cobranza_crear: el comprobante % no es del cliente del pago', v_comp.numero_comprobante;
    END IF;
    IF v_comp.anulado_en IS NOT NULL THEN
      RAISE EXCEPTION 'cobranza_crear: el comprobante % está anulado — no se puede cobrar', v_comp.numero_comprobante;
    END IF;
    IF v_comp.tipo_comprobante IN ('NC', 'NCA', 'NCB', 'NCC', 'REV') THEN
      RAISE EXCEPTION 'cobranza_crear: % es un comprobante de crédito — no se cobra con un pago', v_comp.numero_comprobante;
    END IF;
  END LOOP;
  IF v_sum_imp > v_monto + 0.01 THEN
    RAISE EXCEPTION 'cobranza_crear: lo imputado (%) supera el monto del pago (%) — recortá las imputaciones', v_sum_imp, v_monto;
  END IF;

  -- ── Pago ──
  INSERT INTO pagos_clientes (
    cliente_id, vendedor_id, viaje_id, cobranza_id, cobrador_tipo,
    monto, fecha_pago, observaciones, estado, creado_por, idempotency_key
  ) VALUES (
    v_cliente,
    NULLIF(p_payload->>'vendedor_id', '')::uuid,
    NULLIF(p_payload->>'viaje_id', '')::uuid,
    NULLIF(p_payload->>'cobranza_id', '')::uuid,
    -- cobrador_tipo es NOT NULL con default 'oficina' (cobros de /caja y
    -- /mostrador no mandan el campo): un NULL explícito pisaría el default.
    COALESCE(NULLIF(p_payload->>'cobrador_tipo', ''), 'oficina'),
    v_monto,
    COALESCE(NULLIF(p_payload->>'fecha_pago', '')::date, CURRENT_DATE),
    NULLIF(p_payload->>'observaciones', ''),
    v_estado,
    NULLIF(p_payload->>'creado_por', '')::uuid,
    v_key
  )
  RETURNING id INTO v_pago_id;

  -- ── Detalles (+ cheques + ítems de depósito) ──
  FOR v_det IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'detalles', '[]'::jsonb))
  LOOP
    -- cheque_id explícito (ej. cheque compartido entre varios clientes) tiene
    -- prioridad; si no, se crea el cheque desde el objeto 'cheque'.
    v_cheque_id := NULLIF(v_det->>'cheque_id', '')::uuid;
    v_chq := v_det->'cheque';
    IF v_cheque_id IS NULL AND v_chq IS NOT NULL AND jsonb_typeof(v_chq) = 'object' THEN
      INSERT INTO cheques (
        tipo, estado, banco, numero, fecha_emision, fecha_vencimiento,
        monto, color, es_echeq, cliente_origen_id
      ) VALUES (
        'TERCERO', 'EN_CARTERA',
        COALESCE(v_chq->>'banco', ''),
        COALESCE(v_chq->>'numero', ''),
        NULLIF(v_chq->>'fecha_emision', '')::date,
        NULLIF(v_chq->>'fecha_vencimiento', '')::date,
        COALESCE((v_chq->>'monto')::numeric, (v_det->>'monto')::numeric),
        COALESCE(NULLIF(v_chq->>'color', ''), 'PENDIENTE')::money_color,
        COALESCE((v_chq->>'es_echeq')::boolean, false),
        v_cliente
      )
      RETURNING id INTO v_cheque_id;
    END IF;

    INSERT INTO pagos_detalle (
      pago_id, tipo_pago, monto, caja_id, cuenta_bancaria_id,
      fecha_transferencia, numero_comprobante_pago, referencia,
      banco, numero_cheque, fecha_cheque, localidad, cuit_emisor,
      color_cheque, cheque_id, fecha_deposito
    ) VALUES (
      v_pago_id,
      v_det->>'tipo_pago',
      (v_det->>'monto')::numeric,
      NULLIF(v_det->>'caja_id', '')::uuid,
      NULLIF(v_det->>'cuenta_bancaria_id', '')::uuid,
      NULLIF(v_det->>'fecha_transferencia', '')::date,
      NULLIF(v_det->>'numero_comprobante_pago', ''),
      NULLIF(v_det->>'referencia', ''),
      NULLIF(v_det->>'banco', ''),
      NULLIF(v_det->>'numero_cheque', ''),
      NULLIF(v_det->>'fecha_cheque', '')::date,
      NULLIF(v_det->>'localidad', ''),
      NULLIF(v_det->>'cuit_emisor', ''),
      NULLIF(v_det->>'color_cheque', ''),
      v_cheque_id,
      NULLIF(v_det->>'fecha_deposito', '')::date
    )
    RETURNING id INTO v_detalle_id;

    -- Ítems de depósito (cheques al banco / efectivo depositado)
    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_det->'deposito_items', '[]'::jsonb))
    LOOP
      v_cheque_id := NULL;
      v_chq := v_item->'cheque';
      IF v_chq IS NOT NULL AND jsonb_typeof(v_chq) = 'object' THEN
        INSERT INTO cheques (
          tipo, estado, banco, numero, fecha_vencimiento, monto, color, es_echeq, cliente_origen_id
        ) VALUES (
          'TERCERO', 'EN_CARTERA',
          COALESCE(v_chq->>'banco', ''),
          COALESCE(v_chq->>'numero', ''),
          NULLIF(v_chq->>'fecha_vencimiento', '')::date,
          COALESCE((v_chq->>'monto')::numeric, (v_item->>'monto')::numeric),
          COALESCE(NULLIF(v_chq->>'color', ''), 'PENDIENTE')::money_color,
          COALESCE((v_chq->>'es_echeq')::boolean, false),
          v_cliente
        )
        RETURNING id INTO v_cheque_id;
      END IF;

      INSERT INTO pago_deposito_items (
        pago_detalle_id, tipo_item, monto, numero_cheque, banco_emisor,
        fecha_pago_cheque, numero_comprobante_deposito, cheque_id,
        fecha_deposito_efectivo, nro_comprobante_deposito_ef
      ) VALUES (
        v_detalle_id,
        v_item->>'tipo_item',
        (v_item->>'monto')::numeric,
        NULLIF(v_item->>'numero_cheque', ''),
        NULLIF(v_item->>'banco_emisor', ''),
        NULLIF(v_item->>'fecha_pago_cheque', '')::date,
        NULLIF(v_item->>'numero_comprobante_deposito', ''),
        v_cheque_id,
        NULLIF(v_item->>'fecha_deposito_efectivo', '')::date,
        NULLIF(v_item->>'nro_comprobante_deposito_ef', '')
      );
    END LOOP;
  END LOOP;

  -- ── Imputaciones (nacen 'pendiente'; cobranza_confirmar las aplica) ──
  FOR v_imp IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'imputaciones', '[]'::jsonb))
  LOOP
    INSERT INTO imputaciones (pago_id, comprobante_id, tipo_comprobante, monto_imputado, estado)
    VALUES (
      v_pago_id,
      (v_imp->>'comprobante_id')::uuid,
      'venta',
      (v_imp->>'monto_imputado')::numeric,
      'pendiente'
    );
  END LOOP;

  RETURN jsonb_build_object('pago_id', v_pago_id, 'dedup', false);
EXCEPTION
  WHEN unique_violation THEN
    -- Carrera entre dos requests con el mismo idempotency_key: devolver el ganador
    IF v_key IS NOT NULL THEN
      SELECT id INTO v_existente FROM pagos_clientes WHERE idempotency_key = v_key;
      IF v_existente IS NOT NULL THEN
        RETURN jsonb_build_object('pago_id', v_existente, 'dedup', true);
      END IF;
    END IF;
    RAISE;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.cobranza_crear(jsonb) TO authenticated, service_role;
