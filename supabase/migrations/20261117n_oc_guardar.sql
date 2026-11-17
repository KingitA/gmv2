-- ─────────────────────────────────────────────────────────────────────────────
-- Orden de compra: crear, editar y cancelar en UNA transacción (Tanda 1-A, 17/11/2026).
-- Prueba integral de entrada: E-04, E-05, E-07, E-08, E-09, E-11 y parte de E-03.
--
-- Qué pasaba:
--   · crear la OC eran 5 escrituras sueltas desde el servidor y editarla era un
--     borrar + insertar desde el NAVEGADOR: si algo fallaba en el medio quedaba una
--     orden sin detalle o sin deuda provisoria (E-07);
--   · el número salía de "la última + 1": dos personas a la vez = mismo número;
--   · la provisión en la cuenta corriente usaba IVA fijo 21 % para todo y SUMABA el
--     % de retención de Ganancias como si fuera deuda (E-08); al editar se reescribía
--     sin impuestos y el kardex pendiente no se actualizaba;
--   · la orden no guardaba la condición de pago ni generaba vencimientos (E-04, E-05);
--   · no se podía cancelar: se borraba físicamente (E-09);
--   · crear la OC pisaba el precio de compra y los descuentos del artículo (E-11).
--
-- Qué agrega:
--   1. Columnas nuevas en ordenes_compra y ordenes_compra_detalle (todas vacías).
--   2. Secuencia de numeración ajustada al último número usado.
--   3. Funciones (todas "todo o nada"; solo las ejecuta el servidor):
--        oc_guardar(orden, usuario, datos)          crear o editar
--        oc_cancelar(orden, usuario, motivo)        cancelar (no borra)
--        oc_marcar_enviada(orden, usuario, datos)   deja constancia del mail enviado
--        oc_totales(orden)                          neto / IVA / percepciones / blanco / negro
--        oc_provision_sincronizar(orden)            deuda provisoria en la cuenta corriente
--        oc_vencimientos_estimados_sincronizar(orden, usuario)
--        oc_vencimiento_estimado_reemplazar(orden, canal, monto)   ← la llama quien valida la factura
--        oc_kardex_pendiente_sincronizar(orden, usuario)           ← APARTE y fácil de quitar (E-31)
--
-- Reglas de plata (las mismas que usa la pantalla, lib/compras/oc-totales.ts):
--   · precio_unitario es SIEMPRE por unidad. Renglón = unidades × precio neto, redondeado a
--     centavos. Precio neto = lista con los descuentos como los aplica el proveedor
--     (proveedores.tipo_descuento: en cascada o sobre precio de lista), sin redondear.
--     Unidades = cantidad × unidades por bulto si el renglón se pide por bulto.
--   · Blanco / negro según el artículo (articulos.iva_compras):
--       factura            → todo con factura (blanco): + IVA 21 % + percepciones
--       adquisicion_stock  → todo sin factura (negro): sin impuestos
--       mixto              → una parte con factura y el resto sin: ordenes_compra.mixto_pct_factura
--                            (viene de la ficha del proveedor; sin dato, 50 %)
--   · Percepciones: percepcion_iva + percepcion_iibb del proveedor, sobre el neto blanco.
--   · La retención de Ganancias NO se suma: no es deuda con el proveedor.
--
-- Vencimiento estimado (E-05): al guardar la orden nace un vencimiento por canal
-- (o uno por cuota) con es_estimado = true y referencia_tipo = 'orden_compra',
-- fecha = fecha estimada de entrega + días del acuerdo. NO toca ningún vencimiento
-- que no sea de ese tipo y de esa orden. Se borra al cancelar y se reemplaza por el
-- real cuando se valida la factura (oc_vencimiento_estimado_reemplazar).
--
-- No modifica datos al instalarse (salvo posicionar la secuencia). Se puede correr
-- más de una vez. El código de la Tanda 1-A NECESITA esta migración para crear,
-- editar, cancelar y enviar órdenes: sin ella la pantalla avisa que falta.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. Columnas ═══
ALTER TABLE public.ordenes_compra
  ADD COLUMN IF NOT EXISTS acuerdo_pago        jsonb,
  ADD COLUMN IF NOT EXISTS mixto_pct_factura   numeric(5,2),
  ADD COLUMN IF NOT EXISTS total_neto          numeric(14,2),
  ADD COLUMN IF NOT EXISTS total_iva           numeric(14,2),
  ADD COLUMN IF NOT EXISTS total_percepciones  numeric(14,2),
  ADD COLUMN IF NOT EXISTS total_blanco        numeric(14,2),
  ADD COLUMN IF NOT EXISTS total_negro         numeric(14,2),
  ADD COLUMN IF NOT EXISTS total_estimado      numeric(14,2),
  ADD COLUMN IF NOT EXISTS cantidad_renglones  int,
  ADD COLUMN IF NOT EXISTS clave_creacion      uuid,
  ADD COLUMN IF NOT EXISTS editada_at          timestamptz,
  ADD COLUMN IF NOT EXISTS editada_por         uuid,
  ADD COLUMN IF NOT EXISTS enviada_at          timestamptz,
  ADD COLUMN IF NOT EXISTS enviada_por         uuid,
  ADD COLUMN IF NOT EXISTS enviada_a           text,
  ADD COLUMN IF NOT EXISTS enviada_cc          text,
  ADD COLUMN IF NOT EXISTS envio_mensaje_id    text,
  ADD COLUMN IF NOT EXISTS envio_hilo_id       text,
  ADD COLUMN IF NOT EXISTS envios              int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelada_at        timestamptz,
  ADD COLUMN IF NOT EXISTS cancelada_por       uuid,
  ADD COLUMN IF NOT EXISTS motivo_cancelacion  text;

COMMENT ON COLUMN public.ordenes_compra.acuerdo_pago IS
  'Acuerdo de pago copiado de la ficha del proveedor al crear la orden (editable en la orden): {"blanco": {medio, dias, cuotas, desde, plazo_cheque, entrega}, "negro": {...} | null}. negro null = igual que blanco.';
COMMENT ON COLUMN public.ordenes_compra.mixto_pct_factura IS
  'Artículos mixtos de esta orden: % que viene con factura (el resto, sin). Copiado de la ficha del proveedor al crear la orden, editable en la orden. NULL = 50.';
COMMENT ON COLUMN public.ordenes_compra.total_estimado IS
  'Lo que se estima deber por la orden: total_blanco (neto + IVA + percepciones) + total_negro. Lo calcula oc_guardar.';
COMMENT ON COLUMN public.ordenes_compra.clave_creacion IS
  'Clave que manda la pantalla al crear: si llega dos veces (doble click, reintento), oc_guardar devuelve la misma orden.';
COMMENT ON COLUMN public.ordenes_compra.editada_at IS
  'Última vez que se cambió el contenido de la orden. Si es posterior a enviada_at, el proveedor tiene una versión vieja.';
COMMENT ON COLUMN public.ordenes_compra.enviada_a IS 'Casillas a las que se mandó la orden por última vez.';
COMMENT ON COLUMN public.ordenes_compra.envio_mensaje_id IS 'Id del mensaje de Gmail del último envío.';
COMMENT ON COLUMN public.ordenes_compra.envios IS 'Cuántas veces se envió (1 = una vez; más = reenvíos).';

CREATE UNIQUE INDEX IF NOT EXISTS uq_ordenes_compra_clave_creacion
  ON public.ordenes_compra (clave_creacion) WHERE clave_creacion IS NOT NULL;

ALTER TABLE public.ordenes_compra_detalle
  ADD COLUMN IF NOT EXISTS orden               int,
  ADD COLUMN IF NOT EXISTS iva_compras         varchar(20),
  ADD COLUMN IF NOT EXISTS unidades_por_bulto  numeric,
  ADD COLUMN IF NOT EXISTS precio_ficha        numeric(20,6),
  ADD COLUMN IF NOT EXISTS precio_neto_ficha   numeric(20,6);

COMMENT ON COLUMN public.ordenes_compra_detalle.iva_compras IS
  'Régimen de compra del artículo al guardar la orden (factura / adquisicion_stock / mixto). Con esto se calcula blanco / negro.';
COMMENT ON COLUMN public.ordenes_compra_detalle.unidades_por_bulto IS
  'Unidades por bulto del artículo al guardar la orden (informativo; el stock usa siempre el del artículo).';
COMMENT ON COLUMN public.ordenes_compra_detalle.precio_ficha IS
  'Precio de compra de lista que tenía el artículo al guardar la orden. El precio pactado es precio_unitario; la orden NO pisa la ficha (E-11).';
COMMENT ON COLUMN public.ordenes_compra_detalle.precio_neto_ficha IS
  'Precio neto (con sus descuentos) que tenía el artículo al guardar la orden, para mostrar la diferencia con lo pactado.';

-- Canal de la provisión en la cuenta corriente: una orden mixta tiene DOS provisiones
-- (con factura / sin factura). Quien convierte la provisión en factura (el mail de una
-- factura, la validación) tiene que tomar la del canal que corresponde, no "la primera".
ALTER TABLE public.cuenta_corriente_proveedores
  ADD COLUMN IF NOT EXISTS canal varchar(10);
DO $$
BEGIN
  ALTER TABLE public.cuenta_corriente_proveedores ADD CONSTRAINT cc_proveedores_canal_check
    CHECK (canal IS NULL OR canal IN ('blanco', 'negro'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
COMMENT ON COLUMN public.cuenta_corriente_proveedores.canal IS
  'Solo en las provisiones de una orden de compra (tipo_movimiento = orden_compra): blanco = lo que viene con factura, negro = sin factura. NULL en el resto y en las provisiones anteriores al 17/11/2026.';

-- Cuenta de Gmail desde la que se mandan las órdenes de compra (la "de compras").
DO $$
BEGIN
  IF to_regclass('public.configuracion_empresa') IS NOT NULL THEN
    ALTER TABLE public.configuracion_empresa ADD COLUMN IF NOT EXISTS mail_compras text;
    COMMENT ON COLUMN public.configuracion_empresa.mail_compras IS
      'Cuenta de Gmail conectada al sistema desde la que salen las órdenes de compra. La elige el primero que envía una orden y queda recordada.';
  END IF;
END $$;

-- ═══ 2. Numeración: secuencia posicionada en el último número usado ═══
CREATE SEQUENCE IF NOT EXISTS public.ordenes_compra_numero_seq START 1;

DO $$
DECLARE
  v_max bigint;
BEGIN
  SELECT coalesce(max((substring(numero_orden from '([0-9]+)$'))::bigint), 0) INTO v_max
    FROM public.ordenes_compra
   WHERE numero_orden ~ '^OC-[0-9]+$';
  IF v_max > 0 THEN
    -- nunca hacia atrás
    PERFORM setval('public.ordenes_compra_numero_seq',
                   greatest(v_max, (SELECT last_value FROM public.ordenes_compra_numero_seq)), true);
  END IF;
END $$;

-- ═══ 3. Precio neto y totales de la orden ═══
-- Precio neto por unidad según cómo aplica el proveedor sus descuentos (proveedores.tipo_descuento):
--   cascada     → lista × (1 − d1) × (1 − d2) × (1 − d3) × (1 − d4)
--   sobre_lista → lista × (1 − (d1 + d2 + d3 + d4))
-- Misma regla que netoCompra (lib/compras/neto-compra.ts). Sin redondear.
CREATE OR REPLACE FUNCTION public.oc_neto_unitario(
  p_precio numeric, p_d1 numeric, p_d2 numeric, p_d3 numeric, p_d4 numeric, p_tipo text
) RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN p_tipo = 'sobre_lista'
    THEN coalesce(p_precio, 0) * greatest(0, 1 - (coalesce(p_d1, 0) + coalesce(p_d2, 0) + coalesce(p_d3, 0) + coalesce(p_d4, 0)) / 100.0)
    ELSE coalesce(p_precio, 0)
         * (1 - coalesce(p_d1, 0) / 100.0) * (1 - coalesce(p_d2, 0) / 100.0)
         * (1 - coalesce(p_d3, 0) / 100.0) * (1 - coalesce(p_d4, 0) / 100.0)
  END
$$;
CREATE OR REPLACE FUNCTION public.oc_totales(p_orden_id uuid)
RETURNS TABLE (
  neto_blanco  numeric,
  neto_negro   numeric,
  iva          numeric,
  percepciones numeric,
  total_blanco numeric,
  total_negro  numeric,
  total        numeric,
  renglones    int,
  unidades     numeric
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_perc  numeric := 0;
  v_tipo  text;
  v_mixto numeric;
BEGIN
  SELECT coalesce(p.percepcion_iva, 0) + coalesce(p.percepcion_iibb, 0), p.tipo_descuento, o.mixto_pct_factura
    INTO v_perc, v_tipo, v_mixto
    FROM ordenes_compra o JOIN proveedores p ON p.id = o.proveedor_id
   WHERE o.id = p_orden_id;
  v_perc := coalesce(v_perc, 0);
  -- parte con factura de los artículos mixtos: la de la orden; sin dato, 50 %
  v_mixto := CASE WHEN v_mixto IS NULL OR v_mixto < 0 OR v_mixto > 100 THEN 50 ELSE v_mixto END;

  RETURN QUERY
  WITH l AS (
    SELECT
      -- unidades base del renglón (misma regla que lib/deposito/unidades.ts)
      round(d.cantidad_pedida * CASE WHEN d.tipo_cantidad = 'unidad' THEN 1
                                     WHEN coalesce(a.unidades_por_bulto, 1) > 1 THEN a.unidades_por_bulto
                                     ELSE 1 END, 4) AS unid,
      -- precio neto por unidad, sin redondear, con los descuentos como los aplica el proveedor
      public.oc_neto_unitario(d.precio_unitario, d.descuento1, d.descuento2, d.descuento3, d.descuento4, v_tipo) AS neto_u,
      coalesce(nullif(d.iva_compras, ''), nullif(a.iva_compras, ''), 'factura') AS regimen
    FROM ordenes_compra_detalle d
    JOIN articulos a ON a.id = d.articulo_id
    WHERE d.orden_compra_id = p_orden_id
  ), r AS (
    SELECT unid, regimen, round(unid * neto_u, 2) AS neto FROM l
  ), s AS (
    SELECT
      coalesce(sum(CASE regimen WHEN 'adquisicion_stock' THEN 0
                                WHEN 'mixto' THEN round(neto * v_mixto / 100.0, 2)
                                ELSE neto END), 0) AS nb,
      coalesce(sum(CASE regimen WHEN 'adquisicion_stock' THEN neto
                                WHEN 'mixto' THEN neto - round(neto * v_mixto / 100.0, 2)
                                ELSE 0 END), 0) AS nn,
      count(*)::int AS n,
      coalesce(sum(unid), 0) AS u
    FROM r
  )
  SELECT s.nb, s.nn,
         round(s.nb * 0.21, 2),
         round(s.nb * v_perc / 100.0, 2),
         s.nb + round(s.nb * 0.21, 2) + round(s.nb * v_perc / 100.0, 2),
         s.nn,
         s.nb + round(s.nb * 0.21, 2) + round(s.nb * v_perc / 100.0, 2) + s.nn,
         s.n, s.u
    FROM s;
END;
$$;

COMMENT ON FUNCTION public.oc_totales(uuid) IS
  'Totales de una orden de compra: neto blanco / negro, IVA 21 % y percepciones sobre el blanco, total estimado. Misma cuenta que lib/compras/oc-totales.ts.';

-- ═══ 4. Provisión en la cuenta corriente del proveedor ═══
-- Un movimiento por canal (con factura / sin factura). Al validar los comprobantes,
-- comprobante_compra_validar la va bajando y la borra (recorre todos los movimientos
-- 'orden_compra' de la orden, sean uno o dos).
CREATE OR REPLACE FUNCTION public.oc_provision_sincronizar(p_orden_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  o record;
  t record;
BEGIN
  SELECT id, numero_orden, proveedor_id, estado, fecha_orden INTO o FROM ordenes_compra WHERE id = p_orden_id;
  IF NOT FOUND THEN RETURN; END IF;

  DELETE FROM cuenta_corriente_proveedores
   WHERE referencia_tipo = 'orden_compra' AND referencia_id = p_orden_id AND tipo_movimiento = 'orden_compra';

  IF o.estado = 'cancelada' THEN RETURN; END IF;

  SELECT * INTO t FROM oc_totales(p_orden_id);

  IF coalesce(t.total_blanco, 0) > 0 THEN
    INSERT INTO cuenta_corriente_proveedores (proveedor_id, tipo_movimiento, canal, monto, descripcion, referencia_id, referencia_tipo, fecha)
    VALUES (o.proveedor_id, 'orden_compra', 'blanco', t.total_blanco,
            'Provisión OC: ' || o.numero_orden || ' — con factura (neto + IVA'
              || CASE WHEN t.percepciones > 0 THEN ' + percepciones' ELSE '' END || ', estimado)',
            p_orden_id, 'orden_compra', coalesce(o.fecha_orden, now()));
  END IF;
  IF coalesce(t.total_negro, 0) > 0 THEN
    INSERT INTO cuenta_corriente_proveedores (proveedor_id, tipo_movimiento, canal, monto, descripcion, referencia_id, referencia_tipo, fecha)
    VALUES (o.proveedor_id, 'orden_compra', 'negro', t.total_negro,
            'Provisión OC: ' || o.numero_orden || ' — sin factura (estimado)',
            p_orden_id, 'orden_compra', coalesce(o.fecha_orden, now()));
  END IF;
END;
$$;

-- ═══ 5. Vencimientos estimados de la orden ═══
-- Borra SOLO los estimados de esta orden que nadie pagó ni imputó.
CREATE OR REPLACE FUNCTION public.oc_vencimientos_estimados_borrar(p_orden_id uuid, p_canal text DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_n int;
BEGIN
  DELETE FROM vencimientos v
   WHERE v.referencia_tipo = 'orden_compra'
     AND v.referencia_id = p_orden_id
     AND v.es_estimado = true
     AND v.estado IN ('pendiente', 'vencido')
     AND v.orden_pago_id IS NULL
     AND (p_canal IS NULL OR v.canal = p_canal)
     AND NOT EXISTS (SELECT 1 FROM ordenes_pago_imputaciones i WHERE i.vencimiento_id = v.id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.oc_vencimientos_estimados_sincronizar(p_orden_id uuid, p_usuario_id uuid DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  o          record;
  t          record;
  v_canal    text;
  v_total    numeric;
  v_ac       jsonb;
  v_base     date;
  v_dias     int[];
  v_n        int;
  v_i        int;
  v_monto    numeric;
  v_resto    numeric;
  v_fecha    date;
  v_medio    text;
  v_forma    text;
  v_modal    text;
  v_valid    date;
  v_plazo    int;
  v_creados  int := 0;
  v_sin_ac   boolean;
BEGIN
  SELECT id, numero_orden, proveedor_id, estado, fecha_estimada_recepcion, acuerdo_pago
    INTO o FROM ordenes_compra WHERE id = p_orden_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  PERFORM public.oc_vencimientos_estimados_borrar(p_orden_id, NULL);
  IF o.estado = 'cancelada' THEN RETURN 0; END IF;

  -- Si ya hay un estimado de esta orden que alguien pagó o imputó, no se generan otros
  IF EXISTS (SELECT 1 FROM vencimientos WHERE referencia_tipo = 'orden_compra' AND referencia_id = p_orden_id AND es_estimado = true AND estado <> 'cancelado') THEN
    RETURN 0;
  END IF;

  SELECT * INTO t FROM oc_totales(p_orden_id);
  -- Una orden vieja (fecha de entrega ya pasada) no genera vencimientos con fecha pasada:
  -- el plazo corre desde hoy.
  v_base := greatest(coalesce(o.fecha_estimada_recepcion, public.hoy_ar()), public.hoy_ar());

  FOREACH v_canal IN ARRAY ARRAY['blanco', 'negro'] LOOP
    v_total := CASE WHEN v_canal = 'blanco' THEN t.total_blanco ELSE t.total_negro END;
    IF coalesce(v_total, 0) <= 0 THEN CONTINUE; END IF;

    -- Acuerdo del canal; negro sin acuerdo propio = el de blanco
    v_ac := o.acuerdo_pago -> v_canal;
    IF v_canal = 'negro' AND (v_ac IS NULL OR jsonb_typeof(v_ac) <> 'object'
        OR (nullif(v_ac ->> 'medio', '') IS NULL AND nullif(v_ac ->> 'dias', '') IS NULL AND nullif(v_ac ->> 'entrega', '') IS NULL AND nullif(v_ac ->> 'cuotas', '') IS NULL)) THEN
      v_ac := o.acuerdo_pago -> 'blanco';
    END IF;
    IF v_ac IS NULL OR jsonb_typeof(v_ac) <> 'object' THEN v_ac := '{}'::jsonb; END IF;

    -- Días: cuotas "30/60/90" o un solo plazo
    v_dias := NULL;
    IF nullif(v_ac ->> 'cuotas', '') IS NOT NULL AND (v_ac ->> 'cuotas') ~ '^[0-9]{1,3}(/[0-9]{1,3})*$' THEN
      v_dias := string_to_array(v_ac ->> 'cuotas', '/')::int[];
    ELSIF nullif(v_ac ->> 'dias', '') IS NOT NULL AND (v_ac ->> 'dias') ~ '^[0-9]{1,4}$' THEN
      v_dias := ARRAY[(v_ac ->> 'dias')::int];
    END IF;
    v_sin_ac := v_dias IS NULL;
    IF v_sin_ac THEN v_dias := ARRAY[0]; END IF;

    v_medio := nullif(v_ac ->> 'medio', '');
    v_forma := CASE v_medio WHEN 'transferencia' THEN 'transferencia'
                            WHEN 'efectivo' THEN 'efectivo'
                            WHEN 'cheques' THEN 'cheque'
                            WHEN 'cheques_y_efectivo' THEN 'cheque'
                            WHEN 'echeq' THEN 'cheque'
                            ELSE NULL END;
    v_modal := CASE nullif(v_ac ->> 'entrega', '') WHEN 'deposito_bancario' THEN 'deposito'
                                                    WHEN 'retira_oficina' THEN 'entrega'
                                                    WHEN 'envio_grimar' THEN 'grimar'
                                                    ELSE NULL END;
    v_plazo := CASE WHEN (v_ac ->> 'plazo_cheque') ~ '^[0-9]{1,4}$' THEN (v_ac ->> 'plazo_cheque')::int ELSE 0 END;

    v_n := array_length(v_dias, 1);
    v_resto := v_total;
    FOR v_i IN 1 .. v_n LOOP
      v_monto := CASE WHEN v_i = v_n THEN v_resto ELSE round(v_total / v_n, 2) END;
      v_resto := v_resto - v_monto;
      v_fecha := v_base + v_dias[v_i];
      v_valid := CASE WHEN v_forma = 'cheque' AND v_plazo > 0 THEN v_fecha + v_plazo ELSE NULL END;

      INSERT INTO vencimientos (
        proveedor_id, tipo, canal, concepto, monto, fecha_vencimiento, estado,
        forma_pago, modalidad, fecha_validez, referencia_id, referencia_tipo,
        es_estimado, descuentos_aplicados, observaciones, creado_por, actualizado_por
      ) VALUES (
        o.proveedor_id, 'factura', v_canal,
        'ESTIMADO ' || o.numero_orden
          || CASE WHEN v_canal = 'negro' THEN ' (sin factura)' ELSE '' END
          || CASE WHEN v_n > 1 THEN ' — cuota ' || v_i || '/' || v_n ELSE '' END
          || ' — falta la factura',
        v_monto, v_fecha, 'pendiente',
        v_forma, v_modal, v_valid, p_orden_id, 'orden_compra',
        true, false,
        'Vencimiento ESTIMADO, generado por la orden de compra ' || o.numero_orden
          || ': fecha estimada de entrega + ' || v_dias[v_i] || ' días. Se reemplaza por el real al validar la factura y se borra si la orden se cancela.'
          || CASE WHEN v_sin_ac THEN ' El proveedor no tiene acuerdo de pago cargado: se tomó la fecha de entrega.' ELSE '' END
          || CASE WHEN v_ac ->> 'de_legado' = 'true' THEN ' ACUERDO DE PAGO SIN CARGAR: el plazo salió del dato viejo de la ficha del proveedor (plazo en días). Cargar el acuerdo en la ficha fiscal.' ELSE '' END,
        p_usuario_id, p_usuario_id
      );
      v_creados := v_creados + 1;
    END LOOP;
  END LOOP;

  RETURN v_creados;
END;
$$;

-- La llama quien valida la factura (Tanda 1-B) y quien finaliza la orden:
--   oc_vencimiento_estimado_reemplazar(orden)                 → borra todos los estimados de la orden
--   oc_vencimiento_estimado_reemplazar(orden, 'blanco')       → solo los de ese canal
--   oc_vencimiento_estimado_reemplazar(orden, 'blanco', 1000) → descuenta $1.000 de los estimados de ese
--        canal (del más próximo al más lejano) y borra los que quedan en cero: para cuando la orden se
--        factura en partes y todavía falta facturar el resto.
-- Devuelve cuántos vencimientos estimados borró. Nunca toca un vencimiento que no sea estimado de esa orden.
CREATE OR REPLACE FUNCTION public.oc_vencimiento_estimado_reemplazar(
  p_orden_id uuid,
  p_canal    text    DEFAULT NULL,
  p_monto    numeric DEFAULT NULL
) RETURNS int
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v        record;
  v_resto  numeric;
  v_n      int := 0;
BEGIN
  IF p_orden_id IS NULL THEN RETURN 0; END IF;
  IF p_canal IS NOT NULL AND p_canal NOT IN ('blanco', 'negro') THEN
    RAISE EXCEPTION 'oc_vencimiento_estimado_reemplazar: canal inválido (%)', p_canal;
  END IF;

  IF p_monto IS NULL THEN
    RETURN public.oc_vencimientos_estimados_borrar(p_orden_id, p_canal);
  END IF;

  v_resto := p_monto;
  FOR v IN
    SELECT ve.id, ve.monto FROM vencimientos ve
     WHERE ve.referencia_tipo = 'orden_compra' AND ve.referencia_id = p_orden_id
       AND ve.es_estimado = true AND ve.estado IN ('pendiente', 'vencido')
       AND ve.orden_pago_id IS NULL
       AND (p_canal IS NULL OR ve.canal = p_canal)
       AND NOT EXISTS (SELECT 1 FROM ordenes_pago_imputaciones i WHERE i.vencimiento_id = ve.id)
     ORDER BY ve.fecha_vencimiento, ve.created_at
       FOR UPDATE
  LOOP
    EXIT WHEN v_resto <= 0.01;
    IF v.monto - v_resto <= 0.01 THEN
      DELETE FROM vencimientos WHERE id = v.id;
      v_resto := v_resto - v.monto;
      v_n := v_n + 1;
    ELSE
      UPDATE vencimientos SET monto = round(v.monto - v_resto, 2), updated_at = now() WHERE id = v.id;
      v_resto := 0;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$$;

COMMENT ON FUNCTION public.oc_vencimiento_estimado_reemplazar(uuid, text, numeric) IS
  'Quita (o descuenta) los vencimientos ESTIMADOS que generó una orden de compra, cuando llega el vencimiento real de la factura. Llamarla dentro de la misma transacción que crea el vencimiento real.';

-- ═══ 6. Kardex pendiente ("stock en camino") ═══
-- APARTE A PROPÓSITO (E-31): la Tanda 1-B va a definir una sola fuente para el kardex de
-- compra. Si el "en camino" pasa a leerse de la orden, alcanza con vaciar esta función
-- (o dejar de llamarla desde oc_guardar / oc_cancelar): nada más depende de ella.
CREATE OR REPLACE FUNCTION public.oc_kardex_pendiente_sincronizar(p_orden_id uuid, p_usuario_id uuid DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  o    record;
  v_n  int := 0;
BEGIN
  SELECT id, proveedor_id, estado, fecha_estimada_recepcion INTO o FROM ordenes_compra WHERE id = p_orden_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  DELETE FROM kardex
   WHERE orden_compra_id = p_orden_id AND tipo_movimiento = 'compra' AND estado = 'pendiente';

  IF o.estado NOT IN ('pendiente', 'enviada', 'confirmada', 'en_camino') THEN RETURN 0; END IF;

  INSERT INTO kardex (
    fecha, tipo_movimiento, signo, estado,
    articulo_id, articulo_sku, articulo_descripcion, articulo_categoria, articulo_marca_id,
    articulo_proveedor_id, articulo_iva_compras, articulo_iva_ventas,
    cantidad, proveedor_id,
    precio_lista, precio_unitario_final, subtotal_neto, subtotal_total,
    descuento_proveedor_pct, descuento_proveedor_financiero_pct, descuento_proveedor_comercial_pct,
    color_dinero, orden_compra_id, comprador_id, operador_id
  )
  SELECT
    -- mediodía argentino de la fecha estimada (timestamptz)
    ((coalesce(o.fecha_estimada_recepcion, public.hoy_ar()) + time '12:00') AT TIME ZONE 'America/Argentina/Buenos_Aires'),
    'compra', 1, 'pendiente',
    a.id, a.sku, a.descripcion, a.categoria, a.marca_id,
    a.proveedor_id, a.iva_compras, a.iva_ventas,
    x.unid, o.proveedor_id,
    d.precio_unitario, x.neto_u, round(x.unid * x.neto_u, 2), round(x.unid * x.neto_u, 2),
    nullif(d.descuento1, 0), nullif(d.descuento2, 0), nullif(d.descuento3, 0),
    CASE a.iva_compras WHEN 'adquisicion_stock' THEN 'NEGRO' WHEN 'factura' THEN 'BLANCO' ELSE NULL END,
    p_orden_id, p_usuario_id, p_usuario_id
  FROM ordenes_compra_detalle d
  JOIN articulos a ON a.id = d.articulo_id
  CROSS JOIN LATERAL (
    SELECT
      round(d.cantidad_pedida * CASE WHEN d.tipo_cantidad = 'unidad' THEN 1
                                     WHEN coalesce(a.unidades_por_bulto, 1) > 1 THEN a.unidades_por_bulto
                                     ELSE 1 END, 4) AS unid,
      public.oc_neto_unitario(d.precio_unitario, d.descuento1, d.descuento2, d.descuento3, d.descuento4,
                              (SELECT p.tipo_descuento FROM proveedores p WHERE p.id = o.proveedor_id)) AS neto_u
  ) x
  WHERE d.orden_compra_id = p_orden_id AND x.unid > 0;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

COMMENT ON FUNCTION public.oc_kardex_pendiente_sincronizar(uuid, uuid) IS
  'Rehace el kardex "compra / pendiente" (stock en camino) de una orden de compra. Aislada para poder quitarla cuando el kardex de compra tenga una sola fuente (E-31).';

-- ═══ 7. Crear / editar ═══
-- p_orden_id NULL = crear. p_datos:
--   { proveedor_id, observaciones, fecha_estimada_recepcion, condicion_pago, acuerdo_pago, clave,
--     items: [{ articulo_id, cantidad_pedida, tipo_cantidad, precio_unitario, descuento1..4 }] }
CREATE OR REPLACE FUNCTION public.oc_guardar(
  p_orden_id   uuid,
  p_usuario_id uuid,
  p_datos      jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_items      jsonb := coalesce(p_datos -> 'items', '[]'::jsonb);
  v_prov       uuid  := nullif(p_datos ->> 'proveedor_id', '')::uuid;
  v_clave      uuid  := nullif(p_datos ->> 'clave', '')::uuid;
  v_fecha_est  date  := nullif(p_datos ->> 'fecha_estimada_recepcion', '')::date;
  v_acuerdo    jsonb := CASE WHEN jsonb_typeof(p_datos -> 'acuerdo_pago') = 'object' THEN p_datos -> 'acuerdo_pago' ELSE NULL END;
  v_mixto      numeric := CASE WHEN coalesce(p_datos ->> 'mixto_pct_factura', '') ~ '^[0-9]+(\.[0-9]+)?$'
                                AND (p_datos ->> 'mixto_pct_factura')::numeric <= 100
                               THEN (p_datos ->> 'mixto_pct_factura')::numeric ELSE NULL END;
  v_id         uuid;
  v_numero     text;
  v_nueva      boolean := false;
  o            record;
  v_n          int;
  v_malos      int;
  v_seq        bigint;
  t            record;
  v_venc       int;
  v_kardex     int;
BEGIN
  -- ── Controles de lo que llega ──
  IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'La orden no tiene artículos con cantidad.' USING ERRCODE = 'P0001', DETAIL = 'sin_items';
  END IF;

  SELECT count(*) INTO v_malos FROM jsonb_array_elements(v_items) e
   WHERE coalesce(e ->> 'articulo_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  IF v_malos > 0 THEN
    RAISE EXCEPTION 'Hay % renglón(es) sin artículo vinculado. Vinculalos a un artículo del catálogo o sacalos de la orden.', v_malos
      USING ERRCODE = 'P0001', DETAIL = 'items_sin_articulo';
  END IF;

  SELECT count(*) INTO v_malos FROM jsonb_array_elements(v_items) e
   WHERE NOT (coalesce(e ->> 'cantidad_pedida', '') ~ '^[0-9]+(\.[0-9]+)?$' AND (e ->> 'cantidad_pedida')::numeric > 0);
  IF v_malos > 0 THEN
    RAISE EXCEPTION 'Hay % renglón(es) con cantidad en cero o inválida.', v_malos USING ERRCODE = 'P0001', DETAIL = 'cantidad_invalida';
  END IF;

  SELECT count(*) INTO v_malos FROM jsonb_array_elements(v_items) e
   WHERE NOT (coalesce(e ->> 'precio_unitario', '0') ~ '^[0-9]+(\.[0-9]+)?$');
  IF v_malos > 0 THEN
    RAISE EXCEPTION 'Hay % renglón(es) con el precio inválido.', v_malos USING ERRCODE = 'P0001', DETAIL = 'precio_invalido';
  END IF;

  SELECT count(*) INTO v_malos FROM jsonb_array_elements(v_items) e, LATERAL (VALUES ('descuento1'), ('descuento2'), ('descuento3'), ('descuento4')) k(c)
   WHERE NOT (coalesce(nullif(e ->> k.c, ''), '0') ~ '^[0-9]+(\.[0-9]+)?$' AND coalesce(nullif(e ->> k.c, ''), '0')::numeric <= 100);
  IF v_malos > 0 THEN
    RAISE EXCEPTION 'Hay descuentos inválidos (tienen que estar entre 0 y 100).' USING ERRCODE = 'P0001', DETAIL = 'descuento_invalido';
  END IF;

  SELECT count(*) INTO v_malos FROM (
    SELECT lower(e ->> 'articulo_id') FROM jsonb_array_elements(v_items) e GROUP BY 1 HAVING count(*) > 1
  ) rep;
  IF v_malos > 0 THEN
    RAISE EXCEPTION 'Hay % artículo(s) repetido(s) en la orden. Dejá un solo renglón por artículo.', v_malos
      USING ERRCODE = 'P0001', DETAIL = 'articulo_repetido';
  END IF;

  SELECT count(*) INTO v_malos FROM jsonb_array_elements(v_items) e
   WHERE NOT EXISTS (SELECT 1 FROM articulos a WHERE a.id = (e ->> 'articulo_id')::uuid);
  IF v_malos > 0 THEN
    RAISE EXCEPTION 'Hay % artículo(s) de la orden que ya no existe(n) en el catálogo.', v_malos
      USING ERRCODE = 'P0001', DETAIL = 'articulo_inexistente';
  END IF;

  IF p_orden_id IS NULL THEN
    -- ── Crear ──
    IF v_prov IS NULL OR NOT EXISTS (SELECT 1 FROM proveedores WHERE id = v_prov) THEN
      RAISE EXCEPTION 'Elegí el proveedor de la orden.' USING ERRCODE = 'P0001', DETAIL = 'sin_proveedor';
    END IF;

    -- Doble click / reintento: la misma clave devuelve la misma orden
    IF v_clave IS NOT NULL THEN
      SELECT id, numero_orden INTO v_id, v_numero FROM ordenes_compra WHERE clave_creacion = v_clave;
      IF FOUND THEN
        RETURN jsonb_build_object('success', true, 'repetida', true, 'orden_id', v_id, 'numero_orden', v_numero);
      END IF;
    END IF;

    -- Número: secuencia (sin carreras). Si alguien cargó a mano un número más alto, se saltea.
    LOOP
      v_seq := nextval('public.ordenes_compra_numero_seq');
      v_numero := 'OC-' || lpad(v_seq::text, 6, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM ordenes_compra WHERE numero_orden = v_numero);
    END LOOP;

    BEGIN
      INSERT INTO ordenes_compra (
        numero_orden, proveedor_id, fecha_orden, fecha_estimada_recepcion, estado,
        observaciones, condicion_pago, acuerdo_pago, mixto_pct_factura, usuario_creador, creado_por, clave_creacion
      ) VALUES (
        v_numero, v_prov, now(), v_fecha_est, 'pendiente',
        nullif(trim(coalesce(p_datos ->> 'observaciones', '')), ''),
        nullif(left(trim(coalesce(p_datos ->> 'condicion_pago', '')), 100), ''),
        v_acuerdo, v_mixto, p_usuario_id::text, p_usuario_id, v_clave
      ) RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
      -- otra llamada con la misma clave ganó la carrera
      SELECT id, numero_orden INTO v_id, v_numero FROM ordenes_compra WHERE clave_creacion = v_clave;
      IF FOUND THEN
        RETURN jsonb_build_object('success', true, 'repetida', true, 'orden_id', v_id, 'numero_orden', v_numero);
      END IF;
      RAISE;
    END;
    v_nueva := true;
  ELSE
    -- ── Editar ──
    SELECT * INTO o FROM ordenes_compra WHERE id = p_orden_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La orden no existe (puede que la hayan eliminado).' USING ERRCODE = 'P0002', DETAIL = 'no_encontrada';
    END IF;
    IF o.estado NOT IN ('pendiente', 'enviada', 'confirmada', 'en_camino') THEN
      RAISE EXCEPTION 'La orden % está % y ya no se puede modificar.', o.numero_orden, replace(o.estado, '_', ' ')
        USING ERRCODE = 'P0001', DETAIL = 'estado_no_editable';
    END IF;
    IF v_prov IS NOT NULL AND v_prov <> o.proveedor_id THEN
      RAISE EXCEPTION 'No se puede cambiar el proveedor de una orden ya creada. Cancelala y hacé una nueva.'
        USING ERRCODE = 'P0001', DETAIL = 'proveedor_cambiado';
    END IF;
    IF EXISTS (SELECT 1 FROM recepciones r WHERE r.orden_compra_id = p_orden_id AND r.estado IN ('en_proceso', 'finalizada')) THEN
      RAISE EXCEPTION 'La orden % ya tiene una recepción en depósito: no se puede modificar.', o.numero_orden
        USING ERRCODE = 'P0001', DETAIL = 'con_recepcion';
    END IF;
    -- Con un comprobante cargado (aunque no esté validado) la orden no se toca: la factura que
    -- entra por mail ya convirtió la provisión en deuda y creó su vencimiento; rehacer la
    -- provisión y los estimados duplicaría las dos cosas. Misma regla que oc_cancelar.
    IF EXISTS (SELECT 1 FROM comprobantes_compra c WHERE c.orden_compra_id = p_orden_id AND c.estado <> 'esperada') THEN
      RAISE EXCEPTION 'La orden % ya tiene comprobantes cargados: no se puede modificar. Si hay que cambiarla, eliminá primero los comprobantes desde la verificación.', o.numero_orden
        USING ERRCODE = 'P0001', DETAIL = 'con_comprobantes';
    END IF;

    v_id := p_orden_id;
    v_numero := o.numero_orden;
    v_prov := o.proveedor_id;

    UPDATE ordenes_compra SET
      observaciones            = nullif(trim(coalesce(p_datos ->> 'observaciones', '')), ''),
      fecha_estimada_recepcion = coalesce(v_fecha_est, fecha_estimada_recepcion),
      condicion_pago           = CASE WHEN p_datos ? 'condicion_pago' THEN nullif(left(trim(coalesce(p_datos ->> 'condicion_pago', '')), 100), '') ELSE condicion_pago END,
      acuerdo_pago             = CASE WHEN p_datos ? 'acuerdo_pago' THEN v_acuerdo ELSE acuerdo_pago END,
      mixto_pct_factura        = CASE WHEN p_datos ? 'mixto_pct_factura' THEN v_mixto ELSE mixto_pct_factura END,
      editada_at               = now(),
      editada_por              = p_usuario_id,
      updated_at               = now()
    WHERE id = v_id;

    DELETE FROM ordenes_compra_detalle WHERE orden_compra_id = v_id;
  END IF;

  -- ── Detalle (con la foto del artículo al momento de guardar) ──
  INSERT INTO ordenes_compra_detalle (
    orden_compra_id, articulo_id, cantidad_pedida, tipo_cantidad, precio_unitario,
    descuento1, descuento2, descuento3, descuento4,
    orden, iva_compras, unidades_por_bulto, precio_ficha, precio_neto_ficha
  )
  SELECT
    v_id, a.id, (e.item ->> 'cantidad_pedida')::numeric,
    CASE WHEN e.item ->> 'tipo_cantidad' = 'unidad' THEN 'unidad' ELSE 'bulto' END,
    coalesce(nullif(e.item ->> 'precio_unitario', ''), '0')::numeric,
    coalesce(nullif(e.item ->> 'descuento1', ''), '0')::numeric,
    coalesce(nullif(e.item ->> 'descuento2', ''), '0')::numeric,
    coalesce(nullif(e.item ->> 'descuento3', ''), '0')::numeric,
    coalesce(nullif(e.item ->> 'descuento4', ''), '0')::numeric,
    e.pos::int,
    coalesce(nullif(a.iva_compras, ''), 'factura'),
    CASE WHEN coalesce(a.unidades_por_bulto, 1) > 1 THEN a.unidades_por_bulto ELSE 1 END,
    a.precio_compra,
    public.oc_neto_unitario(a.precio_compra, a.descuento1, a.descuento2, a.descuento3, a.descuento4,
                            (SELECT p.tipo_descuento FROM proveedores p WHERE p.id = v_prov))
  FROM jsonb_array_elements(v_items) WITH ORDINALITY AS e(item, pos)
  JOIN articulos a ON a.id = (e.item ->> 'articulo_id')::uuid;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- ── Totales en la cabecera ──
  SELECT * INTO t FROM oc_totales(v_id);
  UPDATE ordenes_compra SET
    total_neto         = t.neto_blanco + t.neto_negro,
    total_iva          = t.iva,
    total_percepciones = t.percepciones,
    total_blanco       = t.total_blanco,
    total_negro        = t.total_negro,
    total_estimado     = t.total,
    cantidad_renglones = t.renglones
  WHERE id = v_id;

  -- ── Cuenta corriente, vencimientos estimados y stock en camino ──
  PERFORM public.oc_provision_sincronizar(v_id);
  v_venc   := public.oc_vencimientos_estimados_sincronizar(v_id, p_usuario_id);
  v_kardex := public.oc_kardex_pendiente_sincronizar(v_id, p_usuario_id);

  RETURN jsonb_build_object(
    'success', true, 'repetida', false, 'nueva', v_nueva,
    'orden_id', v_id, 'numero_orden', v_numero, 'renglones', v_n,
    'total_neto', t.neto_blanco + t.neto_negro, 'total_iva', t.iva, 'total_percepciones', t.percepciones,
    'total_blanco', t.total_blanco, 'total_negro', t.total_negro, 'total_estimado', t.total,
    'vencimientos_estimados', v_venc, 'kardex_pendiente', v_kardex
  );
END;
$$;

COMMENT ON FUNCTION public.oc_guardar(uuid, uuid, jsonb) IS
  'Crea o edita una orden de compra: número por secuencia, cabecera, detalle, provisión en cuenta corriente, vencimientos estimados y stock en camino. Todo o nada (E-07, E-08).';

-- ═══ 8. Cancelar ═══
CREATE OR REPLACE FUNCTION public.oc_cancelar(
  p_orden_id   uuid,
  p_usuario_id uuid,
  p_motivo     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  o       record;
  v_comp  int;
BEGIN
  SELECT * INTO o FROM ordenes_compra WHERE id = p_orden_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La orden no existe (puede que la hayan eliminado).' USING ERRCODE = 'P0002', DETAIL = 'no_encontrada';
  END IF;
  IF o.estado = 'cancelada' THEN
    RETURN jsonb_build_object('success', true, 'ya_cancelada', true, 'orden_id', p_orden_id, 'numero_orden', o.numero_orden);
  END IF;
  IF o.estado NOT IN ('pendiente', 'enviada', 'confirmada', 'en_camino') THEN
    RAISE EXCEPTION 'La orden % está % : ya no se puede cancelar.', o.numero_orden, replace(o.estado, '_', ' ')
      USING ERRCODE = 'P0001', DETAIL = 'estado_no_cancelable';
  END IF;
  IF EXISTS (SELECT 1 FROM recepciones r WHERE r.orden_compra_id = p_orden_id AND r.estado IN ('en_proceso', 'finalizada')) THEN
    RAISE EXCEPTION 'La orden % ya tiene una recepción en depósito: no se puede cancelar.', o.numero_orden
      USING ERRCODE = 'P0001', DETAIL = 'con_recepcion';
  END IF;
  SELECT count(*) INTO v_comp FROM comprobantes_compra c WHERE c.orden_compra_id = p_orden_id AND c.estado <> 'esperada';
  IF v_comp > 0 THEN
    RAISE EXCEPTION 'La orden % tiene % comprobante(s) cargado(s). Eliminalos desde la verificación antes de cancelarla.', o.numero_orden, v_comp
      USING ERRCODE = 'P0001', DETAIL = 'con_comprobantes';
  END IF;

  UPDATE ordenes_compra SET
    estado = 'cancelada', cancelada_at = now(), cancelada_por = p_usuario_id,
    motivo_cancelacion = nullif(trim(coalesce(p_motivo, '')), ''), updated_at = now()
  WHERE id = p_orden_id;

  -- Recepciones en borrador (las crea la oficina al subir un documento): quedan canceladas
  UPDATE recepciones SET estado = 'cancelada', updated_at = now()
   WHERE orden_compra_id = p_orden_id AND estado = 'borrador';

  -- Con la orden ya cancelada, cada "sincronizar" solo limpia lo suyo
  PERFORM public.oc_provision_sincronizar(p_orden_id);
  PERFORM public.oc_vencimientos_estimados_sincronizar(p_orden_id, p_usuario_id);
  PERFORM public.oc_kardex_pendiente_sincronizar(p_orden_id, p_usuario_id);

  RETURN jsonb_build_object('success', true, 'ya_cancelada', false, 'orden_id', p_orden_id, 'numero_orden', o.numero_orden,
                            'estaba_enviada', o.enviada_at IS NOT NULL);
END;
$$;

COMMENT ON FUNCTION public.oc_cancelar(uuid, uuid, text) IS
  'Cancela una orden de compra sin recepción ni comprobantes: revierte la provisión, el stock en camino y los vencimientos estimados. No borra la orden (E-09).';

-- ═══ 9. Constancia del envío por mail ═══
-- p_datos: { para, cc, mensaje_id, hilo_id }
CREATE OR REPLACE FUNCTION public.oc_marcar_enviada(
  p_orden_id   uuid,
  p_usuario_id uuid,
  p_datos      jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  o record;
BEGIN
  SELECT * INTO o FROM ordenes_compra WHERE id = p_orden_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La orden no existe.' USING ERRCODE = 'P0002', DETAIL = 'no_encontrada';
  END IF;

  UPDATE ordenes_compra SET
    -- solo avanza de pendiente a enviada; si ya está más adelante, no retrocede
    estado           = CASE WHEN estado = 'pendiente' THEN 'enviada' ELSE estado END,
    enviada_at       = now(),
    enviada_por      = p_usuario_id,
    enviada_a        = nullif(p_datos ->> 'para', ''),
    enviada_cc       = nullif(p_datos ->> 'cc', ''),
    envio_mensaje_id = nullif(p_datos ->> 'mensaje_id', ''),
    envio_hilo_id    = coalesce(nullif(p_datos ->> 'hilo_id', ''), envio_hilo_id),
    envios           = coalesce(envios, 0) + 1,
    updated_at       = now()
  WHERE id = p_orden_id;

  RETURN jsonb_build_object('success', true, 'orden_id', p_orden_id, 'numero_orden', o.numero_orden,
                            'envios', coalesce(o.envios, 0) + 1,
                            'estado', CASE WHEN o.estado = 'pendiente' THEN 'enviada' ELSE o.estado END);
END;
$$;

-- ═══ 10. Permisos: solo el servidor ═══
REVOKE ALL ON FUNCTION public.oc_totales(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oc_neto_unitario(numeric, numeric, numeric, numeric, numeric, text) TO service_role, authenticated;
REVOKE ALL ON FUNCTION public.oc_provision_sincronizar(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oc_vencimientos_estimados_borrar(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oc_vencimientos_estimados_sincronizar(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oc_vencimiento_estimado_reemplazar(uuid, text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oc_kardex_pendiente_sincronizar(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oc_guardar(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oc_cancelar(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oc_marcar_enviada(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.oc_totales(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.oc_provision_sincronizar(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.oc_vencimientos_estimados_borrar(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.oc_vencimientos_estimados_sincronizar(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.oc_vencimiento_estimado_reemplazar(uuid, text, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.oc_kardex_pendiente_sincronizar(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.oc_guardar(uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.oc_cancelar(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.oc_marcar_enviada(uuid, uuid, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
