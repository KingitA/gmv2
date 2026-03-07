-- Insertar configuración inicial de la empresa
INSERT INTO configuracion_empresa (
  id,
  razon_social,
  cuit,
  direccion,
  condicion_iva,
  telefono,
  email,
  punto_venta_default,
  inicio_actividades
) VALUES (
  gen_random_uuid(),
  'CIA DE HIGIENE TOTAL S.R.L',
  '30-71234567-8',
  'Dirección de la empresa',
  'Responsable Inscripto',
  '011-4444-5555',
  'info@higienetotal.com.ar',
  '0001',
  '2020-01-01'
) ON CONFLICT DO NOTHING;

-- Insertar numeración inicial para todos los tipos de comprobantes
INSERT INTO numeracion_comprobantes (id, tipo_comprobante, punto_venta, ultimo_numero) VALUES
  (gen_random_uuid(), 'FA', '0001', 0),
  (gen_random_uuid(), 'FB', '0001', 0),
  (gen_random_uuid(), 'FC', '0001', 0),
  (gen_random_uuid(), 'NCA', '0001', 0),
  (gen_random_uuid(), 'NCB', '0001', 0),
  (gen_random_uuid(), 'NCC', '0001', 0),
  (gen_random_uuid(), 'NDA', '0001', 0),
  (gen_random_uuid(), 'NDB', '0001', 0),
  (gen_random_uuid(), 'NDC', '0001', 0),
  (gen_random_uuid(), 'PRES', '0001', 0),
  (gen_random_uuid(), 'REM', '0001', 0),
  (gen_random_uuid(), 'REV', '0001', 0)
ON CONFLICT DO NOTHING;
