-- Agrega columna 'estado' al kardex para distinguir movimientos confirmados vs pendientes (OC en camino)
-- y columna 'fecha_estimada_recepcion' a ordenes_compra

ALTER TABLE kardex ADD COLUMN IF NOT EXISTS estado varchar DEFAULT 'confirmado';
UPDATE kardex SET estado = 'confirmado' WHERE estado IS NULL;
CREATE INDEX IF NOT EXISTS idx_kardex_estado ON kardex(estado, tipo_movimiento, articulo_id);

ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS fecha_estimada_recepcion date;

-- Otorgar permisos al usuario readonly para la nueva columna
GRANT SELECT ON kardex TO claude_readonly;
