-- Agrega datos fiscales faltantes en configuracion_empresa
-- y numeración para el punto de venta 0007 (PV fiscal activo en ARCA).

ALTER TABLE configuracion_empresa
  ADD COLUMN IF NOT EXISTS inicio_actividades  date,
  ADD COLUMN IF NOT EXISTS iibb                varchar(100);

-- Datos reales de la empresa
UPDATE configuracion_empresa SET
  arca_ambiente        = 'produccion',
  arca_punto_venta     = 7,
  inicio_actividades   = '2007-08-21',
  iibb                 = 'Convenio Multilateral — SIFERE';

-- Numeración para PV 0007 (punto de venta fiscal activo).
-- Todos los comprobantes fiscales se emiten desde este PV.
INSERT INTO numeracion_comprobantes (tipo_comprobante, punto_venta, ultimo_numero)
VALUES
  ('FA',  '0007', 0),
  ('FB',  '0007', 0),
  ('NCA', '0007', 0),
  ('NCB', '0007', 0),
  ('NDA', '0007', 0),
  ('NDB', '0007', 0)
ON CONFLICT DO NOTHING;
