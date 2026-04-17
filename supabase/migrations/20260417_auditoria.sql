-- Migration: Auditoría completa — creado_por + actualizado_por en tablas operativas
-- Las columnas referencian auth.users(id) para trazabilidad de qué usuario realizó cada acción.
-- Se usan FKs opcionales (no ON DELETE CASCADE) para no borrar el historial si un usuario es eliminado.

ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS creado_por UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS actualizado_por UUID REFERENCES auth.users(id);

ALTER TABLE articulos
  ADD COLUMN IF NOT EXISTS creado_por UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS actualizado_por UUID REFERENCES auth.users(id);

ALTER TABLE comprobantes_venta
  ADD COLUMN IF NOT EXISTS creado_por UUID REFERENCES auth.users(id);

ALTER TABLE ordenes_compra
  ADD COLUMN IF NOT EXISTS creado_por UUID REFERENCES auth.users(id);

ALTER TABLE recepciones
  ADD COLUMN IF NOT EXISTS actualizado_por UUID REFERENCES auth.users(id);

-- kardex: operador_id = quién registró el movimiento (≠ vendedor_id = quién hizo la venta)
ALTER TABLE kardex
  ADD COLUMN IF NOT EXISTS operador_id UUID REFERENCES auth.users(id);

-- Índices útiles para consultas de auditoría
CREATE INDEX IF NOT EXISTS idx_pedidos_creado_por     ON pedidos (creado_por);
CREATE INDEX IF NOT EXISTS idx_articulos_actualizado  ON articulos (actualizado_por);
CREATE INDEX IF NOT EXISTS idx_kardex_operador        ON kardex (operador_id);
