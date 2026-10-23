-- ═══════════════════════════════════════════════════════════════════════
-- PRUEBA INTEGRAL de salida de mercadería (23/10/2026, pedido por el dueño).
-- Roadmap: docs/PRUEBA-INTEGRAL-SALIDA.md
--
-- Aplicar este archivo NO cambia ningún dato: agrega el estado de pedido
-- 'sistema_viejo' y deja instaladas cuatro funciones que se corren a mano en
-- el editor SQL de Supabase.
--
--  A) Pedidos del sistema viejo (decisión del dueño 23/10): los pedidos reales
--     cargados antes del corte ya se entregaron y cobraron en el sistema viejo.
--     Pasan a 'sistema_viejo': salen de la cola del depósito, del armado de
--     viajes y de los "pedidos cobrables" de las fichas, y no se pueden editar.
--     Antes de la prueba (todavía no hay pedidos de prueba, no se excluye a nadie):
--       SELECT * FROM pedidos_sistema_viejo_simulacro(now(), '{}');
--       SELECT pedidos_pasar_a_sistema_viejo(now(), '{}', 'PASAR');
--     Durante la prueba, para mover los pedidos reales que sigan entrando sin
--     tocar los de prueba, se excluyen los códigos de los clientes de prueba:
--       SELECT pedidos_pasar_a_sistema_viejo(now(), '{1190,199,556}', 'PASAR');
--     Se puede volver a correr: solo mueve lo que falta.
--
--  B) Limpieza complementaria: lo que cc_puesta_a_cero NO borra. Son TODOS
--     los viajes (son de prueba) con sus paradas, choferes, zonas e historial,
--     los remitos de viajes y la preparación del depósito (picking). Se corre
--     DESPUÉS de la puesta a cero (si no, se niega).
--       SELECT * FROM prueba_limpieza_simulacro();
--       SELECT prueba_limpieza('LIMPIAR');
--
-- Todo lo que se cambia o borra se copia antes a archivo_pruebas.<tabla>_<fecha>.
-- ═══════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS archivo_pruebas;
REVOKE ALL ON SCHEMA archivo_pruebas FROM PUBLIC, anon, authenticated;

-- ─── Estado nuevo ──────────────────────────────────────────────────────
ALTER TABLE public.pedidos DROP CONSTRAINT IF EXISTS pedidos_estado_check;
ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_estado_check CHECK (estado::text = ANY (ARRAY[
  'en_revision', 'en_venta', 'pendiente', 'en_preparacion', 'impreso', 'pendiente_facturacion',
  'facturado', 'listo_para_retirar', 'listo_para_enviar', 'en_viaje', 'entregado', 'rechazado',
  'eliminado', 'sistema_viejo'
]::text[]));

-- ─── A) Pedidos del sistema viejo ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pedidos_sistema_viejo_simulacro(p_hasta timestamptz, p_excluir_codigos text[] DEFAULT '{}')
RETURNS TABLE(estado text, pedidos bigint, desde date, hasta date, con_viaje bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT p.estado::text, count(*), min(p.created_at)::date, max(p.created_at)::date, count(p.viaje_id)
  FROM pedidos p
  LEFT JOIN clientes c ON c.id = p.cliente_id
  WHERE p.created_at < p_hasta
    AND p.estado NOT IN ('eliminado', 'sistema_viejo')
    AND NOT (COALESCE(c.codigo_cliente, '') = ANY (p_excluir_codigos))
  GROUP BY p.estado
  ORDER BY 2 DESC
$$;

CREATE OR REPLACE FUNCTION public.pedidos_pasar_a_sistema_viejo(p_hasta timestamptz, p_excluir_codigos text[], p_confirmacion text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  t text := 'pedidos_estado_previo_' || to_char(now() AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYYMMDD_HH24MISS');
  n bigint;
BEGIN
  IF p_confirmacion IS DISTINCT FROM 'PASAR' THEN
    RAISE EXCEPTION 'Para pasar los pedidos escribí exactamente: SELECT pedidos_pasar_a_sistema_viejo(now(), ''{1190,199,556}'', ''PASAR'');';
  END IF;

  -- 1) Copia del estado anterior (para poder volver atrás)
  EXECUTE format($q$
    CREATE TABLE archivo_pruebas.%I AS
    SELECT p.id, p.numero_pedido, p.estado, p.viaje_id, now() AS archivado_at
    FROM pedidos p LEFT JOIN clientes c ON c.id = p.cliente_id
    WHERE p.created_at < $1
      AND p.estado NOT IN ('eliminado', 'sistema_viejo')
      AND NOT (COALESCE(c.codigo_cliente, '') = ANY ($2))$q$, t)
  USING p_hasta, p_excluir_codigos;

  -- 2) Cambio: exactamente los pedidos copiados
  EXECUTE format('UPDATE pedidos p SET estado = ''sistema_viejo'', viaje_id = NULL FROM archivo_pruebas.%I a WHERE a.id = p.id', t);
  GET DIAGNOSTICS n = ROW_COUNT;

  RETURN jsonb_build_object('pedidos_movidos', n, 'archivo', 'archivo_pruebas.' || t);
END;
$fn$;

-- ─── B) Limpieza complementaria (después de cc_puesta_a_cero) ──────────
CREATE OR REPLACE FUNCTION public.prueba_limpieza_simulacro()
RETURNS TABLE(tabla text, se_borran bigint, detalle text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT 'viajes'::text, count(*), 'todos (son de prueba)' FROM viajes
  UNION ALL SELECT 'viajes_paradas', count(*), '' FROM viajes_paradas
  UNION ALL SELECT 'viajes_choferes', count(*), '' FROM viajes_choferes
  UNION ALL SELECT 'viaje_zonas', count(*), '' FROM viaje_zonas
  UNION ALL SELECT 'viajes_historial', count(*), '' FROM viajes_historial
  UNION ALL SELECT 'viajes_pagos / viajes_clientes', (SELECT count(*) FROM viajes_pagos) + (SELECT count(*) FROM viajes_clientes), ''
  UNION ALL SELECT 'remitos (de viajes)', count(*), 'con su detalle' FROM remitos WHERE viaje_id IS NOT NULL
  UNION ALL SELECT 'picking_sesiones', count(*), 'preparación del depósito, con sus renglones y escaneos' FROM picking_sesiones
  UNION ALL SELECT 'pedidos con viaje', count(*), 'NO se borran: solo se les quita el viaje' FROM pedidos WHERE viaje_id IS NOT NULL
  UNION ALL SELECT 'BLOQUEA (tiene que dar 0)',
         (SELECT count(*) FROM devoluciones WHERE viaje_id IS NOT NULL) + (SELECT count(*) FROM viajes_fondos)
         + (SELECT count(*) FROM viajes_gastos) + (SELECT count(*) FROM pagos_clientes WHERE viaje_id IS NOT NULL)
         + (SELECT count(*) FROM cobranzas WHERE viaje_id IS NOT NULL),
         'devoluciones, fondos, gastos y cobros de viajes: los borra cc_puesta_a_cero, que va primero'
$$;

CREATE OR REPLACE FUNCTION public.prueba_limpieza(p_confirmacion text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  s text := to_char(now() AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYYMMDD_HH24MISS');
  r jsonb := '{}'::jsonb;
  n bigint;
BEGIN
  IF p_confirmacion IS DISTINCT FROM 'LIMPIAR' THEN
    RAISE EXCEPTION 'Para ejecutar la limpieza escribí exactamente: SELECT prueba_limpieza(''LIMPIAR'');';
  END IF;
  IF EXISTS (SELECT 1 FROM devoluciones WHERE viaje_id IS NOT NULL) OR EXISTS (SELECT 1 FROM viajes_fondos)
     OR EXISTS (SELECT 1 FROM viajes_gastos) OR EXISTS (SELECT 1 FROM pagos_clientes WHERE viaje_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM cobranzas WHERE viaje_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Primero hay que correr la puesta a cero: SELECT cc_puesta_a_cero(''PONER A CERO'');';
  END IF;

  -- 1) Copia
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT * FROM viajes', 'viajes_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT * FROM viajes_paradas', 'viajes_paradas_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT * FROM viajes_choferes', 'viajes_choferes_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT * FROM viaje_zonas', 'viaje_zonas_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT * FROM viajes_historial', 'viajes_historial_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT * FROM viajes_pagos', 'viajes_pagos_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT * FROM viajes_clientes', 'viajes_clientes_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT * FROM remitos WHERE viaje_id IS NOT NULL', 'remitos_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT d.* FROM remitos_detalle d JOIN remitos r ON r.id = d.remito_id WHERE r.viaje_id IS NOT NULL', 'remitos_detalle_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT * FROM picking_sesiones', 'picking_sesiones_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT * FROM picking_items', 'picking_items_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT * FROM picking_scans_log', 'picking_scans_log_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT id, numero_pedido, estado, viaje_id FROM pedidos WHERE viaje_id IS NOT NULL', 'pedidos_viaje_previo_' || s);

  -- 2) Borrado
  UPDATE pedidos SET viaje_id = NULL WHERE viaje_id IS NOT NULL; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('pedidos_sin_viaje', n);
  DELETE FROM remitos WHERE viaje_id IS NOT NULL; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('remitos', n);  -- detalle en cascada
  DELETE FROM picking_sesiones; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('picking_sesiones', n);      -- renglones y escaneos en cascada
  DELETE FROM viajes; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('viajes', n);                          -- paradas, choferes, zonas, historial en cascada

  RETURN r || jsonb_build_object('archivo', 'archivo_pruebas.*_' || s, 'ok', true);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.pedidos_sistema_viejo_simulacro(timestamptz, text[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pedidos_pasar_a_sistema_viejo(timestamptz, text[], text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prueba_limpieza_simulacro() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prueba_limpieza(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pedidos_sistema_viejo_simulacro(timestamptz, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.prueba_limpieza_simulacro() TO service_role;
