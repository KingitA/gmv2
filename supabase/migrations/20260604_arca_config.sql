-- Agrega configuración de ARCA a configuracion_empresa:
-- ambiente (testing/produccion), punto de venta, y caché del Ticket de Acceso.

ALTER TABLE configuracion_empresa
  ADD COLUMN IF NOT EXISTS arca_ambiente       varchar(20)  DEFAULT 'testing',
  ADD COLUMN IF NOT EXISTS arca_punto_venta    integer      DEFAULT 3,
  ADD COLUMN IF NOT EXISTS arca_ta_token       text,
  ADD COLUMN IF NOT EXISTS arca_ta_sign        text,
  ADD COLUMN IF NOT EXISTS arca_ta_expiracion  timestamptz;

-- Actualizar datos reales de la empresa (reemplaza los placeholders)
UPDATE configuracion_empresa SET
  cuit             = '30-71022924-0',
  razon_social     = 'COMPAÑIA DE HIGIENE TOTAL S.R.L.',
  condicion_iva    = 'Responsable Inscripto',
  arca_ambiente    = 'testing',
  arca_punto_venta = 3;

-- Agregar numeración para el punto de venta 0003 (ARCA) desde cero.
-- PRES, REM, REV y RECIBO siguen en 0001 (no requieren CAE).
INSERT INTO numeracion_comprobantes (tipo_comprobante, punto_venta, ultimo_numero)
VALUES
  ('FA',  '0003', 0),
  ('FB',  '0003', 0),
  ('NCA', '0003', 0),
  ('NCB', '0003', 0),
  ('NDA', '0003', 0),
  ('NDB', '0003', 0)
ON CONFLICT DO NOTHING;
