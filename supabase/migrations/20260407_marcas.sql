-- Tabla de marcas
CREATE TABLE IF NOT EXISTS marcas (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  codigo      varchar(50)  UNIQUE NOT NULL,
  descripcion varchar(255) NOT NULL,
  activo      boolean      DEFAULT true NOT NULL,
  created_at  timestamptz  DEFAULT now() NOT NULL
);

-- FK en artículos
ALTER TABLE articulos
  ADD COLUMN IF NOT EXISTS marca_id uuid REFERENCES marcas(id) ON DELETE SET NULL;

-- Índice para búsquedas
CREATE INDEX IF NOT EXISTS idx_articulos_marca_id ON articulos(marca_id);
CREATE INDEX IF NOT EXISTS idx_marcas_codigo ON marcas(codigo);
