-- Snapshots de saldo por caja. Cada registro es una actualización manual.
CREATE TABLE IF NOT EXISTS finanzas_saldos (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  caja_key   varchar(50) NOT NULL,
  monto      numeric(18,2) NOT NULL DEFAULT 0,
  fecha      date        NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_finanzas_saldos_caja_fecha
  ON finanzas_saldos(caja_key, fecha DESC);
