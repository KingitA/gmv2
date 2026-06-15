-- ─────────────────────────────────────────────────────────────────────────────
-- Feature 3 — Mercadería bonificada por monto.
-- Override del % de mercadería a bonificar SÓLO para este pedido. Si es NULL, se usa
-- el % de la ficha del cliente (bonificaciones tipo='mercaderia'). La mercadería
-- bonificada se sigue representando con pedidos_detalle.es_bonificado + kardex.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS bonif_mercaderia_pct numeric(5,2);
