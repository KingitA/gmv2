-- Migration: Sistema de bonificaciones por cliente
-- 3 tipos: mercaderia (aviso manual + artículo $0), plata (descuento inline en comprobante), viajante (reduce comisión)

CREATE TABLE IF NOT EXISTS bonificaciones (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id   UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  tipo         VARCHAR(20) NOT NULL,
  porcentaje   DECIMAL(5,2) NOT NULL CHECK (porcentaje > 0 AND porcentaje <= 100),
  segmento     VARCHAR(50),       -- NULL = todos | 'limpieza_bazar' | 'perfumeria'
  proveedor_id UUID REFERENCES proveedores(id),
  activo       BOOLEAN NOT NULL DEFAULT TRUE,
  observaciones TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_tipo CHECK (tipo IN ('mercaderia','plata','viajante'))
);

CREATE INDEX IF NOT EXISTS idx_bonificaciones_cliente ON bonificaciones (cliente_id) WHERE activo = TRUE;
