-- ─────────────────────────────────────────────────────────────────────────────
-- FASE J2 — Catálogo de categorías de gastos (definido con el usuario 28-07)
--
-- El VEP es un MEDIO de pago (con un VEP pagás 931, IVA, SICORE…), no una
-- categoría — desaparece como tipo. Catálogo nuevo de vencimientos.tipo:
--   factura · sueldos · cargas_sociales · impuestos · servicios ·
--   honorarios · seguros · vehiculos · socios · otro
--
-- Remapeo de datos existentes (verificado en prod: servicio 38, impuesto 3,
-- seguro 1, factura 109, otro 3 — no hay filas 'vep'):
--   servicio → servicios · impuesto → impuestos · seguro → seguros
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.vencimientos SET tipo = 'servicios' WHERE tipo = 'servicio';
UPDATE public.vencimientos SET tipo = 'impuestos' WHERE tipo IN ('impuesto', 'vep');
UPDATE public.vencimientos SET tipo = 'seguros'   WHERE tipo = 'seguro';

-- Constraint nuevo (tipo era texto libre sin CHECK)
ALTER TABLE public.vencimientos
  DROP CONSTRAINT IF EXISTS vencimientos_tipo_check;
ALTER TABLE public.vencimientos
  ADD CONSTRAINT vencimientos_tipo_check
  CHECK (tipo IS NULL OR tipo IN (
    'factura', 'sueldos', 'cargas_sociales', 'impuestos', 'servicios',
    'honorarios', 'seguros', 'vehiculos', 'socios', 'otro'
  ));
