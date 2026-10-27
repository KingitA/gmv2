-- ═══════════════════════════════════════════════════════════════════════
-- PEDIDOS · candado de "Anular comprobantes" (R11, revisión del 27/10/2026)
--
-- Dos pedidos simultáneos a POST /api/pedidos/[id]/anular-comprobantes (doble
-- clic, dos pestañas, dos personas) podían emitir dos reversas del mismo
-- comprobante. La anulación toma este candado al empezar (solo si está libre o
-- quedó colgado hace más de 10 minutos) y lo suelta al terminar.
--
-- Solo agrega una columna. No cambia datos. IDEMPOTENTE.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS anulando_comprobantes_at timestamptz;

COMMENT ON COLUMN public.pedidos.anulando_comprobantes_at IS
  'R11: cuándo empezó una anulación de comprobantes en curso (candado; NULL = libre)';
