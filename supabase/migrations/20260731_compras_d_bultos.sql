-- ─────────────────────────────────────────────────────────────────────────────
-- FASE D Compras: control de bultos + conformidad al transporte (31/07/2026)
--
-- Paso previo (opcional con aviso) al escaneo en /deposito/recibir-mercaderia:
-- el operario cuenta los bultos contra el remito del transporte y deja
-- constancia antes de firmar. Si faltan bultos, la evidencia queda vinculada
-- a la recepción para imputar el faltante a la CC del transporte desde
-- verificación (/cerrar acción B, que ya existe).
-- La foto del remito firmado se guarda en recepciones_documentos (existente).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE recepciones
  ADD COLUMN IF NOT EXISTS transporte_id uuid REFERENCES transportes(id),
  ADD COLUMN IF NOT EXISTS bultos_declarados int,
  ADD COLUMN IF NOT EXISTS bultos_recibidos int,
  ADD COLUMN IF NOT EXISTS conformidad_transporte varchar,  -- 'conforme' | 'no_conforme' | 'omitida'
  ADD COLUMN IF NOT EXISTS conformidad_observaciones text,
  ADD COLUMN IF NOT EXISTS conformidad_at timestamptz;

COMMENT ON COLUMN recepciones.conformidad_transporte IS
  'conforme: bultos OK | no_conforme: difieren (observación obligatoria) | omitida: el operario salteó el control';

-- Control
SELECT count(*) AS transportes_activos FROM transportes;
