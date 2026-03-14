-- Script 095: Ver estructura REAL de picking_sesiones y corregir todo

-- 1. Ver todas las columnas actuales
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'picking_sesiones'
ORDER BY ordinal_position;
