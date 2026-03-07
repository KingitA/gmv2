-- Script 031: Implementación de Stock Reservado y Mejoras en Compras
-- Autor: Sistema ERP
-- Fecha: 2024

-- 1. Agregar columna stock_reservado a articulos
ALTER TABLE articulos 
ADD COLUMN IF NOT EXISTS stock_reservado DECIMAL(10, 2) DEFAULT 0;

COMMENT ON COLUMN articulos.stock_reservado IS 'Cantidad comprometida en pedidos pendientes pero aún no facturada/entregada';

-- 2. Agregar columnas de impuestos detallados a comprobantes_compra
ALTER TABLE comprobantes_compra
ADD COLUMN IF NOT EXISTS percepcion_iibb DECIMAL(10, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS percepcion_iva DECIMAL(10, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS impuestos_internos DECIMAL(10, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS otros_impuestos DECIMAL(10, 2) DEFAULT 0;

COMMENT ON COLUMN comprobantes_compra.percepcion_iibb IS 'Monto de percepción de Ingresos Brutos';
COMMENT ON COLUMN comprobantes_compra.percepcion_iva IS 'Monto de percepción de IVA';

-- 3. Agregar columna costo_final a comprobantes_compra_detalle
ALTER TABLE comprobantes_compra_detalle
ADD COLUMN IF NOT EXISTS costo_final DECIMAL(12, 2);

COMMENT ON COLUMN comprobantes_compra_detalle.costo_final IS 'Costo unitario final incluyendo impuestos y prorrateo de fletes';

-- 4. Actualizar vista o lógica de stock disponible (opcional, pero útil para consultas)
-- No creamos vista por ahora, se manejará en lógica de aplicación: Disponible = Stock Actual - Stock Reservado
