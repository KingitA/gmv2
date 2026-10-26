-- =====================================================================
-- #43 (prueba integral de salida, regla de Juan 26/10): los gastos del viaje
-- se aprueban AL ACEPTAR LA RENDICIÓN en /caja, asociados al VEHÍCULO o al
-- concepto (nafta, camión, peón, hotel u otro). Queda quién y cuándo
-- (revisado_por / revisado_at, que ya existían).
--   · viajes_gastos.vehiculo_id → a qué vehículo va el gasto (por defecto el del viaje)
--   · categoría nueva 'camion' (mantenimiento / reparación del vehículo)
-- La aprobación misma sigue siendo viaje_gasto_resolver (sin cambios): no toca
-- la rendición (los gastos quedaron congelados al declararla, migración 20260929).
-- ADITIVA e IDEMPOTENTE. El código tolera que todavía no esté aplicada.
-- =====================================================================
ALTER TABLE public.viajes_gastos
  ADD COLUMN IF NOT EXISTS vehiculo_id UUID REFERENCES public.vehiculos(id);

ALTER TABLE public.viajes_gastos DROP CONSTRAINT IF EXISTS viajes_gastos_categoria_check;
ALTER TABLE public.viajes_gastos ADD CONSTRAINT viajes_gastos_categoria_check
  CHECK (categoria IN ('nafta', 'camion', 'peon', 'hotel', 'peaje', 'comida', 'cubierta', 'otro'));

-- Los gastos de viajes con vehículo quedan asociados a ese vehículo
UPDATE public.viajes_gastos g
SET vehiculo_id = v.vehiculo_id
FROM public.viajes v
WHERE v.id = g.viaje_id AND g.vehiculo_id IS NULL AND v.vehiculo_id IS NOT NULL;
