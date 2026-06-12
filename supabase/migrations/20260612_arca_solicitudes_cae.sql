-- ─────────────────────────────────────────────────────────────────────────────
-- Registro durable de solicitudes de CAE (auditoría 12/06/2026).
-- Garantiza que ningún CAE autorizado por ARCA pueda perderse sin rastro:
-- se inserta ANTES del insert del comprobante, con el payload completo para
-- poder recrear el registro local con un clic si el insert falla (huérfano).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS arca_solicitudes_cae (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_comprobante TEXT NOT NULL,
  punto_venta      TEXT NOT NULL,
  numero           TEXT NOT NULL,            -- PPPP-NNNNNNNN
  cae              TEXT NOT NULL,
  vencimiento_cae  TEXT,
  importe          NUMERIC(14,2),
  cliente_cuit     TEXT,
  -- 'cae_obtenido'      → CAE otorgado, insert local en curso
  -- 'comprobante_creado'→ flujo completo OK
  -- 'huerfano'          → ARCA autorizó pero el insert local falló: recuperar
  estado           TEXT NOT NULL DEFAULT 'cae_obtenido',
  error_insert     TEXT,
  comprobante_id   UUID REFERENCES comprobantes_venta(id),
  -- Payload para recuperación: { comprobante: {...insert de comprobantes_venta},
  --                              detalle: [...inserts de comprobantes_venta_detalle sin comprobante_id] }
  payload          JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tipo_comprobante, punto_venta, numero)
);

CREATE INDEX IF NOT EXISTS idx_arca_solicitudes_estado ON arca_solicitudes_cae (estado);
