-- ─────────────────────────────────────────────────────────────────────────────
-- Quién preparó cada renglón (picking_items) — reglas:
--   · un pedido lo pueden preparar varias personas (una sesión por persona)
--   · un renglón lo prepara UNA sola persona → índice único por renglón
-- No crea tablas ni columnas nuevas: usa picking_items / picking_sesiones /
-- kardex.preparadores_ids que ya existían (picking_items estaba vacía).
-- El código ya aplica la traba por lógica; este índice la blinda en la base
-- ante dos escaneos simultáneos del mismo artículo.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS ux_picking_items_renglon
  ON picking_items (pedido_detalle_id);

-- Una sesión EN_PROGRESO por (pedido, usuario)
CREATE UNIQUE INDEX IF NOT EXISTS ux_picking_sesiones_pedido_usuario_activa
  ON picking_sesiones (pedido_id, usuario_id)
  WHERE estado = 'EN_PROGRESO' AND usuario_id IS NOT NULL;

-- Consulta rápida "preparadores del pedido" desde el kardex
CREATE INDEX IF NOT EXISTS idx_kardex_preparadores_ids
  ON kardex USING gin (preparadores_ids);
