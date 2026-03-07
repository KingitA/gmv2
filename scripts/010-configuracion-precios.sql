-- Tabla de configuración global de precios
CREATE TABLE IF NOT EXISTS configuracion_precios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  porcentaje_gastos_operativos DECIMAL(5,2) DEFAULT 3.00,
  iva_compras_porcentaje DECIMAL(5,2) DEFAULT 21.00,
  iva_ventas_porcentaje DECIMAL(5,2) DEFAULT 21.00,
  iva_mixto_porcentaje DECIMAL(5,2) DEFAULT 10.50,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insertar configuración por defecto
INSERT INTO configuracion_precios (
  porcentaje_gastos_operativos,
  iva_compras_porcentaje,
  iva_ventas_porcentaje,
  iva_mixto_porcentaje
) VALUES (3.00, 21.00, 21.00, 10.50)
ON CONFLICT DO NOTHING;

-- Habilitar RLS
ALTER TABLE configuracion_precios ENABLE ROW LEVEL SECURITY;

-- Política: Todos pueden leer la configuración
CREATE POLICY "Permitir lectura de configuración a todos"
  ON configuracion_precios
  FOR SELECT
  USING (true);

-- Política: Solo admins pueden modificar
CREATE POLICY "Solo admins pueden modificar configuración"
  ON configuracion_precios
  FOR ALL
  USING (auth.role() = 'authenticated');

COMMENT ON TABLE configuracion_precios IS 'Configuración global de porcentajes para cálculo de precios';
