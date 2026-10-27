-- ═══════════════════════════════════════════════════════════════════════
-- SEGUNDA PRUEBA INTEGRAL de salida — preparación complementaria
-- (27/10/2026, pedido por el dueño). Roadmap: docs/PRUEBA-INTEGRAL-SALIDA-2.md (0.3 / 1.4)
--
-- Aplicar este archivo NO cambia ningún dato: deja instaladas dos funciones
-- que se corren a mano en el editor SQL de Supabase, DESPUÉS de
-- cc_puesta_a_cero y prueba_limpieza (si no, se niega).
--
-- Hace lo que la puesta a cero no cubre (hallazgos A1 y A4 de la auditoría):
--  · Pasa a 'eliminado' los pedidos de prueba que quedaron de la 1ª prueba
--    (001939, 001940, 001941, 001942) y el del agente de refacturar (001990),
--    igual que el botón Eliminar del ERP: estado, eliminado_at y
--    kardex.pedido_eliminado = true (así no cuentan para ventas ni comisiones).
--    Solo si el pedido es de un cliente de prueba (1190, 199, 556 o 3): un
--    pedido real con ese número no se toca.
--  · Al cliente de prueba 3 "TEST-R1 REFACTURAR" (ya desactivado por el dueño)
--    le cambia el código a 'PRUEBA-R1', para que la apertura no le cargue la
--    deuda de un cliente 3 del sistema viejo.
--
-- Uso:
--   SELECT * FROM prueba2_preparar_simulacro();
--   SELECT prueba2_preparar('PREPARAR');
--
-- Todo lo que se cambia se copia antes a archivo_pruebas.<tabla>_<fecha>.
-- ═══════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS archivo_pruebas;
REVOKE ALL ON SCHEMA archivo_pruebas FROM PUBLIC, anon, authenticated;

-- Pedidos de prueba, solo de clientes de prueba
CREATE OR REPLACE FUNCTION public.prueba2_pedidos_objetivo()
RETURNS TABLE(id uuid, numero_pedido text, estado text, codigo_cliente text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT p.id, p.numero_pedido::text, p.estado::text, c.codigo_cliente::text
  FROM pedidos p JOIN clientes c ON c.id = p.cliente_id
  WHERE p.numero_pedido IN ('001939', '001940', '001941', '001942', '001990')
    AND c.codigo_cliente IN ('1190', '199', '556', '3')
    AND p.estado <> 'eliminado'
$$;

-- ─── Simulacro: solo muestra, no toca nada ─────────────────────────────
CREATE OR REPLACE FUNCTION public.prueba2_preparar_simulacro()
RETURNS TABLE(que text, cuantos bigint, detalle text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT 'pedidos a eliminado'::text, count(*),
         COALESCE(string_agg(numero_pedido || ' (' || estado || ', cliente ' || codigo_cliente || ')', ', ' ORDER BY numero_pedido), '')
  FROM prueba2_pedidos_objetivo()
  UNION ALL
  SELECT 'renglones de kardex marcados', count(*), 'pedido_eliminado = true'
  FROM kardex k WHERE k.pedido_id IN (SELECT id FROM prueba2_pedidos_objetivo()) AND NOT COALESCE(k.pedido_eliminado, false)
  UNION ALL
  SELECT 'cliente 3 → PRUEBA-R1', count(*), COALESCE(string_agg(nombre, ', '), 'ya no hay cliente 3 de prueba')
  FROM clientes WHERE codigo_cliente = '3' AND nombre = 'TEST-R1 REFACTURAR'
  UNION ALL
  SELECT 'BLOQUEA (tiene que dar 0)', count(*), 'comprobantes sin anular de esos pedidos: primero va cc_puesta_a_cero'
  FROM comprobantes_venta cv WHERE cv.pedido_id IN (SELECT id FROM prueba2_pedidos_objetivo()) AND cv.anulado_en IS NULL
$$;

-- ─── Ejecución ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prueba2_preparar(p_confirmacion text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  s text := to_char(now() AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYYMMDD_HH24MISS');
  r jsonb := '{}'::jsonb;
  n bigint;
BEGIN
  IF p_confirmacion IS DISTINCT FROM 'PREPARAR' THEN
    RAISE EXCEPTION 'Para ejecutar escribí exactamente: SELECT prueba2_preparar(''PREPARAR'');';
  END IF;
  IF EXISTS (SELECT 1 FROM comprobantes_venta cv
             WHERE cv.pedido_id IN (SELECT id FROM prueba2_pedidos_objetivo()) AND cv.anulado_en IS NULL) THEN
    RAISE EXCEPTION 'Esos pedidos todavía tienen comprobantes: primero va SELECT cc_puesta_a_cero(''PONER A CERO'');';
  END IF;

  -- 1) Copia
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT p.id, p.numero_pedido, p.estado, p.eliminado_at, now() AS archivado_at FROM pedidos p WHERE p.id IN (SELECT id FROM prueba2_pedidos_objetivo())', 'prueba2_pedidos_previo_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT k.id, k.pedido_id, k.pedido_eliminado FROM kardex k WHERE k.pedido_id IN (SELECT id FROM prueba2_pedidos_objetivo())', 'prueba2_kardex_previo_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT id, codigo_cliente, nombre, activo FROM clientes WHERE codigo_cliente = ''3'' AND nombre = ''TEST-R1 REFACTURAR''', 'prueba2_cliente3_previo_' || s);

  -- 2) Cambios (exactamente lo copiado)
  EXECUTE format('UPDATE kardex k SET pedido_eliminado = true FROM archivo_pruebas.%I a WHERE a.id = k.id', 'prueba2_kardex_previo_' || s);
  GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('kardex_marcados', n);

  EXECUTE format('UPDATE pedidos p SET estado = ''eliminado'', eliminado_at = now() FROM archivo_pruebas.%I a WHERE a.id = p.id', 'prueba2_pedidos_previo_' || s);
  GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('pedidos_eliminados', n);

  EXECUTE format('UPDATE clientes c SET codigo_cliente = ''PRUEBA-R1'', activo = false FROM archivo_pruebas.%I a WHERE a.id = c.id', 'prueba2_cliente3_previo_' || s);
  GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('cliente3_recodificado', n);

  RETURN r || jsonb_build_object('archivo', 'archivo_pruebas.prueba2_*_' || s, 'ok', true);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.prueba2_pedidos_objetivo() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prueba2_preparar_simulacro() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prueba2_preparar(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prueba2_preparar_simulacro() TO service_role;
