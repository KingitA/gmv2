-- P2-03 + P2-37 + asumir deuda de P2-02 — CAJA DE AJUSTES (cuentas corrientes, 31/10/2026)
--
-- Regla de Juan (29-31/10): un solo lugar donde caen TODOS los ajustes de plata,
-- para ver cada tanto cuánto se ajustó. No es una caja operativa: no tiene arqueo,
-- no entra ni sale efectivo y no se mezcla con el cuadre de cajas y bancos. La ven
-- solo los administradores (API: permiso caja_ajustes).
--
-- ENTRAN (todos pasan por el libro como renglón 'ajuste' / 'ajuste_manual', vía
-- cc_ajuste_manual, así que UN disparador sobre el libro los toma de cualquier
-- lugar donde se cargue un pago):
--   · redondeos de cobros ([AJUSTE:x] de la app chofer, app vendedor, /caja,
--     /pagos-clientes, mostrador…) → 'redondeo_cobro'
--   · sobrantes que la oficina decide no dejarle a favor al cliente → 'sobrante'
--   · "Ajustar saldo" en la ficha del cliente → 'ajuste_saldo' (y su eliminación,
--     el contra-asiento [reversa:], → 'reversa')
--   · la deuda que se asume al eliminar un cliente (P2-02) → 'deuda_asumida'
-- NO ENTRAN: el texto libre de la apertura (APERTURA GM AJUSTE), el 10 % en contra
-- de un crédito de mercadería ("Ajuste 10% contado sobre crédito": regla del 10 %,
-- no un ajuste de plata), los ajustes de cajas y bancos (otro circuito), las
-- diferencias de rendición (van a la cuenta personal) ni el saldo a favor.
--
-- Signo: monto > 0 = A FAVOR de la empresa (el cliente quedó debiendo más: sobrante
-- ajustado); monto < 0 = EN CONTRA (se le perdonó: redondeo, deuda asumida). El
-- saldo de la caja es la suma.
--
-- Cada renglón está atado a su renglón del libro (ON DELETE CASCADE): la puesta a
-- cero del día del corte, que borra el libro de prueba, se lleva también estos.
--
-- NO APLICADA. Idempotente.

-- ── 1. La caja ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.caja_ajustes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  libro_id       uuid NOT NULL UNIQUE REFERENCES public.cuenta_corriente_clientes(id) ON DELETE CASCADE,
  fecha          timestamptz NOT NULL,
  origen         text NOT NULL CHECK (origen IN ('redondeo_cobro', 'sobrante', 'ajuste_saldo', 'reversa', 'deuda_asumida')),
  cliente_id     uuid REFERENCES public.clientes(id),
  monto          numeric(14, 2) NOT NULL,
  motivo         text,
  usuario_id     uuid,
  pago_id        uuid,
  comprobante_id uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_caja_ajustes_fecha ON public.caja_ajustes (fecha DESC);
CREATE INDEX IF NOT EXISTS idx_caja_ajustes_pago ON public.caja_ajustes (pago_id) WHERE pago_id IS NOT NULL;
-- Solo la lee el servidor (API con permiso caja_ajustes, cliente admin)
ALTER TABLE public.caja_ajustes ENABLE ROW LEVEL SECURITY;

-- ── 2. Del renglón del libro a la caja ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.caja_ajustes_registrar(p_libro public.cuenta_corriente_clientes)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_obs    text := COALESCE(p_libro.observaciones, '');
  v_origen text;
BEGIN
  IF p_libro.tipo_movimiento <> 'ajuste' OR p_libro.referencia_tipo IS DISTINCT FROM 'ajuste_manual' THEN RETURN; END IF;
  IF v_obs LIKE 'APERTURA GM%' OR v_obs ILIKE 'Ajuste 10% contado%' THEN RETURN; END IF;
  IF COALESCE(p_libro.debe, 0) - COALESCE(p_libro.haber, 0) = 0 THEN RETURN; END IF;

  v_origen := CASE
    WHEN v_obs LIKE '%[reversa:%'                       THEN 'reversa'
    WHEN v_obs ILIKE 'Ajuste por redondeo (sobrante)%'  THEN 'sobrante'
    WHEN v_obs ILIKE 'Ajuste por redondeo%'             THEN 'redondeo_cobro'
    WHEN v_obs ILIKE 'Deuda asumida%'                   THEN 'deuda_asumida'
    ELSE 'ajuste_saldo'
  END;

  INSERT INTO caja_ajustes (libro_id, fecha, origen, cliente_id, monto, motivo, usuario_id, pago_id, comprobante_id)
  VALUES (
    p_libro.id,
    COALESCE(p_libro.fecha, p_libro.created_at, now()),
    v_origen,
    p_libro.cliente_id,
    round(COALESCE(p_libro.debe, 0) - COALESCE(p_libro.haber, 0), 2),
    NULLIF(trim(regexp_replace(v_obs, '\s*\[(pago|saldo|reversa):[^\]]*\]', '', 'g')), ''),
    p_libro.usuario_id,
    substring(v_obs FROM '\[pago:([0-9a-fA-F-]{36})\]')::uuid,
    substring(v_obs FROM '\[saldo:([0-9a-fA-F-]{36})\]')::uuid
  )
  ON CONFLICT (libro_id) DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION public.caja_ajustes_desde_libro()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM caja_ajustes_registrar(NEW);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_caja_ajustes_desde_libro ON public.cuenta_corriente_clientes;
CREATE TRIGGER trg_caja_ajustes_desde_libro
  AFTER INSERT ON public.cuenta_corriente_clientes
  FOR EACH ROW
  WHEN (NEW.tipo_movimiento = 'ajuste')
  EXECUTE FUNCTION public.caja_ajustes_desde_libro();

-- ── 3. Relleno: arranca con la historia (idempotente) ───────────────────────
DO $$
DECLARE r public.cuenta_corriente_clientes;
BEGIN
  FOR r IN
    SELECT * FROM public.cuenta_corriente_clientes
    WHERE tipo_movimiento = 'ajuste' AND referencia_tipo = 'ajuste_manual'
      AND COALESCE(observaciones, '') NOT LIKE 'APERTURA GM%'
  LOOP
    PERFORM public.caja_ajustes_registrar(r);
  END LOOP;
END $$;

-- ── 4. Eliminar cliente asumiendo la deuda (P2-02, regla de Juan) ───────────
-- Misma función de Cambios general (20261029c_cliente_eliminar.sql) con un
-- parámetro más. Sin p_asumir_deuda hace exactamente lo de antes. Con él, si
-- tiene saldo y ningún pedido en curso: asienta un ajuste que lo deja en $0
-- ("Deuda asumida al eliminar el cliente…", cae en la caja de ajustes) y sigue
-- como siempre (con historial queda escondido con el código libre).
DROP FUNCTION IF EXISTS public.cliente_eliminar(uuid, uuid);
CREATE OR REPLACE FUNCTION public.cliente_eliminar(p_cliente_id uuid, p_usuario_id uuid DEFAULT NULL::uuid, p_asumir_deuda boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cli        record;
  v_saldo      numeric;
  v_en_curso   integer;
  v_historial  boolean := false;
  v_con_cae    boolean;
  v_asumido    numeric := 0;
begin
  select id, codigo_cliente, eliminado_at into v_cli from clientes where id = p_cliente_id for update;
  if not found then
    return jsonb_build_object('resultado', 'no_existe');
  end if;
  if v_cli.eliminado_at is not null then
    return jsonb_build_object('resultado', 'ya_eliminado');
  end if;

  select coalesce(sum(debe), 0) - coalesce(sum(haber), 0) into v_saldo
    from cuenta_corriente_clientes where cliente_id = p_cliente_id;
  if abs(v_saldo) >= 0.01 and not p_asumir_deuda then
    return jsonb_build_object('resultado', 'con_saldo', 'saldo', round(v_saldo, 2));
  end if;

  select count(*) into v_en_curso from pedidos
   where cliente_id = p_cliente_id
     and coalesce(estado, '') not in ('entregado', 'rechazado', 'eliminado', 'sistema_viejo');
  if v_en_curso > 0 then
    return jsonb_build_object('resultado', 'pedidos_en_curso', 'cantidad', v_en_curso);
  end if;

  -- Asumir la deuda (o el saldo a favor): el cliente queda en $0 y el ajuste cae
  -- en la caja de ajustes (disparador del libro)
  if abs(v_saldo) >= 0.01 then
    perform cc_ajuste_manual(
      p_cliente_id,
      case when v_saldo > 0 then 'credito' else 'debito' end,
      round(abs(v_saldo), 2),
      'Deuda asumida al eliminar el cliente ' || coalesce(v_cli.codigo_cliente::text, '') ||
        case when v_saldo > 0 then ' (debía ' else ' (tenía a favor ' end || fmt_moneda(abs(v_saldo)) || ')',
      p_usuario_id
    );
    v_asumido := round(v_saldo, 2);
  end if;

  v_con_cae := exists (select 1 from comprobantes_venta where cliente_id = p_cliente_id and cae is not null);

  if v_con_cae
     or exists (select 1 from pedidos where cliente_id = p_cliente_id) then v_historial := true;
  elsif exists (select 1 from comprobantes_venta where cliente_id = p_cliente_id) then v_historial := true;
  elsif exists (select 1 from pagos_clientes where cliente_id = p_cliente_id) then v_historial := true;
  elsif exists (select 1 from cuenta_corriente_clientes where cliente_id = p_cliente_id) then v_historial := true;
  elsif exists (select 1 from cuenta_corriente_ajustes where cliente_id = p_cliente_id) then v_historial := true;
  elsif exists (select 1 from devoluciones where cliente_id = p_cliente_id) then v_historial := true;
  elsif exists (select 1 from remitos where cliente_id = p_cliente_id) then v_historial := true;
  elsif exists (select 1 from viajes_pagos where cliente_id = p_cliente_id) then v_historial := true;
  elsif exists (select 1 from viajes_paradas where cliente_id = p_cliente_id) then v_historial := true;
  elsif exists (select 1 from viajes_clientes where cliente_id = p_cliente_id) then v_historial := true;
  elsif exists (select 1 from reclamos_devoluciones where cliente_id = p_cliente_id) then v_historial := true;
  elsif exists (select 1 from resultado_operaciones where cliente_id = p_cliente_id) then v_historial := true;
  elsif exists (select 1 from kardex where cliente_id = p_cliente_id) then v_historial := true;
  end if;

  if not v_historial then
    delete from clientes where id = p_cliente_id;
    return jsonb_build_object('resultado', 'borrado', 'codigo', v_cli.codigo_cliente);
  end if;

  delete from bonificaciones              where cliente_id = p_cliente_id;
  delete from cliente_proveedor_condicion where cliente_id = p_cliente_id;
  delete from cliente_marca_condicion     where cliente_id = p_cliente_id;
  delete from clientes_zonas              where cliente_id = p_cliente_id;
  delete from precios_calculados          where cliente_id = p_cliente_id;
  delete from metricas_clientes           where cliente_id = p_cliente_id;
  delete from historial_puntajes          where cliente_id = p_cliente_id;

  update clientes
     set activo = false,
         eliminado_at = now(),
         eliminado_por = p_usuario_id,
         codigo_cliente_eliminado = codigo_cliente,
         codigo_cliente = null
   where id = p_cliente_id;

  return jsonb_build_object('resultado', 'escondido', 'codigo', v_cli.codigo_cliente, 'con_cae', v_con_cae, 'deuda_asumida', v_asumido);
end;
$function$;

-- ── Verificación ──
-- Tiene que listar los 3 redondeos de la 2ª prueba (−47,56, −438,32, −53,68).
SELECT origen, count(*) AS renglones, sum(monto) AS saldo FROM public.caja_ajustes GROUP BY origen;
