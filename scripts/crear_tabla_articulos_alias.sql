-- Tabla para almacenar alias/equivalencias de artículos por proveedor
-- Esto permite que el sistema "aprenda" las descripciones de cada proveedor

CREATE TABLE IF NOT EXISTS articulos_alias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  articulo_id UUID NOT NULL REFERENCES articulos(id) ON DELETE CASCADE,
  proveedor_id UUID NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  
  -- Datos del proveedor que identifican este artículo
  codigo_proveedor VARCHAR(100),
  descripcion_proveedor TEXT,
  alias_texto TEXT, -- Texto libre para búsqueda (palabras clave, variaciones, etc.)
  
  -- Metadatos
  confianza VARCHAR(20) DEFAULT 'manual', -- 'manual', 'automatica_alta', 'automatica_media'
  veces_usado INTEGER DEFAULT 0, -- Contador de cuántas veces se usó este alias
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Índices para búsqueda rápida
  UNIQUE(articulo_id, proveedor_id, codigo_proveedor),
  UNIQUE(articulo_id, proveedor_id, descripcion_proveedor)
);

-- Índices para optimizar búsquedas
CREATE INDEX IF NOT EXISTS idx_articulos_alias_proveedor ON articulos_alias(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_articulos_alias_codigo ON articulos_alias(codigo_proveedor);
CREATE INDEX IF NOT EXISTS idx_articulos_alias_descripcion ON articulos_alias USING gin(to_tsvector('spanish', descripcion_proveedor));

-- Trigger para actualizar updated_at
CREATE OR REPLACE FUNCTION update_articulos_alias_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_articulos_alias_updated_at
  BEFORE UPDATE ON articulos_alias
  FOR EACH ROW
  EXECUTE FUNCTION update_articulos_alias_updated_at();

COMMENT ON TABLE articulos_alias IS 'Almacena equivalencias entre artículos internos y descripciones/códigos de proveedores. El sistema aprende automáticamente con cada factura procesada.';
