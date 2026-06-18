-- ─────────────────────────────────────────────────────────────────────────────
-- Cobranzas: cabecera de UN cobro físico que puede abarcar VARIOS clientes/CUITs.
--
-- Caso de uso: un grupo paga un cheque por el total de las deudas de varios de sus
-- clientes (CUITs distintos). La cobranza agrupa N pagos_clientes (uno por cliente),
-- cada uno imputa a los comprobantes de SU cliente y postea su haber al libro mayor
-- vía confirmarCobranza. El instrumento físico (cheque) se concilia a este nivel.
--
-- No duplica nada: no existía tabla de agrupación de pagos de clientes
-- (el análogo de proveedores es ordenes_pago, otro dominio).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cobranzas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha           date NOT NULL DEFAULT current_date,
  estado          varchar(20) NOT NULL DEFAULT 'pendiente', -- pendiente | confirmada | anulada
  origen          varchar(20) NOT NULL DEFAULT 'ERP',        -- ERP | VIAJE | MOSTRADOR
  viaje_id        uuid REFERENCES viajes(id) ON DELETE SET NULL,
  vendedor_id     uuid REFERENCES vendedores(id) ON DELETE SET NULL,
  cobrador_id     uuid,                                      -- usuario que cobró (auth.users)
  total           numeric(14,2) NOT NULL DEFAULT 0,
  observaciones   text,
  confirmado_por  uuid,
  confirmado_at   timestamptz,
  creado_por      uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Vínculo: cada pago de cliente puede pertenecer a una cobranza (cobro físico).
ALTER TABLE pagos_clientes
  ADD COLUMN IF NOT EXISTS cobranza_id uuid REFERENCES cobranzas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pagos_clientes_cobranza ON pagos_clientes (cobranza_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON cobranzas TO anon, authenticated, service_role;
