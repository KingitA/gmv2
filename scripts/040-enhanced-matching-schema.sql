-- Script 040: Esquema para Matching Mejorado (Capa 2)
-- Autor: Sistema ERP
-- Fecha: 2025-12-12

-- 1. Agregar columnas de metadatos y confianza
ALTER TABLE articulos_proveedores
ADD COLUMN IF NOT EXISTS confianza VARCHAR(50) DEFAULT 'manual', -- 'manual', 'auto_code', 'auto_exact', 'auto_token'
ADD COLUMN IF NOT EXISTS veces_usado INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 2. Indices para Capa 1 y Capa 2
-- Indice para búsqueda por código (Capa 1)
CREATE INDEX IF NOT EXISTS idx_art_prov_codigo 
ON articulos_proveedores(proveedor_id, codigo_proveedor) 
WHERE codigo_proveedor IS NOT NULL;

-- Indice para búsqueda por descripción normalizada (Capa 1 y base para Capa 2)
-- (Probablemente ya existe por el script 039, pero aseguramos)
CREATE INDEX IF NOT EXISTS idx_art_prov_desc_norm_v2 
ON articulos_proveedores(proveedor_id, descripcion_proveedor_norm);

-- 3. Comentarios
COMMENT ON COLUMN articulos_proveedores.confianza IS 'Origen/Calidad del link: manual, auto_code, auto_exact, etc.';
COMMENT ON COLUMN articulos_proveedores.veces_usado IS 'Contador de veces que este alias fue útil para un match';
