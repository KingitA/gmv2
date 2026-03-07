-- Migration 045: Create OCR warnings audit table
-- This logs all conversion issues for debugging and compliance

CREATE TABLE IF NOT EXISTS ocr_conversion_warnings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recepcion_id UUID REFERENCES recepciones(id) ON DELETE CASCADE,
    documento_id UUID REFERENCES recepciones_documentos(id) ON DELETE CASCADE,
    proveedor_id UUID REFERENCES proveedores(id) ON DELETE SET NULL,
    articulo_id UUID REFERENCES articulos(id) ON DELETE SET NULL,
    
    descripcion_ocr TEXT,
    cantidad_ocr NUMERIC(18,6),
    
    warning_type VARCHAR(50) NOT NULL,
    warning_message TEXT,
    
    conversion_attempted JSONB, -- Stores the full context of what was tried
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE ocr_conversion_warnings IS
'Registro de advertencias durante conversión OCR.
Útil para auditoría y debugging de problemas de conversión.';

COMMENT ON COLUMN ocr_conversion_warnings.warning_type IS
'Tipo de advertencia:
- SIN_CONFIG: No había configuración de conversión
- UNIDAD_SIN_FACTOR: unidad_factura != UNIDAD pero sin factor
- FACTOR_CERO: factor_conversion era 0 o negativo
- DESCRIPCION_AMBIGUA: Descripción sugiere multiplicador pero no hay config';

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_ocr_warnings_recepcion 
ON ocr_conversion_warnings(recepcion_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ocr_warnings_type 
ON ocr_conversion_warnings(warning_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ocr_warnings_proveedor 
ON ocr_conversion_warnings(proveedor_id, created_at DESC) 
WHERE proveedor_id IS NOT NULL;
