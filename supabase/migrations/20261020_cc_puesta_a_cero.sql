-- ═══════════════════════════════════════════════════════════════════════
-- PUESTA A CERO antes de producción (preparada 20/10/2026, autorizada por el
-- dueño). Aplicar este archivo NO borra nada: solo deja instaladas las dos
-- funciones. La puesta a cero se ejecuta a mano el DÍA DEL CORTE.
--
-- Reglas del dueño (16-20/10):
--  · Todo saldo de cuenta corriente, cobro, devolución, rendición, comisión y
--    billetera que hay hoy es de PRUEBA → se borra.
--  · Se conservan: pedidos, clientes, artículos, proveedores y los 12
--    comprobantes fiscales con CAE (se cancelan entre sí: suman $0).
--  · Los presupuestos/facturas sin CAE emitidos en la prueba también están en
--    el sistema viejo → se borran y vuelven con la APERTURA (/apertura).
--  · Finanzas: los cheques son de prueba salvo los echeqs PROPIOS emitidos a
--    proveedores (estado ENTREGADO_A_PROVEEDOR: 2 a La Mariposa, 1 a Rofina).
--    Movimientos y saldos de caja/bancos/inversiones a cero: el dueño carga
--    el saldo real después.
--
-- Uso, el DÍA DEL CORTE, en el editor SQL de Supabase:
--   1) SELECT * FROM cc_puesta_a_cero_simulacro();   -- qué se borra y qué queda
--   2) SELECT cc_puesta_a_cero('PONER A CERO');       -- copia y borra
--   3) Cargar la APERTURA (/apertura) y los saldos de caja y bancos.
--
-- Antes de borrar, TODO lo que se borra se copia al esquema archivo_pruebas
-- (una tabla por tabla, con fecha y hora): se puede consultar o restaurar.
-- ═══════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS archivo_pruebas;
REVOKE ALL ON SCHEMA archivo_pruebas FROM PUBLIC, anon, authenticated;

-- Un comprobante se conserva si es fiscal (tiene CAE)
CREATE OR REPLACE FUNCTION public.cc_cero_conservar_comprobante(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM comprobantes_venta cv WHERE cv.id = p_id AND cv.cae IS NOT NULL)
$$;

-- ─── Simulacro: solo cuenta, no toca nada ──────────────────────────────
CREATE OR REPLACE FUNCTION public.cc_puesta_a_cero_simulacro()
RETURNS TABLE(tabla text, se_borran bigint, se_conservan bigint, detalle text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT 'comprobantes_venta'::text, count(*) FILTER (WHERE cae IS NULL), count(*) FILTER (WHERE cae IS NOT NULL),
         'se conservan los fiscales con CAE (suman $' || COALESCE(sum(total_factura) FILTER (WHERE cae IS NOT NULL), 0) || ')'
  FROM comprobantes_venta
  UNION ALL
  SELECT 'cuenta_corriente_clientes',
         count(*) FILTER (WHERE NOT (referencia_tipo = 'comprobante_venta' AND cc_cero_conservar_comprobante(referencia_id))),
         count(*) FILTER (WHERE referencia_tipo = 'comprobante_venta' AND cc_cero_conservar_comprobante(referencia_id)),
         'quedan solo los asientos de los comprobantes con CAE'
  FROM cuenta_corriente_clientes
  UNION ALL SELECT 'pagos_clientes', count(*), 0, 'todos los cobros (prueba)' FROM pagos_clientes
  UNION ALL SELECT 'imputaciones',
         count(*) FILTER (WHERE NOT (pago_id IS NULL AND cc_cero_conservar_comprobante(comprobante_id) AND (credito_comprobante_id IS NULL OR cc_cero_conservar_comprobante(credito_comprobante_id)))),
         count(*) FILTER (WHERE pago_id IS NULL AND cc_cero_conservar_comprobante(comprobante_id) AND (credito_comprobante_id IS NULL OR cc_cero_conservar_comprobante(credito_comprobante_id))),
         'quedan las que cancelan comprobantes con CAE entre sí'
  FROM imputaciones
  UNION ALL SELECT 'recibos', count(*), 0, '' FROM recibos
  UNION ALL SELECT 'cobranzas', count(*), 0, '' FROM cobranzas
  UNION ALL SELECT 'rendiciones', count(*), 0, '' FROM rendiciones
  UNION ALL SELECT 'devoluciones', count(*), 0, 'devoluciones de prueba (y su detalle)' FROM devoluciones
  UNION ALL SELECT 'billetera_movimientos', count(*), 0, '' FROM billetera_movimientos
  UNION ALL SELECT 'comisiones (cobradas)', count(*) FILTER (WHERE tipo = 'cobrada'), count(*) FILTER (WHERE tipo <> 'cobrada'), 'las vendidas (estimación del kardex) quedan' FROM comisiones
  UNION ALL SELECT 'cheques',
         count(*) FILTER (WHERE NOT (tipo = 'PROPIO' AND estado = 'ENTREGADO_A_PROVEEDOR')),
         count(*) FILTER (WHERE tipo = 'PROPIO' AND estado = 'ENTREGADO_A_PROVEEDOR'),
         'quedan los echeqs propios entregados a proveedores'
  FROM cheques
  UNION ALL SELECT 'kardex_contable', count(*), 0, 'movimientos de caja/bancos (se recargan los saldos reales)' FROM kardex_contable
  UNION ALL SELECT 'saldos_financieros (a cero)', count(*) FILTER (WHERE saldo <> 0), 0, 'caja, bancos, inversiones, billeteras' FROM saldos_financieros
  UNION ALL SELECT 'viajes_fondos / viajes_gastos', (SELECT count(*) FROM viajes_fondos) + (SELECT count(*) FROM viajes_gastos), 0, 'plata de viajes de prueba'
  UNION ALL SELECT 'pedidos', 0, count(*), 'no se tocan' FROM pedidos
$$;

-- ─── Puesta a cero ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cc_puesta_a_cero(p_confirmacion text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  s text := to_char(now() AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYYMMDD_HH24MI');
  r jsonb := '{}'::jsonb;
  n bigint;
BEGIN
  IF p_confirmacion IS DISTINCT FROM 'PONER A CERO' THEN
    RAISE EXCEPTION 'Para ejecutar la puesta a cero escribí exactamente: SELECT cc_puesta_a_cero(''PONER A CERO'');';
  END IF;

  -- 1) COPIA de todo lo que se va a borrar (archivo_pruebas.<tabla>_<fecha>)
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT * FROM comprobantes_venta WHERE cae IS NULL', 'comprobantes_venta_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT d.* FROM comprobantes_venta_detalle d JOIN comprobantes_venta c ON c.id = d.comprobante_id WHERE c.cae IS NULL', 'comprobantes_venta_detalle_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT * FROM cuenta_corriente_clientes', 'cuenta_corriente_clientes_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT * FROM imputaciones', 'imputaciones_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT * FROM pagos_clientes', 'pagos_clientes_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT * FROM pagos_detalle', 'pagos_detalle_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT * FROM recibos', 'recibos_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT * FROM retenciones', 'retenciones_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT * FROM cobranzas', 'cobranzas_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT * FROM rendiciones', 'rendiciones_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT * FROM rendicion_items', 'rendicion_items_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT * FROM devoluciones', 'devoluciones_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT * FROM devoluciones_detalle', 'devoluciones_detalle_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT * FROM devoluciones_descuentos', 'devoluciones_descuentos_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT * FROM billetera_movimientos', 'billetera_movimientos_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT * FROM comisiones WHERE tipo = ''cobrada''', 'comisiones_cobradas_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT * FROM cheques WHERE NOT (tipo = ''PROPIO'' AND estado = ''ENTREGADO_A_PROVEEDOR'')', 'cheques_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT * FROM kardex_contable', 'kardex_contable_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT * FROM saldos_financieros', 'saldos_financieros_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT * FROM viajes_fondos', 'viajes_fondos_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT * FROM viajes_gastos', 'viajes_gastos_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT * FROM cuenta_corriente_ajustes', 'cuenta_corriente_ajustes_' || s);
  EXECUTE format('CREATE TABLE archivo_pruebas.%I AS SELECT id, comprobante_venta_id, comprobante_cobrado, fecha_comprobante_cobrado, cobrador_id, descuento_financiero_pct FROM kardex WHERE comprobante_venta_id IS NOT NULL OR comprobante_cobrado OR descuento_financiero_pct IS NOT NULL', 'kardex_vinculos_' || s);

  -- 2) BORRADO, en orden de dependencias
  DELETE FROM devoluciones; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('devoluciones', n);  -- detalle y descuentos en cascada
  DELETE FROM rendicion_items;
  DELETE FROM rendiciones; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('rendiciones', n);

  UPDATE banco_extractos_movimientos SET pago_id = NULL WHERE pago_id IS NOT NULL;
  UPDATE banco_extractos_movimientos SET kardex_id = NULL WHERE kardex_id IS NOT NULL;
  UPDATE cierres_caja SET ajuste_kardex_id = NULL WHERE ajuste_kardex_id IS NOT NULL;
  UPDATE pedidos SET pago_contado_10 = false WHERE pago_contado_10;

  DELETE FROM imputaciones
  WHERE NOT (pago_id IS NULL AND cc_cero_conservar_comprobante(comprobante_id)
             AND (credito_comprobante_id IS NULL OR cc_cero_conservar_comprobante(credito_comprobante_id)));
  GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('imputaciones', n);

  DELETE FROM recibos;
  DELETE FROM retenciones;
  DELETE FROM pagos_clientes; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('pagos_clientes', n);  -- detalle en cascada; anticipos → NULL
  DELETE FROM cobranzas;

  DELETE FROM comisiones WHERE tipo = 'cobrada'; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('comisiones_cobradas', n);
  UPDATE comisiones SET comprobante_venta_id = NULL
  WHERE comprobante_venta_id IS NOT NULL AND NOT cc_cero_conservar_comprobante(comprobante_venta_id);
  UPDATE comisiones SET comprobante_cobrado = false, fecha_comprobante_cobrado = NULL WHERE comprobante_cobrado AND pagado = false;

  UPDATE kardex SET comprobante_venta_id = NULL
  WHERE comprobante_venta_id IS NOT NULL AND NOT cc_cero_conservar_comprobante(comprobante_venta_id);
  UPDATE kardex SET comprobante_cobrado = false, fecha_comprobante_cobrado = NULL, cobrador_id = NULL, descuento_financiero_pct = NULL
  WHERE comprobante_cobrado OR descuento_financiero_pct IS NOT NULL;

  DELETE FROM arca_solicitudes_cae a WHERE NOT cc_cero_conservar_comprobante(a.comprobante_id);
  DELETE FROM comprobantes_venta WHERE cae IS NULL; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('comprobantes_venta', n);

  DELETE FROM cuenta_corriente_clientes
  WHERE NOT (referencia_tipo = 'comprobante_venta' AND cc_cero_conservar_comprobante(referencia_id));
  GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('cuenta_corriente_clientes', n);
  DELETE FROM cuenta_corriente_ajustes;

  DELETE FROM billetera_movimientos; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('billetera_movimientos', n);
  DELETE FROM viajes_gastos;
  DELETE FROM viajes_fondos;

  DELETE FROM cheques WHERE NOT (tipo = 'PROPIO' AND estado = 'ENTREGADO_A_PROVEEDOR');
  GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('cheques', n);

  DELETE FROM kardex_contable; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('kardex_contable', n);
  UPDATE saldos_financieros SET saldo = 0 WHERE saldo <> 0;

  DELETE FROM tareas_fallidas;

  RETURN r || jsonb_build_object('archivo', 'archivo_pruebas.*_' || s, 'ok', true);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.cc_puesta_a_cero(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cc_puesta_a_cero_simulacro() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cc_puesta_a_cero_simulacro() TO service_role;
