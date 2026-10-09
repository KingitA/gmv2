-- ════════════════════════════════════════════════════════════════════════════
-- Formatos únicos — FECHAS (10/10/2026)
-- Generado leyendo la base (scratchpad gen-fechas.mjs): definiciones reales, no copiadas a mano.
--
-- 1) hoy_ar(): el día de HOY en Argentina. La base corre en UTC, así que
--    CURRENT_DATE después de las 21 h AR ya es "mañana". Se usa en los defaults
--    de las columnas de fecha y en las funciones que usaban CURRENT_DATE.
-- 2) Las 48 columnas "timestamp without time zone" pasan a "timestamptz".
--    Hoy guardan hora UTC sin marca de zona (default now() y nowArgentina()
--    escriben UTC), y el navegador las leía como hora local: se veían 3 h antes.
--    Se convierten indicando que lo guardado es UTC (no cambia ningún instante).
-- No se cambia la zona horaria global de la base a propósito: cambiaría el
-- formato de todas las horas que lee el motor offline de las apps (MOBILE.md).
-- Seguro de re-ejecutar.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.hoy_ar()
returns date
language sql
stable
as $fn$
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date;
$fn$;
grant execute on function public.hoy_ar() to anon, authenticated, service_role;

begin;

-- 1) Defaults de fecha en hora argentina
alter table public.cobranzas alter column fecha set default public.hoy_ar();
alter table public.comprobantes_venta alter column fecha set default public.hoy_ar();
alter table public.cuenta_corriente_ajustes alter column fecha set default public.hoy_ar();
alter table public.finanzas_saldos alter column fecha set default public.hoy_ar();
alter table public.ordenes_pago alter column fecha set default public.hoy_ar();
alter table public.pagos_clientes alter column fecha_pago set default public.hoy_ar();
alter table public.pedidos alter column fecha set default public.hoy_ar();
alter table public.reclamos_devoluciones alter column fecha set default public.hoy_ar();

-- 1b) Funciones que usaban CURRENT_DATE (mismo cuerpo, solo cambia CURRENT_DATE por hoy_ar())
-- cobranza_crear(jsonb)
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
    COALESCE(NULLIF(p_payload->>'fecha_pago', '')::date, public.hoy_ar()),
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

-- fin_crear_pago_proveedor(uuid,money_color,jsonb,numeric,uuid)
CREATE OR REPLACE FUNCTION public.fin_crear_pago_proveedor(p_proveedor_id uuid, p_color money_color, p_items_json jsonb, p_total numeric, p_user_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_pago_prov_id uuid;
    v_item jsonb;
    v_saldo_actual numeric;
    v_cheque_propio_id uuid;
BEGIN
    INSERT INTO pagos_proveedores (proveedor_id, total, color, estado, creado_por)
    VALUES (p_proveedor_id, p_total, p_color, 'CONFIRMADO', p_user_id)
    RETURNING id INTO v_pago_prov_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items_json)
    LOOP
        -- p_items_json: { tipo, id (if existing), monto, aux_id (if cash/bank), banco, numero, fecha_vencimiento, fecha_emision (if propio) }

        IF v_item->>'tipo' = 'CHEQUE' THEN
            -- Cheque Tercero Existente
            UPDATE cheques 
            SET estado = 'ENTREGADO_A_PROVEEDOR', 
                proveedor_destino_id = p_proveedor_id,
                updated_at = now()
            WHERE id = (v_item->>'id')::uuid AND estado = 'EN_CARTERA';
            
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Cheque % no disponible', v_item->>'id';
            END IF;

            INSERT INTO pagos_proveedores_items (pago_proveedor_id, metodo, monto, cheque_id)
            VALUES (v_pago_prov_id, 'CHEQUE_TERCERO', (v_item->>'monto')::numeric, (v_item->>'id')::uuid);

        ELSIF v_item->>'tipo' = 'CHEQUE_PROPIO' THEN
            -- Cheque Propio Nuevo
            INSERT INTO cheques (
                tipo, estado, banco, numero, fecha_emision, fecha_vencimiento, 
                monto, color, proveedor_destino_id, creado_desde_pago_pendiente_id
            )
            VALUES (
                'PROPIO', 'ENTREGADO_A_PROVEEDOR', v_item->>'banco', v_item->>'numero', 
                COALESCE((v_item->>'fecha_emision')::date, public.hoy_ar()), 
                (v_item->>'fecha_vencimiento')::date, 
                (v_item->>'monto')::numeric, p_color, p_proveedor_id, null
            )
            RETURNING id INTO v_cheque_propio_id;

            INSERT INTO pagos_proveedores_items (pago_proveedor_id, metodo, monto, cheque_id)
            VALUES (v_pago_prov_id, 'CHEQUE_PROPIO', (v_item->>'monto')::numeric, v_cheque_propio_id);

        ELSIF v_item->>'tipo' = 'EFECTIVO' OR v_item->>'tipo' = 'BANCO' THEN
            SELECT saldo INTO v_saldo_actual 
            FROM saldos_financieros 
            WHERE cuenta_id = (v_item->>'aux_id')::uuid AND color = p_color 
            FOR UPDATE;

            IF v_saldo_actual IS NULL OR v_saldo_actual < (v_item->>'monto')::numeric THEN
                RAISE EXCEPTION 'Saldo insuficiente en cuenta %', v_item->>'aux_id';
            END IF;

            UPDATE saldos_financieros 
            SET saldo = saldo - (v_item->>'monto')::numeric, updated_at = now()
            WHERE cuenta_id = (v_item->>'aux_id')::uuid AND color = p_color;

            INSERT INTO pagos_proveedores_items (pago_proveedor_id, metodo, monto, origen_tipo, origen_id)
            VALUES (v_pago_prov_id, CASE WHEN v_item->>'tipo'='EFECTIVO' THEN 'EFECTIVO'::payment_method ELSE 'TRANSFERENCIA'::payment_method END, (v_item->>'monto')::numeric, CASE WHEN v_item->>'tipo'='EFECTIVO' THEN 'CAJA'::fund_account_type ELSE 'BANCO'::fund_account_type END, (v_item->>'aux_id')::uuid);

            INSERT INTO movimientos_financieros (kind, origen_tipo, origen_id, destino_tipo, destino_id, metodo, color, monto, referencia_tipo, referencia_id, creado_por)
            VALUES ('EGRESO', CASE WHEN v_item->>'tipo'='EFECTIVO' THEN 'CAJA'::fund_account_type ELSE 'BANCO'::fund_account_type END, (v_item->>'aux_id')::uuid, null, null, CASE WHEN v_item->>'tipo'='EFECTIVO' THEN 'EFECTIVO'::payment_method ELSE 'TRANSFERENCIA'::payment_method END, p_color, (v_item->>'monto')::numeric, 'PAGO_PROVEEDOR', v_pago_prov_id, p_user_id);
            
        END IF;
    END LOOP;

    RETURN json_build_object('success', true, 'pago_id', v_pago_prov_id);
EXCEPTION
    WHEN OTHERS THEN
        RAISE;
END;
$function$;

-- 2) timestamp sin zona → timestamptz (lo guardado es UTC)
-- La vista vista_usuarios_completa depende de usuarios.created_at: se recrea igual.
drop view if exists public.vista_usuarios_completa;
alter table public.articulos_descuentos alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.benchmarks_canal alter column ultima_actualizacion type timestamptz using ultima_actualizacion at time zone 'UTC';
alter table public.clientes alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.clientes_info alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.clientes_info alter column updated_at type timestamptz using updated_at at time zone 'UTC';
alter table public.comprobantes_venta alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.comprobantes_venta_detalle alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.comprobantes_venta_detalle alter column updated_at type timestamptz using updated_at at time zone 'UTC';
alter table public.condiciones_entrega alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.condiciones_pago alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.configuracion_empresa alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.configuracion_empresa alter column updated_at type timestamptz using updated_at at time zone 'UTC';
alter table public.cuenta_corriente_ajustes alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.cuenta_corriente_ajustes alter column updated_at type timestamptz using updated_at at time zone 'UTC';
alter table public.devoluciones alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.devoluciones alter column fecha_confirmacion type timestamptz using fecha_confirmacion at time zone 'UTC';
alter table public.devoluciones alter column updated_at type timestamptz using updated_at at time zone 'UTC';
alter table public.devoluciones_detalle alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.historial_puntajes alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.imputaciones alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.listas_precio alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.localidades alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.metricas_clientes alter column ultima_actualizacion type timestamptz using ultima_actualizacion at time zone 'UTC';
alter table public.numeracion_comprobantes alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.numeracion_comprobantes alter column updated_at type timestamptz using updated_at at time zone 'UTC';
alter table public.pagos_clientes alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.pagos_clientes alter column fecha_confirmacion type timestamptz using fecha_confirmacion at time zone 'UTC';
alter table public.pagos_clientes alter column updated_at type timestamptz using updated_at at time zone 'UTC';
alter table public.pagos_detalle alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.pagos_proveedores alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.pedidos alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.pedidos_detalle alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.reclamos_devoluciones alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.remitos alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.remitos alter column updated_at type timestamptz using updated_at at time zone 'UTC';
alter table public.remitos_detalle alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.roles alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.tipos_canal alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.transportes alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.transportes_destinos alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.usuarios alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.usuarios alter column updated_at type timestamptz using updated_at at time zone 'UTC';
alter table public.usuarios_roles alter column asignado_en type timestamptz using asignado_en at time zone 'UTC';
alter table public.vendedores alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.vendedores_info alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.vendedores_info alter column updated_at type timestamptz using updated_at at time zone 'UTC';
alter table public.viajes alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.zonas alter column created_at type timestamptz using created_at at time zone 'UTC';

create view public.vista_usuarios_completa as
SELECT u.id,
    u.email,
    u.nombre,
    u.telefono,
    u.estado,
    u.created_at,
    array_agg(DISTINCT r.nombre) FILTER (WHERE r.nombre IS NOT NULL) AS roles,
    vi.comision_bazar_limpieza,
    vi.comision_perfumeria,
    ci.razon_social,
    ci.cuit,
    ci.direccion
   FROM usuarios u
     LEFT JOIN usuarios_roles ur ON ur.usuario_id = u.id
     LEFT JOIN roles r ON r.id = ur.rol_id
     LEFT JOIN vendedores_info vi ON vi.usuario_id = u.id
     LEFT JOIN clientes_info ci ON ci.usuario_id = u.id
  GROUP BY u.id, u.email, u.nombre, u.telefono, u.estado, u.created_at, vi.comision_bazar_limpieza, vi.comision_perfumeria, ci.razon_social, ci.cuit, ci.direccion;
;
grant select on public.vista_usuarios_completa to authenticated, service_role, claude_readonly;

-- 3) Vencimiento del CAE guardado como texto → date (los valores ya son AAAA-MM-DD)
alter table public.arca_solicitudes_cae alter column vencimiento_cae type date using nullif(vencimiento_cae, '')::date;

commit;

-- Control:
-- select count(*) from information_schema.columns where table_schema='public' and data_type='timestamp without time zone';  -- 0 en tablas
-- select public.hoy_ar();
