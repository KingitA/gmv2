-- ─────────────────────────────────────────────────────────────────────────────
-- Compras: ampliar CHECKs de comprobantes_compra (31/07/2026)
--
-- Los CHECKs originales no contemplaban:
--   · estado 'esperada'  → las NC esperadas de Fase C fallaban en silencio
--   · tipo 'NC' genérico → lo insertan el OCR y crearNCEsperada
--   · tipo 'Remito'      → documento sin precios detectado por el OCR
--   · tipo 'ND'          → nota de débito genérica
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE comprobantes_compra DROP CONSTRAINT IF EXISTS comprobantes_compra_estado_check;
ALTER TABLE comprobantes_compra ADD CONSTRAINT comprobantes_compra_estado_check
  CHECK (estado::text = ANY (ARRAY['pendiente_recepcion','recibido','validado','cerrado','esperada']::text[]));

ALTER TABLE comprobantes_compra DROP CONSTRAINT IF EXISTS comprobantes_compra_tipo_comprobante_check;
ALTER TABLE comprobantes_compra ADD CONSTRAINT comprobantes_compra_tipo_comprobante_check
  CHECK (tipo_comprobante::text = ANY (ARRAY['FA','FB','FC','NC','NCA','NCB','NCC','ND','NDA','NDB','NDC','Adquisicion','Reversa','Remito']::text[]));

-- Control
SELECT count(*) AS comprobantes FROM comprobantes_compra;
