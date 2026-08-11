-- ============================================================================
-- FIX DE DATOS — billetera fantasma del vendedor (cobro de oficina)
--
-- El primer cobro post-reset (Urquiza, $4.591.530 en /caja) acreditó
-- $427.287,60 a la billetera del vendedor del cliente, aunque la plata la
-- cobró la OFICINA directo a Caja Chica — el vendedor nunca la tuvo en la
-- calle. Era lógica heredada de generarComisionesCobradas (corregida en el
-- código: la billetera solo la mueven los cobros en la calle y la rendición).
--
-- Este script borra ese movimiento y deja el saldo BILLETERA en 0.
-- Idempotente y con assert. Correr en el SQL Editor.
-- ============================================================================

BEGIN;

DELETE FROM billetera_movimientos
WHERE tipo = 'cobro_cliente'
  AND referencia_tipo = 'pago_cliente'
  AND concepto = 'Cobro PRES';

-- El trigger de sync solo corre en INSERT: el saldo materializado se corrige a mano
UPDATE saldos_financieros SET saldo = 0 WHERE cuenta_tipo = 'BILLETERA';

DO $$
DECLARE v_n int; v_saldo numeric;
BEGIN
  SELECT count(*) INTO v_n FROM billetera_movimientos;
  SELECT COALESCE(sum(saldo), 0) INTO v_saldo FROM saldos_financieros WHERE cuenta_tipo = 'BILLETERA';
  IF v_saldo <> 0 THEN
    RAISE EXCEPTION 'El saldo BILLETERA no quedó en 0 (%)', v_saldo;
  END IF;
  RAISE NOTICE 'BILLETERA OK — % movimientos restantes, saldo 0', v_n;
END $$;

COMMIT;
