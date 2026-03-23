-- Agrega columnas para pantalla de actualizaciones de artículos
-- prioridad: para ordenar drag & drop
-- fecha_aplicacion: cuándo se aplicaron los cambios

ALTER TABLE importaciones_articulos ADD COLUMN IF NOT EXISTS prioridad integer DEFAULT 999;
ALTER TABLE importaciones_articulos ADD COLUMN IF NOT EXISTS fecha_aplicacion timestamptz DEFAULT null;
