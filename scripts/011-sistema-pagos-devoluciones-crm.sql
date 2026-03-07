-- Sistema de Pagos y Devoluciones para CRM
-- Los pagos y devoluciones registrados desde el CRM quedan pendientes de confirmación

-- Tabla de pagos de clientes (registrados desde CRM)
CREATE TABLE IF NOT EXISTS pagos_clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  vendedor_id UUID REFERENCES vendedores(id) ON DELETE SET NULL,
  monto NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  fecha_pago DATE NOT NULL DEFAULT CURRENT_DATE,
  forma_pago VARCHAR(50) NOT NULL, -- efectivo, transferencia, cheque, tarjeta
  comprobante VARCHAR(100), -- número de recibo, transferencia, etc.
  observaciones TEXT,
  estado VARCHAR(20) NOT NULL DEFAULT 'pendiente', -- pendiente, confirmado, rechazado
  confirmado_por VARCHAR(100), -- usuario del ERP que confirmó
  fecha_confirmacion TIMESTAMP,
  motivo_rechazo TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Tabla de devoluciones (registradas desde CRM)
CREATE TABLE IF NOT EXISTS devoluciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  vendedor_id UUID REFERENCES vendedores(id) ON DELETE SET NULL,
  pedido_id UUID REFERENCES pedidos(id) ON DELETE SET NULL,
  retira_viajante BOOLEAN NOT NULL DEFAULT false,
  observaciones TEXT,
  estado VARCHAR(20) NOT NULL DEFAULT 'pendiente', -- pendiente, confirmado, rechazado
  confirmado_por VARCHAR(100),
  fecha_confirmacion TIMESTAMP,
  motivo_rechazo TEXT,
  monto_total NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Tabla de detalle de devoluciones
CREATE TABLE IF NOT EXISTS devoluciones_detalle (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  devolucion_id UUID NOT NULL REFERENCES devoluciones(id) ON DELETE CASCADE,
  articulo_id UUID NOT NULL REFERENCES articulos(id) ON DELETE CASCADE,
  cantidad NUMERIC(10,2) NOT NULL CHECK (cantidad > 0),
  precio_venta_original NUMERIC(12,2) NOT NULL,
  fecha_venta_original DATE,
  comprobante_venta_id UUID REFERENCES comprobantes_venta(id) ON DELETE SET NULL,
  subtotal NUMERIC(12,2) GENERATED ALWAYS AS (cantidad * precio_venta_original) STORED,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Índices para mejorar performance
CREATE INDEX IF NOT EXISTS idx_pagos_clientes_cliente ON pagos_clientes(cliente_id);
CREATE INDEX IF NOT EXISTS idx_pagos_clientes_vendedor ON pagos_clientes(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_pagos_clientes_estado ON pagos_clientes(estado);
CREATE INDEX IF NOT EXISTS idx_pagos_clientes_fecha ON pagos_clientes(fecha_pago);

CREATE INDEX IF NOT EXISTS idx_devoluciones_cliente ON devoluciones(cliente_id);
CREATE INDEX IF NOT EXISTS idx_devoluciones_vendedor ON devoluciones(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_devoluciones_estado ON devoluciones(estado);
CREATE INDEX IF NOT EXISTS idx_devoluciones_detalle_devolucion ON devoluciones_detalle(devolucion_id);
CREATE INDEX IF NOT EXISTS idx_devoluciones_detalle_articulo ON devoluciones_detalle(articulo_id);

-- Agregar campos a pedidos para condiciones temporales
ALTER TABLE pedidos 
ADD COLUMN IF NOT EXISTS forma_facturacion_temp VARCHAR(50),
ADD COLUMN IF NOT EXISTS direccion_temp TEXT,
ADD COLUMN IF NOT EXISTS razon_social_temp VARCHAR(255),
ADD COLUMN IF NOT EXISTS usar_datos_temporales BOOLEAN DEFAULT false;

COMMENT ON COLUMN pedidos.forma_facturacion_temp IS 'Forma de facturación temporal solo para este pedido';
COMMENT ON COLUMN pedidos.direccion_temp IS 'Dirección temporal solo para este pedido';
COMMENT ON COLUMN pedidos.razon_social_temp IS 'Razón social temporal solo para este pedido';
COMMENT ON COLUMN pedidos.usar_datos_temporales IS 'Si es true, usar datos temporales en lugar de los del cliente';
