-- Script para agregar la columna `codigo_cliente` a la tabla `clientes`

ALTER TABLE public.clientes
ADD COLUMN codigo_cliente text COLLATE pg_catalog."default";

-- Si deseas asegurar de que sea un código único en el futuro, puedes agregar (opcional):
-- ALTER TABLE public.clientes ADD CONSTRAINT idx_codigo_cliente UNIQUE (codigo_cliente);
