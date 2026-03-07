-- Script para agregar la columna orden_deposito a la tabla articulos
ALTER TABLE public.articulos 
ADD COLUMN IF NOT EXISTS orden_deposito integer;

-- Opcional: Agregar un comentario a la columna para documentación
COMMENT ON COLUMN public.articulos.orden_deposito IS 'Lugar numérico donde se encuentra en el depósito, usado para ordenar artículos en la impresión de pedidos.';
