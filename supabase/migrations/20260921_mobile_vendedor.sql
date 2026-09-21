-- =====================================================================
-- App Vendedor (com.gm.vendedor) — ver MOBILE.md → "Vendedor"
-- ADITIVA e IDEMPOTENTE. No modifica ni borra datos existentes.
--
--  pedidos.movil_local_id: id del pedido en el dispositivo que lo tomó.
--  Es la segunda defensa de idempotencia de "pedido.crear" (MOBILE.md §4.2):
--  un pedido capturado sin señal se crea UNA sola vez aunque la app se cierre,
--  se corte la respuesta o el vendedor lo re-edite antes de que sincronice.
--  NULL en todos los pedidos de la web / ERP / importación por IA (no cambia nada).
--
-- OBLIGATORIA para que la app Vendedor pueda enviar pedidos: sin la columna, el
-- servidor deja el pedido PENDIENTE en el equipo (no se pierde) hasta aplicarla.
-- =====================================================================

ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS movil_local_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS ux_pedidos_movil_local_id
  ON public.pedidos (movil_local_id)
  WHERE movil_local_id IS NOT NULL;

COMMENT ON COLUMN public.pedidos.movil_local_id IS
  'Id del pedido en el handheld que lo capturó (app Vendedor). UNIQUE: idempotencia de pedido.crear.';
