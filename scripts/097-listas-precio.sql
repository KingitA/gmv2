-- =====================================================
-- Script 097: Sistema de Listas de Precio
-- =====================================================

-- Tabla de listas de precio
CREATE TABLE IF NOT EXISTS listas_precio (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(100) NOT NULL,
  codigo VARCHAR(50) NOT NULL UNIQUE,
  recargo_limpieza_bazar DECIMAL(5,2) DEFAULT 0,
  recargo_perfumeria_negro DECIMAL(5,2) DEFAULT 0,
  recargo_perfumeria_blanco DECIMAL(5,2) DEFAULT 0,
  descripcion TEXT,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Insertar las 3 listas
INSERT INTO listas_precio (nombre, codigo, recargo_limpieza_bazar, recargo_perfumeria_negro, recargo_perfumeria_blanco, descripcion) VALUES
  ('Bahía', 'bahia', 0, 0, 0, 'Precio base sin recargos. Clientes locales.'),
  ('Neco', 'neco', 12, 9, 4, 'Con recargo para cubrir flete, comisiones y gastos operativos.'),
  ('Viajante', 'viajante', 20, 9, 4, 'Recargo mayor en limpieza/bazar para absorber descuentos de clientes exigentes.')
ON CONFLICT (codigo) DO NOTHING;

-- Agregar lista y descuento al cliente
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS lista_precio_id UUID REFERENCES listas_precio(id);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS descuento_especial DECIMAL(5,2) DEFAULT 0;

-- Agregar método de facturación override por pedido
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS metodo_facturacion_pedido VARCHAR(50);

COMMENT ON COLUMN clientes.lista_precio_id IS 'Lista de precio asignada al cliente (bahia, neco, viajante)';
COMMENT ON COLUMN clientes.descuento_especial IS 'Descuento especial del cliente en porcentaje';
COMMENT ON COLUMN pedidos.metodo_facturacion_pedido IS 'Override de facturación para este pedido (Factura/Presupuesto/Final). Si null, usa el del cliente.';
