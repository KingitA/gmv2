-- Eliminar restricción de clave foránea en pagos_detalle para permitir pagos de clientes
ALTER TABLE pagos_detalle DROP CONSTRAINT IF EXISTS pagos_detalle_pago_id_fkey;

-- Opcional: Asegurar índice para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_pagos_detalle_pago_id ON pagos_detalle(pago_id);
