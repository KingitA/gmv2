-- Tabla para almacenar alias/equivalencias de artículos con proveedores
-- Esto permite que el sistema "aprenda" las descripciones y códigos de cada proveedor

CREATE TABLE IF NOT EXISTS articulos_alias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  articulo_id UUID NOT NULL REFERENCES articulos(id) ON DELETE CASCADE,
  proveedor_id UUID NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  codigo_proveedor TEXT, -- SKU o código que usa el proveedor
  descripcion_proveedor TEXT, -- Descripción exacta que aparece en la factura del proveedor
  alias_texto TEXT, -- Texto adicional para búsqueda (palabras clave, variaciones)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Índices para búsqueda rápida
  CONSTRAINT unique_articulo_proveedor_codigo UNIQUE(articulo_id, proveedor_id, codigo_proveedor)
);

CREATE INDEX IF NOT EXISTS idx_articulos_alias_proveedor ON articulos_alias(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_articulos_alias_articulo ON articulos_alias(articulo_id);
CREATE INDEX IF NOT EXISTS idx_articulos_alias_codigo ON articulos_alias(codigo_proveedor);
CREATE INDEX IF NOT EXISTS idx_articulos_alias_descripcion ON articulos_alias USING gin(to_tsvector('spanish', descripcion_proveedor));

COMMENT ON TABLE articulos_alias IS 'Almacena equivalencias entre artículos internos y códigos/descripciones de proveedores';
