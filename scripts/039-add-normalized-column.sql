-- Script 039: Agregar Columna Normalizada para Matching de Artículos
-- Autor: Sistema ERP
-- Fecha: 2025-12-12
-- Propósito: Implementar matching robusto insensible a mayúsculas/minúsculas y espacios

-- 1. Agregar columna normalizada
ALTER TABLE articulos_proveedores
ADD COLUMN IF NOT EXISTS descripcion_proveedor_norm TEXT;

-- 2. Backfill: Normalizar datos existentes (lowercase, trim, collapse spaces)
UPDATE articulos_proveedores
SET descripcion_proveedor_norm = LOWER(TRIM(REGEXP_REPLACE(descripcion_proveedor, '\s+', ' ', 'g')));

-- 3. Hacer la columna obligatoria (después del backfill)
ALTER TABLE articulos_proveedores
ALTER COLUMN descripcion_proveedor_norm SET NOT NULL;

-- 4. Indices y Constraints
-- Crear índice para búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_articulos_prov_desc_norm 
ON articulos_proveedores(proveedor_id, descripcion_proveedor_norm);

-- Asegurar unicidad por proveedor y descripción normalizada (opcional, pero recomendado)
-- Primero eliminamos duplicados si existen (manteniendo el más reciente)
DELETE FROM articulos_proveedores a USING (
    SELECT MIN(ctid) as ctid, descripcion_proveedor_norm, proveedor_id
    FROM articulos_proveedores 
    GROUP BY descripcion_proveedor_norm, proveedor_id HAVING COUNT(*) > 1
) b
WHERE a.descripcion_proveedor_norm = b.descripcion_proveedor_norm 
AND a.proveedor_id = b.proveedor_id 
AND a.ctid <> b.ctid;

-- Ahora aplicamos la constraint única
ALTER TABLE articulos_proveedores
ADD CONSTRAINT uq_articulos_prov_desc_norm UNIQUE (proveedor_id, descripcion_proveedor_norm);

COMMENT ON COLUMN articulos_proveedores.descripcion_proveedor IS 'Texto original tal cual viene del OCR/Proveedor';
COMMENT ON COLUMN articulos_proveedores.descripcion_proveedor_norm IS 'Texto normalizado para matching (lowercase, trim, single spaces)';
