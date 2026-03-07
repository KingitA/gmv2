-- Crear tabla localidades
CREATE TABLE IF NOT EXISTS localidades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(255) NOT NULL,
  provincia VARCHAR(100) NOT NULL,
  zona_id UUID REFERENCES zonas(id) ON DELETE SET NULL,
  codigo_postal VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Modificar tabla clientes: unificar nombre y razón social
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS nombre_razon_social VARCHAR(255);

-- Migrar datos existentes (combinar nombre y razón social)
UPDATE clientes 
SET nombre_razon_social = CASE 
  WHEN razon_social IS NOT NULL AND razon_social != '' THEN razon_social
  ELSE nombre
END
WHERE nombre_razon_social IS NULL;

-- Hacer el campo obligatorio después de migrar datos
ALTER TABLE clientes ALTER COLUMN nombre_razon_social SET NOT NULL;

-- Agregar nueva columna localidad_id para referenciar a localidades
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS localidad_id UUID REFERENCES localidades(id) ON DELETE SET NULL;

-- Crear índices para mejorar performance
CREATE INDEX IF NOT EXISTS idx_localidades_zona ON localidades(zona_id);
CREATE INDEX IF NOT EXISTS idx_clientes_localidad ON clientes(localidad_id);

-- Insertar algunas localidades de ejemplo (puedes eliminarlas después)
INSERT INTO localidades (nombre, provincia, codigo_postal) VALUES
  ('Bahía Blanca', 'Buenos Aires', '8000'),
  ('Cerri', 'Buenos Aires', '8109'),
  ('White', 'Buenos Aires', '8103'),
  ('Necochea', 'Buenos Aires', '7630'),
  ('Quequén', 'Buenos Aires', '7631'),
  ('González Chaves', 'Buenos Aires', '7513')
ON CONFLICT DO NOTHING;
