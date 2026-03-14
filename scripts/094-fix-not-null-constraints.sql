-- Script 094: Corregir constraints NOT NULL incorrectos en tablas del módulo depósito
-- Ejecutar en Supabase SQL Editor

-- Hacer nullable las columnas opcionales en picking_sesiones
ALTER TABLE picking_sesiones ALTER COLUMN usuario_id DROP NOT NULL;

-- Agregar columnas faltantes si no existen (script 093)
ALTER TABLE picking_sesiones 
  ADD COLUMN IF NOT EXISTS fecha_inicio TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS fecha_fin TIMESTAMP WITH TIME ZONE;

ALTER TABLE picking_items
  ADD COLUMN IF NOT EXISTS usuario_nombre VARCHAR(255),
  ADD COLUMN IF NOT EXISTS fecha_escaneo TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS observaciones TEXT;

-- Verificar resultado
SELECT column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_name IN ('picking_sesiones', 'picking_items')
ORDER BY table_name, ordinal_position;
