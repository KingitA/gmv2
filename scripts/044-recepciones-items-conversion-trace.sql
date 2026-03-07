-- Migration 044: Add conversion traceability to recepciones_items
-- This tracks what conversion was applied and whether it needs review

ALTER TABLE recepciones_items
ADD COLUMN IF NOT EXISTS cantidad_base NUMERIC(18,6);

ALTER TABLE recepciones_items
ADD COLUMN IF NOT EXISTS factor_conversion NUMERIC(18,6);

ALTER TABLE recepciones_items
ADD COLUMN IF NOT EXISTS conversion_source VARCHAR(50);

ALTER TABLE recepciones_items
ADD COLUMN IF NOT EXISTS requires_review BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN recepciones_items.cantidad_base IS 
'Cantidad normalizada a unidad base (UNIDAD). 
Es el resultado de cantidad_documentada × factor_conversion.';

COMMENT ON COLUMN recepciones_items.factor_conversion IS 
'Multiplicador aplicado para llegar a cantidad_base.
Ej: si OCR leyó 46 cajas y factor=24, cantidad_base=1104.';

COMMENT ON COLUMN recepciones_items.conversion_source IS 
'Fuente de la conversión aplicada:
- ARTICULO_PROVEEDOR_FACTOR: factor_conversion explícito
- ARTICULO_PROVEEDOR_UNIDAD: unidad_factura + unidades_por_bulto
- PROVEEDOR_DEFAULT_UNIDAD: default_unidad_factura + unidades_por_bulto
- ARTICULO_UNIDADES_POR_BULTO: solo unidades_por_bulto del artículo
- SIN_CONFIG: no había configuración, se asumió factor=1';

COMMENT ON COLUMN recepciones_items.requires_review IS 
'TRUE si la conversión no tiene configuración confiable.
Bloquea confirmación de recepción hasta que se resuelva manualmente.';

-- Index for filtering items that need review
CREATE INDEX IF NOT EXISTS idx_recepciones_items_review 
ON recepciones_items(recepcion_id, requires_review) 
WHERE requires_review = TRUE;

-- Index for audit queries
CREATE INDEX IF NOT EXISTS idx_recepciones_items_conversion 
ON recepciones_items(conversion_source);
