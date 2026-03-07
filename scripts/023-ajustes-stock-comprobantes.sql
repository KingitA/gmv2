-- Script para agregar campo ajusta_stock en comprobantes_compra
-- y crear tabla de ajustes de cuenta corriente

-- Agregar campo ajusta_stock a comprobantes_compra
ALTER TABLE comprobantes_compra 
ADD COLUMN IF NOT EXISTS ajusta_stock BOOLEAN DEFAULT true;

-- Crear tabla de ajustes de cuenta corriente
CREATE TABLE IF NOT EXISTS cuenta_corriente_ajustes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  tipo_comprobante VARCHAR(50) NOT NULL,
  numero_comprobante VARCHAR(100) NOT NULL,
  concepto VARCHAR(255) NOT NULL,
  descripcion TEXT,
  monto NUMERIC(12,2) NOT NULL,
  tipo_movimiento VARCHAR(20) NOT NULL CHECK (tipo_movimiento IN ('debe', 'haber')),
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  usuario_creador VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Crear índices
CREATE INDEX IF NOT EXISTS idx_cc_ajustes_cliente ON cuenta_corriente_ajustes(cliente_id);
CREATE INDEX IF NOT EXISTS idx_cc_ajustes_fecha ON cuenta_corriente_ajustes(fecha);
