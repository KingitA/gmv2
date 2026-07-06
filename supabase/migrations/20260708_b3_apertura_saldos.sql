-- ─────────────────────────────────────────────────────────────────────────────
-- FASE B3 — Apertura de saldos (REQUIERE B1+B2 aplicadas)
--
-- ⚠️ ANTES DE CORRER ESTA MIGRACIÓN: verificar/actualizar los snapshots de
-- finanzas_saldos (dashboard /finanzas) — el último snapshot de cada caja se
-- toma como SALDO DE APERTURA del nuevo sistema. Si un monto está viejo,
-- cargarlo en el dashboard antes de ejecutar. Después de esto,
-- finanzas_saldos queda como histórico read-only y los saldos viven en
-- saldos_financieros, derivados del kardex.
--
-- Mapeo caja_key → cuenta:
--   caja_chica / caja_grande        → cajas_financieras (por nombre)
--   credicoop/mercadopago/nacion/provincia → cuentas_bancarias (por nombre)
--   fondos_comunes                  → SE OMITE (definir con el dueño si es
--                                     una cuenta de inversión aparte)
--
-- Color: la apertura entra como BLANCO (los snapshots no discriminan color);
-- el saldo NEGRO arranca en 0 y se corrige con AJUSTE_CAJA si corresponde.
--
-- Idempotente: una sola apertura por cuenta (guard por referencia
-- 'apertura_saldo'). Correcciones posteriores: caja_transferir / AJUSTE_CAJA.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_map record;
  v_monto numeric;
BEGIN
  FOR v_map IN
    SELECT 'CAJA'::text AS tipo, cf.id AS cuenta_id, 'caja_chica'::text AS caja_key, cf.nombre
    FROM cajas_financieras cf WHERE cf.nombre = 'Caja Chica'
    UNION ALL
    SELECT 'CAJA', cf.id, 'caja_grande', cf.nombre
    FROM cajas_financieras cf WHERE cf.nombre = 'Caja Grande'
    UNION ALL
    SELECT 'BANCO', cb.id, lower(cb.nombre), cb.nombre
    FROM cuentas_bancarias cb
    WHERE cb.activo AND lower(cb.nombre) IN ('credicoop', 'mercadopago', 'nación', 'nacion', 'provincia')
  LOOP
    -- normalizar tildes del mapeo banco → caja_key de finanzas_saldos
    SELECT monto INTO v_monto
    FROM finanzas_saldos fs
    WHERE fs.caja_key = CASE WHEN v_map.caja_key IN ('nación') THEN 'nacion' ELSE v_map.caja_key END
    ORDER BY fs.fecha DESC, fs.created_at DESC
    LIMIT 1;

    IF v_monto IS NULL THEN
      RAISE NOTICE 'Apertura %: sin snapshot en finanzas_saldos — omitida', v_map.nombre;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM kardex_contable
      WHERE tipo_movimiento = 'APERTURA_SALDO'
        AND referencia_tipo = 'apertura_saldo'
        AND destino_tipo = v_map.tipo AND destino_id = v_map.cuenta_id
    ) THEN
      RAISE NOTICE 'Apertura %: ya realizada — omitida', v_map.nombre;
      CONTINUE;
    END IF;

    IF v_monto = 0 THEN
      RAISE NOTICE 'Apertura %: snapshot en 0 — omitida', v_map.nombre;
      CONTINUE;
    END IF;

    PERFORM kardex_registrar(
      p_tipo_movimiento => 'APERTURA_SALDO',
      p_concepto        => 'Apertura de saldo ' || v_map.nombre || ' (snapshot finanzas_saldos)',
      p_monto           => v_monto,
      p_color           => 'BLANCO',
      p_origen_tipo     => 'EXTERNO',
      p_destino_tipo    => v_map.tipo,
      p_destino_id      => v_map.cuenta_id,
      p_metodo          => NULL,
      p_referencia_tipo => 'apertura_saldo',
      p_verificado      => true
    );
    RAISE NOTICE 'Apertura %: $% acreditados', v_map.nombre, v_monto;
  END LOOP;
END $$;

COMMENT ON TABLE public.finanzas_saldos IS
  'HISTÓRICO read-only desde Fase B3 (2026-07). Los saldos vigentes viven en '
  'saldos_financieros, derivados de kardex_contable vía kardex_registrar. '
  'No cargar más snapshots acá.';
