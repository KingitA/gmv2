-- Script 038: Normalizar Alias de Proveedores
-- Autor: Sistema ERP
-- Fecha: 2025-12-12
-- Propósito: Convertir todas las descripciones a minúsculas y trim para coincidir con la lógica del código

UPDATE articulos_proveedores
SET descripcion_proveedor = LOWER(TRIM(REGEXP_REPLACE(descripcion_proveedor, '\s+', ' ', 'g')));
