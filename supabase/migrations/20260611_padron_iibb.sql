-- ─────────────────────────────────────────────────────────────────────────────
-- Padrón de alícuotas IIBB + catálogo de jurisdicciones (Convenio Multilateral)
-- Auditoría fiscal 11/06/2026 — tarea 8
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Catálogo cerrado de jurisdicciones (códigos CM 901-924)
CREATE TABLE IF NOT EXISTS jurisdicciones (
  codigo            TEXT PRIMARY KEY,       -- código Convenio Multilateral, ej '902'
  nombre            TEXT NOT NULL UNIQUE,   -- nombre canónico, ej 'Buenos Aires'
  percibe_iibb      BOOLEAN NOT NULL DEFAULT FALSE, -- ¿somos agentes de percepción acá?
  alicuota_general  NUMERIC(5,2) NOT NULL DEFAULT 0 -- fallback si el CUIT no está en el padrón
);

INSERT INTO jurisdicciones (codigo, nombre, percibe_iibb, alicuota_general) VALUES
  ('901', 'Ciudad Autónoma de Buenos Aires', FALSE, 0),
  ('902', 'Buenos Aires',                    FALSE, 0),  -- no somos agentes ARBA
  ('903', 'Catamarca',                       FALSE, 0),
  ('904', 'Córdoba',                         FALSE, 0),
  ('905', 'Corrientes',                      FALSE, 0),
  ('906', 'Chaco',                           FALSE, 0),
  ('907', 'Chubut',                          FALSE, 0),  -- CM: configurar si corresponde percibir
  ('908', 'Entre Ríos',                      FALSE, 0),
  ('909', 'Formosa',                         FALSE, 0),
  ('910', 'Jujuy',                           FALSE, 0),
  ('911', 'La Pampa',                        TRUE,  0),  -- alícuota general: configurar según norma vigente
  ('912', 'La Rioja',                        FALSE, 0),
  ('913', 'Mendoza',                         FALSE, 0),
  ('914', 'Misiones',                        FALSE, 0),
  ('915', 'Neuquén',                         FALSE, 0),
  ('916', 'Río Negro',                       TRUE,  0),  -- padrón por contribuyente (ARTRN)
  ('917', 'Salta',                           FALSE, 0),
  ('918', 'San Juan',                        FALSE, 0),
  ('919', 'San Luis',                        FALSE, 0),
  ('920', 'Santa Cruz',                      FALSE, 0),
  ('921', 'Santa Fe',                        FALSE, 0),
  ('922', 'Santiago del Estero',             FALSE, 0),
  ('923', 'Tucumán',                         FALSE, 0),
  ('924', 'Tierra del Fuego',                FALSE, 0)
ON CONFLICT (codigo) DO NOTHING;

-- 2. Normalizar los valores libres existentes de clientes.provincia al nombre canónico
UPDATE clientes SET provincia = 'Buenos Aires' WHERE UPPER(TRIM(provincia)) IN ('BUENOS AIRES', 'BS AS', 'BSAS', 'PBA', 'GBA', 'PROVINCIA DE BUENOS AIRES');
UPDATE clientes SET provincia = 'Río Negro'    WHERE UPPER(TRIM(provincia)) IN ('RIO NEGRO', 'RÍO NEGRO', 'RN');
UPDATE clientes SET provincia = 'La Pampa'     WHERE UPPER(TRIM(provincia)) IN ('LA PAMPA', 'LP');
UPDATE clientes SET provincia = 'Santa Fe'     WHERE UPPER(TRIM(provincia)) IN ('SANTA FE');
UPDATE clientes SET provincia = 'Chubut'       WHERE UPPER(TRIM(provincia)) IN ('CHUBUT');
UPDATE clientes SET provincia = NULL           WHERE TRIM(COALESCE(provincia, '')) = '';

-- 3. Padrón de alícuotas de percepción IIBB por contribuyente
CREATE TABLE IF NOT EXISTS padron_iibb (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuit                TEXT NOT NULL,            -- sin guiones
  jurisdiccion        TEXT NOT NULL REFERENCES jurisdicciones(codigo),
  alicuota_percepcion NUMERIC(5,2) NOT NULL,
  vigencia_desde      DATE NOT NULL,
  vigencia_hasta      DATE NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cuit, jurisdiccion, vigencia_desde)
);

CREATE INDEX IF NOT EXISTS idx_padron_iibb_lookup
  ON padron_iibb (cuit, jurisdiccion, vigencia_desde, vigencia_hasta);
