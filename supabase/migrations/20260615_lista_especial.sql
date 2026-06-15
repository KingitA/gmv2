-- ─────────────────────────────────────────────────────────────────────────────
-- Feature 2 — Lista de precios "Especial"
-- Es el disparador: cuando una condición de proveedor usa esta lista, el motor de
-- precios saltea la cascada y usa articulos.precio_lista_especial − oferta_lista_especial,
-- siempre en factura y en comprobante aparte.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO listas_precio
  (nombre, codigo, recargo_limpieza_bazar, recargo_perfumeria_negro, recargo_perfumeria_blanco, activo)
VALUES
  ('Especial', 'especial', 0, 0, 0, true)
ON CONFLICT (codigo) DO NOTHING;
