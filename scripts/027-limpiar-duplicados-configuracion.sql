-- Limpiar duplicados en configuracion_empresa
-- Eliminar todos los registros e insertar uno limpio

-- Paso 1: Eliminar TODOS los registros
DELETE FROM configuracion_empresa;

-- Paso 2: Insertar UN SOLO registro con los datos correctos
INSERT INTO configuracion_empresa (
  razon_social,
  cuit,
  direccion,
  telefono,
  email,
  condicion_iva,
  numero_iibb,
  punto_venta_default,
  logo_url,
  inicio_actividades,
  created_at,
  updated_at
) VALUES (
  'CIA DE HIGIENE TOTAL S.R.L.',
  '30-71234567-8',
  'Calle Falsa 123, CABA, Argentina',
  '+54 11 1234-5678',
  'info@higienetotal.com.ar',
  'Responsable Inscripto',
  '123-456789-0',
  '0001',
  NULL,
  '2010-01-01',
  NOW(),
  NOW()
);
