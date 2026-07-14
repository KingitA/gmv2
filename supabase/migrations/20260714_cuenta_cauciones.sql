-- ═════════════════════════════════════════════════════════════════════════
-- CUENTA DE INVERSIÓN: CAUCIONES — 2026-07-14
--
-- La tarjeta "Cauciones" de /finanzas era la única sin cuenta real en el
-- sistema de cajas (cuentas_inversion), por eso no se podía editar su saldo.
-- Se agrega CAUCION al CHECK de tipo_instrumento y se crea la cuenta;
-- el saldo se edita igual que el resto (caja_ajustar → kardex AJUSTE_CAJA).
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE public.cuentas_inversion
  DROP CONSTRAINT IF EXISTS cuentas_inversion_tipo_instrumento_check;

ALTER TABLE public.cuentas_inversion
  ADD CONSTRAINT cuentas_inversion_tipo_instrumento_check
  CHECK (tipo_instrumento IN ('ON', 'ACCIONES', 'CEDEARS', 'FCI', 'CAUCION'));

INSERT INTO public.cuentas_inversion (nombre, tipo_instrumento)
SELECT 'Bolsa - Cauciones', 'CAUCION'
WHERE NOT EXISTS (
  SELECT 1 FROM public.cuentas_inversion WHERE nombre = 'Bolsa - Cauciones'
);
