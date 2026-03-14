-- Script 093: Agregar columnas faltantes en picking_sesiones
-- Corrige tabla creada incompleta en primera ejecución del script 092

ALTER TABLE picking_sesiones 
ADD COLUMN IF NOT EXISTS fecha_inicio TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS fecha_fin TIMESTAMP WITH TIME ZONE;

ALTER TABLE picking_items
ADD COLUMN IF NOT EXISTS usuario_nombre VARCHAR(255),
ADD COLUMN IF NOT EXISTS fecha_escaneo TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS observaciones TEXT;

