-- P2-38 (2ª prueba, cuentas corrientes, 30/10/2026): los renglones de la billetera
-- tienen que sumar lo mismo que su saldo.
--
-- Qué pasa: la diferencia de una rendición (y un gasto rechazado) entra a
-- billetera_movimientos como renglón 'rendicion_saldo_declarado' /
-- 'rendicion_diferencia' / 'rendicion_devuelta' / 'viaje_gasto_rechazado'. Ese
-- renglón es solo el VEHÍCULO hacia la cuenta personal (billetera_a_cuenta_empleado
-- lo copia ahí) y la billetera no lo suma (billetera_saldo_sync, #29). El saldo da
-- $0, pero los renglones suman +$1.000 (chofer, rendición 4a774e9b).
--
-- Arreglo: por cada renglón vehículo, la base agrega su TRASPASO en la billetera
-- ('traspaso_cuenta_personal', importe opuesto, "pasa a la cuenta personal"). El
-- traspaso tampoco mueve el saldo ni se copia a la cuenta personal. Resultado:
-- renglones = saldo, sin tocar el saldo, la rendición ni las cuentas personales.
--
-- NO APLICADA. Idempotente.

-- ── 1. El saldo de la billetera tampoco suma el traspaso ─────────────────────
CREATE OR REPLACE FUNCTION public.billetera_saldo_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Diferencias de rendición y gastos rechazados son deuda/crédito PERSONAL del
  -- cobrador (billetera_a_cuenta_empleado los copia a su cuenta): no son plata
  -- de la empresa en su mano (#29). Su traspaso (P2-38) tampoco.
  IF NEW.referencia_tipo IN ('rendicion_saldo_declarado', 'rendicion_diferencia', 'rendicion_devuelta', 'viaje_gasto_rechazado', 'traspaso_cuenta_personal') THEN
    RETURN NEW;
  END IF;
  INSERT INTO saldos_financieros (cuenta_tipo, cuenta_id, color, saldo)
  VALUES ('BILLETERA', NEW.viajante_id, 'BLANCO', COALESCE(NEW.monto, 0))
  ON CONFLICT (cuenta_tipo, cuenta_id, color)
  DO UPDATE SET saldo = saldos_financieros.saldo + COALESCE(NEW.monto, 0), updated_at = now();
  RETURN NEW;
END;
$function$;

-- ── 2. Traspaso automático de cada renglón vehículo ─────────────────────────
CREATE OR REPLACE FUNCTION public.billetera_traspaso_cuenta_personal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.monto, 0) = 0 THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM billetera_movimientos
    WHERE referencia_tipo = 'traspaso_cuenta_personal' AND referencia_id = NEW.id
  ) THEN
    RETURN NEW;
  END IF;
  INSERT INTO billetera_movimientos (viajante_id, tipo, medio, monto, concepto, referencia_id, referencia_tipo, fecha, creado_por)
  VALUES (
    NEW.viajante_id,
    CASE WHEN NEW.monto > 0 THEN 'debito' ELSE 'credito' END,
    NULL,
    -NEW.monto,
    'Pasa a la cuenta personal: ' || COALESCE(NEW.concepto, NEW.referencia_tipo),
    NEW.id,
    'traspaso_cuenta_personal',
    COALESCE(NEW.fecha, now()),
    NEW.creado_por
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_billetera_traspaso_cuenta_personal ON public.billetera_movimientos;
CREATE TRIGGER trg_billetera_traspaso_cuenta_personal
  AFTER INSERT ON public.billetera_movimientos
  FOR EACH ROW
  WHEN (NEW.referencia_tipo IN ('rendicion_saldo_declarado', 'rendicion_diferencia', 'rendicion_devuelta', 'viaje_gasto_rechazado'))
  EXECUTE FUNCTION public.billetera_traspaso_cuenta_personal();

-- ── 3. Relleno: traspaso de los renglones vehículo que ya existen ───────────
INSERT INTO public.billetera_movimientos (viajante_id, tipo, medio, monto, concepto, referencia_id, referencia_tipo, fecha, creado_por)
SELECT
  m.viajante_id,
  CASE WHEN m.monto > 0 THEN 'debito' ELSE 'credito' END,
  NULL,
  -m.monto,
  'Pasa a la cuenta personal: ' || COALESCE(m.concepto, m.referencia_tipo),
  m.id,
  'traspaso_cuenta_personal',
  COALESCE(m.fecha, now()),
  m.creado_por
FROM public.billetera_movimientos m
WHERE m.referencia_tipo IN ('rendicion_saldo_declarado', 'rendicion_diferencia', 'rendicion_devuelta', 'viaje_gasto_rechazado')
  AND COALESCE(m.monto, 0) <> 0
  AND NOT EXISTS (
    SELECT 1 FROM public.billetera_movimientos t
    WHERE t.referencia_tipo = 'traspaso_cuenta_personal' AND t.referencia_id = m.id
  );

-- ── Verificación: renglones = saldo para cada billetera (tiene que dar 0 filas) ──
SELECT s.cuenta_id AS viajante_id, s.saldo, r.renglones
FROM public.saldos_financieros s
JOIN (SELECT viajante_id, round(sum(monto), 2) AS renglones FROM public.billetera_movimientos GROUP BY viajante_id) r
  ON r.viajante_id = s.cuenta_id
WHERE s.cuenta_tipo = 'BILLETERA' AND abs(s.saldo - r.renglones) > 0.009;
