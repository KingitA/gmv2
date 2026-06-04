-- Migración: reemplazar comprobante_relacionado_id (uuid único) por
-- comprobantes_relacionados_ids (uuid[]) para permitir que una NC/ND
-- referencie múltiples comprobantes originales.
--
-- Una NC por pago contado puede referenciar FA-001, FA-002, FA-003.
-- Una NC por devolución siempre tiene al menos un comprobante de origen.

ALTER TABLE comprobantes_venta
  ADD COLUMN IF NOT EXISTS comprobantes_relacionados_ids uuid[] DEFAULT ARRAY[]::uuid[];

-- Migrar datos existentes: convertir el UUID único a un array de un elemento
UPDATE comprobantes_venta
  SET comprobantes_relacionados_ids = ARRAY[comprobante_relacionado_id]
  WHERE comprobante_relacionado_id IS NOT NULL;

-- Eliminar la columna antigua (sin FK, ya no se usa)
ALTER TABLE comprobantes_venta
  DROP COLUMN IF EXISTS comprobante_relacionado_id;

-- Índice GIN para búsquedas eficientes por ID de comprobante referenciado
CREATE INDEX IF NOT EXISTS idx_comprobantes_venta_relacionados
  ON comprobantes_venta USING GIN (comprobantes_relacionados_ids);
