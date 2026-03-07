-- Agregar columnas a comprobantes_compra para gestión de pagos
ALTER TABLE comprobantes_compra
ADD COLUMN IF NOT EXISTS fecha_vencimiento DATE,
ADD COLUMN IF NOT EXISTS saldo_pendiente DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS estado_pago VARCHAR(20) DEFAULT 'pendiente';

-- Actualizar saldo_pendiente inicial para comprobantes existentes
UPDATE comprobantes_compra
SET saldo_pendiente = total_factura_declarado
WHERE saldo_pendiente IS NULL;

-- Tabla de pagos a proveedores
CREATE TABLE IF NOT EXISTS pagos_proveedores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proveedor_id UUID NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  fecha_pago DATE NOT NULL,
  monto_total DECIMAL(10,2) NOT NULL,
  es_pago_anticipado BOOLEAN DEFAULT FALSE,
  observaciones TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tabla de detalle de pagos (para transferencias con múltiples bancos, cheques, etc)
CREATE TABLE IF NOT EXISTS pagos_detalle (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pago_id UUID NOT NULL REFERENCES pagos_proveedores(id) ON DELETE CASCADE,
  tipo_pago VARCHAR(20) NOT NULL, -- 'efectivo', 'cheque', 'transferencia'
  banco VARCHAR(100),
  monto DECIMAL(10,2) NOT NULL,
  numero_cheque VARCHAR(50),
  fecha_cheque DATE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tabla de imputaciones (relación entre pagos y comprobantes)
CREATE TABLE IF NOT EXISTS imputaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pago_id UUID NOT NULL REFERENCES pagos_proveedores(id) ON DELETE CASCADE,
  comprobante_id UUID NOT NULL REFERENCES comprobantes_compra(id) ON DELETE CASCADE,
  monto_imputado DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Índices para mejorar performance
CREATE INDEX IF NOT EXISTS idx_pagos_proveedor ON pagos_proveedores(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_pagos_detalle_pago ON pagos_detalle(pago_id);
CREATE INDEX IF NOT EXISTS idx_imputaciones_pago ON imputaciones(pago_id);
CREATE INDEX IF NOT EXISTS idx_imputaciones_comprobante ON imputaciones(comprobante_id);
CREATE INDEX IF NOT EXISTS idx_comprobantes_proveedor ON comprobantes_compra(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_comprobantes_estado_pago ON comprobantes_compra(estado_pago);
