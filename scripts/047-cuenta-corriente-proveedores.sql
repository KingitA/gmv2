-- Create table for Provider Current Account (Cuenta Corriente Proveedores)
CREATE TABLE IF NOT EXISTS cuenta_corriente_proveedores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proveedor_id UUID NOT NULL REFERENCES proveedores(id),
    fecha TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    tipo_movimiento VARCHAR(50) NOT NULL, -- 'factura', 'pago', 'ajuste_precio', 'nota_debito', 'nota_credito'
    monto NUMERIC(20, 2) NOT NULL,
    descripcion TEXT,
    referencia_id UUID, -- Link to recepcion_id or pago_id
    referencia_tipo VARCHAR(50), -- 'recepcion', 'pago'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for speed
CREATE INDEX IF NOT EXISTS idx_cc_proveedores_proveedor ON cuenta_corriente_proveedores(proveedor_id);
