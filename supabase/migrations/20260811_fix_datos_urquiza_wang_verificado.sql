-- ============================================================================
-- FIX DE DATOS VERIFICADO — DISTRIBUIDORA URQUIZA + WANG ZHI BIN + pago colgado
-- Reemplaza a 20260810_fix_urquiza_anulaciones.sql (NO aplicar aquella:
-- sus montos hardcodeados no cuadran con los datos reales).
--
-- Calculado contra la DB el 10/08/2026. Correr COMPLETO en el SQL Editor.
-- Es transaccional: si un assert falla, no se aplica nada.
-- Es idempotente: re-correrlo no duplica asientos.
--
-- Qué corrige:
--  URQUIZA: el pago $4.591.534 quedó sobre-imputado en $510.170,48 porque la
--    REV 0001-00000001 (bonif. 10%) se imputó "al pago" (modelo pozo viejo).
--    Además: la venta PRES 10/11 se anuló → la bonificación debe anularse;
--    las REV 3/4 (espejos de esa anulación) nunca postearon al libro y fueron
--    anuladas por error ("anular el espejo"), generando los PRES 12/13.
--  WANG: mismo modelo pozo con la REV 0001-00000002 ($42.008,81).
--  CARDOZO: pago de prueba de nov-2025 ($5.000, pendiente, sin detalle).
--
-- Saldos finales esperados (asserts al pie):
--  URQUIZA: libro = -3.589.534,48 y libro == documentos (reconciliación 0)
--  WANG:    libro = -111.765,31  == plata a cuenta del pago (reconciliación 0)
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. DISTRIBUIDORA URQUIZA (6daf55b6-22df-491d-b2e3-522674ab89d7)
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_cliente uuid;
  v_rev1  uuid;  -- REV 0001-00000001 (bonificación 10%, -510.170,48)
  v_rev3  uuid;  -- REV 0001-00000003 (espejo anulación PRES 10, -427.287,60)
  v_rev4  uuid;  -- REV 0001-00000004 (espejo anulación PRES 11, -4.674.417,24)
  v_pres12 uuid; -- PRES 0001-00000012 (espejo erróneo de anular REV 4)
  v_pres13 uuid; -- PRES 0001-00000013 (espejo erróneo de anular REV 3)
  v_pago  uuid := '121b9195-5709-47df-9bee-086823d0e289'; -- pago $4.591.534
  v_saldo numeric;
  v_imputado_pago numeric;
BEGIN
  SELECT id INTO STRICT v_cliente FROM clientes WHERE razon_social = 'DISTRIBUIDORA URQUIZA';
  SELECT id INTO STRICT v_rev1  FROM comprobantes_venta WHERE cliente_id = v_cliente AND tipo_comprobante = 'REV'  AND numero_comprobante = '0001-00000001';
  SELECT id INTO STRICT v_rev3  FROM comprobantes_venta WHERE cliente_id = v_cliente AND tipo_comprobante = 'REV'  AND numero_comprobante = '0001-00000003';
  SELECT id INTO STRICT v_rev4  FROM comprobantes_venta WHERE cliente_id = v_cliente AND tipo_comprobante = 'REV'  AND numero_comprobante = '0001-00000004';
  SELECT id INTO STRICT v_pres12 FROM comprobantes_venta WHERE cliente_id = v_cliente AND tipo_comprobante = 'PRES' AND numero_comprobante = '0001-00000012';
  SELECT id INTO STRICT v_pres13 FROM comprobantes_venta WHERE cliente_id = v_cliente AND tipo_comprobante = 'PRES' AND numero_comprobante = '0001-00000013';

  -- 1.a  Anular la imputación "pozo" del pago contra la REV 1 ($510.170,48).
  --      Con esto el pago queda imputado exacto: 427.287,60 + 4.164.246,40 = 4.591.534,00.
  UPDATE imputaciones SET estado = 'anulado'
  WHERE pago_id = v_pago AND comprobante_id = v_rev1 AND estado = 'confirmado';

  -- 1.b  Anular la REV 1: su venta (PRES 10/11) está anulada → la bonificación cae.
  UPDATE comprobantes_venta
  SET estado_pago = 'anulado', saldo_pendiente = 0, anulado_en = now()
  WHERE id = v_rev1 AND anulado_en IS NULL;

  --      Contra-asiento en el libro (la REV 1 había posteado haber 510.170,48).
  IF NOT EXISTS (SELECT 1 FROM cuenta_corriente_clientes WHERE referencia_id = v_rev1 AND debe > 0) THEN
    PERFORM cc_postear(v_cliente, 'nota_credito', 510170.48, 0,
      'comprobante_venta', v_rev1, '0001-00000001',
      'Anulación bonificación 10% — la venta original (PRES 0001-00000010/11) fue anulada', NULL, now());
  END IF;

  -- 1.c  Rehabilitar REV 3 y REV 4 como créditos vivos (fueron anuladas por el
  --      bug de "anular el espejo") y postear al libro el haber que nunca entró.
  UPDATE comprobantes_venta SET anulado_en = NULL WHERE id IN (v_rev3, v_rev4) AND anulado_en IS NOT NULL;

  IF NOT EXISTS (SELECT 1 FROM cuenta_corriente_clientes WHERE referencia_id = v_rev3) THEN
    PERFORM cc_postear(v_cliente, 'nota_credito', 0, 427287.60,
      'comprobante_venta', v_rev3, '0001-00000003',
      'REV por anulación de PRES 0001-00000010 (contra-asiento faltante)', NULL, now());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cuenta_corriente_clientes WHERE referencia_id = v_rev4) THEN
    PERFORM cc_postear(v_cliente, 'nota_credito', 0, 4674417.24,
      'comprobante_venta', v_rev4, '0001-00000004',
      'REV por anulación de PRES 0001-00000011 (contra-asiento faltante)', NULL, now());
  END IF;

  -- 1.d  Neutralizar PRES 12/13 (espejos del error). Nunca postearon al libro,
  --      así que alcanza con dejarlos anulados y sin saldo.
  UPDATE comprobantes_venta
  SET estado_pago = 'anulado', saldo_pendiente = 0, anulado_en = COALESCE(anulado_en, now())
  WHERE id IN (v_pres12, v_pres13) AND estado_pago <> 'anulado';

  -- 1.e  Borrar el ajuste por redondeo de $0,36 (cubría el descuadre del pozo;
  --      con 1.a ya no existe descuadre).
  DELETE FROM cuenta_corriente_clientes
  WHERE cliente_id = v_cliente AND referencia_tipo = 'ajuste_manual'
    AND haber = 0.36 AND observaciones LIKE 'Ajuste por redondeo%';

  -- ── Asserts ──
  SELECT COALESCE(SUM(monto_imputado), 0) INTO v_imputado_pago
  FROM imputaciones WHERE pago_id = v_pago AND estado = 'confirmado';
  IF v_imputado_pago <> 4591534.00 THEN
    RAISE EXCEPTION 'URQUIZA: pago imputado esperado 4.591.534,00, quedó %', v_imputado_pago;
  END IF;

  SELECT COALESCE(SUM(debe) - SUM(haber), 0) INTO v_saldo
  FROM cuenta_corriente_clientes WHERE cliente_id = v_cliente;
  IF v_saldo <> -3589534.48 THEN
    RAISE EXCEPTION 'URQUIZA: saldo libro esperado -3.589.534,48, quedó %', v_saldo;
  END IF;

  RAISE NOTICE 'URQUIZA OK — saldo libro: %', v_saldo;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. WANG ZHI BIN (9cbab35a-20ea-44f1-b863-80f9f12a2769)
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_cliente uuid;
  v_pres9 uuid;  -- PRES 0001-00000009 ($420.088,10, pagado)
  v_rev2  uuid;  -- REV 0001-00000002 (bonificación 10%, -42.008,81)
  v_pago  uuid := 'f5d7c7e9-a4fc-4bba-87e8-d23ed0a0ed29'; -- pago $489.844,60
  v_saldo numeric;
  v_imp_pago numeric;
  v_imp_pres9 numeric;
BEGIN
  SELECT id INTO STRICT v_cliente FROM clientes WHERE razon_social = 'WANG ZHI BIN';
  SELECT id INTO STRICT v_pres9 FROM comprobantes_venta WHERE cliente_id = v_cliente AND tipo_comprobante = 'PRES' AND numero_comprobante = '0001-00000009';
  SELECT id INTO STRICT v_rev2  FROM comprobantes_venta WHERE cliente_id = v_cliente AND tipo_comprobante = 'REV'  AND numero_comprobante = '0001-00000002';

  -- 2.a  Anular la imputación "pozo" del pago contra la REV 2 ($42.008,81).
  UPDATE imputaciones SET estado = 'anulado'
  WHERE pago_id = v_pago AND comprobante_id = v_rev2 AND estado = 'confirmado';

  -- 2.b  El pago debe cubrir el 90% del PRES 9 (378.079,29); el 10% restante
  --      lo cubre la REV 2. Hoy el pago figura imputado por el 100%.
  UPDATE imputaciones SET monto_imputado = 378079.29
  WHERE pago_id = v_pago AND comprobante_id = v_pres9
    AND estado = 'confirmado' AND monto_imputado = 420088.10;

  -- 2.c  Dejar rastro: la REV 2 se aplicó al PRES 9 por $42.008,81
  --      (ambos ya tienen saldo 0; solo falta el registro de imputación).
  IF NOT EXISTS (SELECT 1 FROM imputaciones WHERE credito_comprobante_id = v_rev2 AND comprobante_id = v_pres9 AND estado = 'confirmado') THEN
    INSERT INTO imputaciones (pago_id, credito_comprobante_id, comprobante_id, tipo_comprobante, monto_imputado, estado)
    VALUES (NULL, v_rev2, v_pres9, 'nota_credito', 42008.81, 'confirmado');
  END IF;

  -- ── Asserts ──
  SELECT COALESCE(SUM(monto_imputado), 0) INTO v_imp_pago
  FROM imputaciones WHERE pago_id = v_pago AND estado = 'confirmado';
  IF v_imp_pago <> 378079.29 THEN
    RAISE EXCEPTION 'WANG: pago imputado esperado 378.079,29 (a cuenta 111.765,31), quedó %', v_imp_pago;
  END IF;

  SELECT COALESCE(SUM(monto_imputado), 0) INTO v_imp_pres9
  FROM imputaciones WHERE comprobante_id = v_pres9 AND estado = 'confirmado';
  IF v_imp_pres9 <> 420088.10 THEN
    RAISE EXCEPTION 'WANG: PRES 9 imputado esperado 420.088,10, quedó %', v_imp_pres9;
  END IF;

  SELECT COALESCE(SUM(debe) - SUM(haber), 0) INTO v_saldo
  FROM cuenta_corriente_clientes WHERE cliente_id = v_cliente;
  IF v_saldo <> -111765.31 THEN
    RAISE EXCEPTION 'WANG: saldo libro esperado -111.765,31, quedó %', v_saldo;
  END IF;

  RAISE NOTICE 'WANG OK — saldo libro: % (= plata a cuenta del pago)', v_saldo;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Pago colgado de prueba (CARDOZO JORGE, nov-2025, $5.000, sin detalle)
-- ────────────────────────────────────────────────────────────────────────────
UPDATE pagos_clientes
SET estado = 'anulado', anulado_at = now(),
    motivo_anulacion = 'Pago de prueba sin detalle de métodos — anulado por auditoría 11/08/2026'
WHERE id = 'eceef5c5-f41c-4736-96cf-cf62025d7e9c' AND estado = 'pendiente';

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Verificación global: libro == documentos ± plata a cuenta, al centavo,
--    para los dos clientes tocados.
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r record;
  v_dif numeric;
BEGIN
  FOR r IN
    SELECT cl.id, cl.razon_social,
      (SELECT COALESCE(SUM(debe) - SUM(haber), 0) FROM cuenta_corriente_clientes cc WHERE cc.cliente_id = cl.id) AS libro,
      (SELECT COALESCE(SUM(cv.saldo_pendiente), 0) FROM comprobantes_venta cv WHERE cv.cliente_id = cl.id AND cv.anulado_en IS NULL) AS documentos,
      (SELECT COALESCE(SUM(p.monto - COALESCE((SELECT SUM(i.monto_imputado) FROM imputaciones i WHERE i.pago_id = p.id AND i.estado = 'confirmado'), 0)), 0)
         FROM pagos_clientes p WHERE p.cliente_id = cl.id AND p.estado = 'confirmado') AS a_cuenta
    FROM clientes cl
    WHERE cl.razon_social IN ('DISTRIBUIDORA URQUIZA', 'WANG ZHI BIN')
  LOOP
    v_dif := r.libro - (r.documentos - r.a_cuenta);
    IF abs(v_dif) > 0.005 THEN
      RAISE EXCEPTION '%: libro (%) != documentos (%) - a cuenta (%): diferencia %',
        r.razon_social, r.libro, r.documentos, r.a_cuenta, v_dif;
    END IF;
    RAISE NOTICE '% OK — libro % | documentos % | a cuenta %', r.razon_social, r.libro, r.documentos, r.a_cuenta;
  END LOOP;
END $$;

COMMIT;
