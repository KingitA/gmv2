-- Módulo de listas de precios de proveedores
-- Permite importar listas con precios, descuentos y fechas de vigencia

CREATE TABLE IF NOT EXISTS listas_proveedores (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  proveedor_id uuid REFERENCES proveedores(id),
  nombre varchar(200),
  fecha_vigencia date NOT NULL,
  fecha_fin date,
  archivo_url text,
  estado varchar DEFAULT 'pendiente', -- borrador | pendiente | aplicada | vencida
  observaciones text,
  creado_por uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS listas_proveedores_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lista_id uuid REFERENCES listas_proveedores(id) ON DELETE CASCADE,
  articulo_id uuid REFERENCES articulos(id),
  codigo_proveedor varchar(100),
  descripcion_proveedor text,
  precio_compra numeric(12,4),
  descuento1 numeric(6,4),
  descuento2 numeric(6,4),
  descuento3 numeric(6,4),
  descuento4 numeric(6,4),
  iva_compras varchar(20),
  precio_anterior numeric(12,4),
  estado_item varchar DEFAULT 'pendiente', -- pendiente | aplicado | ignorado
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listas_proveedores_proveedor ON listas_proveedores(proveedor_id, fecha_vigencia DESC);
CREATE INDEX IF NOT EXISTS idx_listas_proveedores_estado ON listas_proveedores(estado, fecha_vigencia);
CREATE INDEX IF NOT EXISTS idx_listas_items_lista ON listas_proveedores_items(lista_id);
CREATE INDEX IF NOT EXISTS idx_listas_items_articulo ON listas_proveedores_items(articulo_id);

-- Permisos
GRANT SELECT ON listas_proveedores TO claude_readonly;
GRANT SELECT ON listas_proveedores_items TO claude_readonly;
