-- ─────────────────────────────────────────────────────────────────────────────
-- Feature 2 — Listas especiales por proveedor (Colgate / Kenvue / Haleon)
-- Precio neto fijo + oferta por artículo, al lado de precio_base / precio_base_contado.
-- Toda consulta de "lista especial" lee estas dos columnas (no se parsea la descripción).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE articulos
  ADD COLUMN IF NOT EXISTS precio_lista_especial  numeric(12,4),   -- neto, sin impuestos
  ADD COLUMN IF NOT EXISTS oferta_lista_especial  numeric(5,2);    -- % de oferta sobre el neto especial
