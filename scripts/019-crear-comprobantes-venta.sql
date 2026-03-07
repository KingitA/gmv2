-- Reemplazando completamente el script para trabajar con la tabla existente

-- La tabla comprobantes_venta ya existe con columna "fecha" (no "fecha_emision")
-- Solo vamos a agregar las columnas que faltan si no existen

-- Agregar columnas faltantes si no existen
DO $$ 
BEGIN
    -- Agregar saldo_pendiente si no existe
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'comprobantes_venta' AND column_name = 'saldo_pendiente'
    ) THEN
        ALTER TABLE comprobantes_venta ADD COLUMN saldo_pendiente DECIMAL(12,2);
        -- Inicializar con el total de la factura
        UPDATE comprobantes_venta SET saldo_pendiente = total WHERE saldo_pendiente IS NULL;
        ALTER TABLE comprobantes_venta ALTER COLUMN saldo_pendiente SET NOT NULL;
    END IF;

    -- Agregar estado_pago si no existe
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'comprobantes_venta' AND column_name = 'estado_pago'
    ) THEN
        ALTER TABLE comprobantes_venta ADD COLUMN estado_pago VARCHAR(20) DEFAULT 'pendiente';
    END IF;

    -- Agregar pedido_id si no existe
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'comprobantes_venta' AND column_name = 'pedido_id'
    ) THEN
        ALTER TABLE comprobantes_venta ADD COLUMN pedido_id UUID REFERENCES pedidos(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Crear tabla de detalle de comprobantes de venta (solo si no existe)
CREATE TABLE IF NOT EXISTS comprobantes_venta_detalle (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comprobante_id UUID REFERENCES comprobantes_venta(id) ON DELETE CASCADE,
  articulo_id UUID REFERENCES articulos(id),
  
  -- Datos del artículo
  descripcion VARCHAR(255) NOT NULL,
  cantidad DECIMAL(10,2) NOT NULL,
  precio_unitario DECIMAL(12,2) NOT NULL,
  precio_total DECIMAL(12,2) NOT NULL,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Crear índices (IF NOT EXISTS es soportado en Postgres 9.5+)
CREATE INDEX IF NOT EXISTS idx_comprobantes_venta_estado_pago ON comprobantes_venta(estado_pago);
CREATE INDEX IF NOT EXISTS idx_comprobantes_venta_pedido ON comprobantes_venta(pedido_id);
CREATE INDEX IF NOT EXISTS idx_comprobantes_venta_detalle_comprobante ON comprobantes_venta_detalle(comprobante_id);
CREATE INDEX IF NOT EXISTS idx_comprobantes_venta_detalle_articulo ON comprobantes_venta_detalle(articulo_id);

-- Comentarios
COMMENT ON COLUMN comprobantes_venta.saldo_pendiente IS 'Saldo pendiente de pago del comprobante';
COMMENT ON COLUMN comprobantes_venta.estado_pago IS 'Estado del pago: pendiente, parcial, pagado';
COMMENT ON TABLE comprobantes_venta_detalle IS 'Detalle de artículos por comprobante de venta';
