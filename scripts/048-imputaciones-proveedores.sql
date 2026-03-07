-- Create table for Provider Payment Imputations
CREATE TABLE IF NOT EXISTS imputaciones_proveedores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_movimiento_pago UUID NOT NULL REFERENCES cuenta_corriente_proveedores(id) ON DELETE CASCADE,
    id_movimiento_documento UUID NOT NULL REFERENCES cuenta_corriente_proveedores(id) ON DELETE CASCADE,
    monto_imputado NUMERIC(20, 2) NOT NULL,
    fecha_imputacion TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_imputaciones_prov_pago ON imputaciones_proveedores(id_movimiento_pago);
CREATE INDEX IF NOT EXISTS idx_imputaciones_prov_doc ON imputaciones_proveedores(id_movimiento_documento);

-- Add a column to cuenta_corriente_proveedores to track if a row is fully settled (optional but helpful)
-- Or we can calculate it on the fly: saldo_pendiente = monto - (SUM(monto_imputado) where id_movimiento_pago = id OR id_movimiento_documento = id)
-- Actually, for 'pago' it should be subtraction, for 'factura' it should be subtraction too.
