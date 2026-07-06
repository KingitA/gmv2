-- ─────────────────────────────────────────────────────────────────────────────
-- FASE B5 — Fix de v_saldos_control
--
-- Dos defectos detectados en la verificación post-apertura:
--   1. La vista no incluía cuentas INVERSION (fue creada en B2, antes del
--      enum de B4a) → Bolsa-FCI aparecía con diferencia de $51,2M.
--   2. Contaba movimientos kardex ANTERIORES a la apertura de cada cuenta
--      (los cobros históricos pre-B1 ya están contenidos en el snapshot de
--      apertura) → falsas diferencias en Caja Chica y MercadoPago.
--
-- Definición correcta del lado ledger:
--   saldo_ledger(cuenta) = Σ movimientos DESDE la apertura inclusive
--   (si la cuenta no tiene apertura, se cuentan todos sus movimientos).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_saldos_control AS
WITH apertura AS (
  SELECT destino_tipo AS cuenta_tipo, destino_id AS cuenta_id, min(created_at) AS desde
  FROM kardex_contable
  WHERE tipo_movimiento = 'APERTURA_SALDO'
  GROUP BY 1, 2
),
kx AS (
  SELECT k.*
  FROM kardex_contable k
  WHERE NOT EXISTS (
    -- excluir movimientos previos a la apertura de la cuenta involucrada
    SELECT 1 FROM apertura a
    WHERE ((a.cuenta_tipo = k.origen_tipo AND a.cuenta_id = k.origen_id)
        OR (a.cuenta_tipo = k.destino_tipo AND a.cuenta_id = k.destino_id))
      AND k.created_at < a.desde
  )
),
ledger AS (
  SELECT destino_tipo AS cuenta_tipo, destino_id AS cuenta_id,
         COALESCE(color, 'BLANCO') AS color,
         sum(abs(monto) - COALESCE(gastos, 0)) AS entra, 0::numeric AS sale
  FROM kx
  WHERE destino_tipo IN ('CAJA', 'BANCO', 'BILLETERA', 'INVERSION') AND destino_id IS NOT NULL
  GROUP BY 1, 2, 3
  UNION ALL
  SELECT origen_tipo, origen_id, COALESCE(color, 'BLANCO'),
         0, sum(abs(monto))
  FROM kx
  WHERE origen_tipo IN ('CAJA', 'BANCO', 'BILLETERA', 'INVERSION') AND origen_id IS NOT NULL
  GROUP BY 1, 2, 3
)
SELECT
  sf.cuenta_tipo, sf.cuenta_id, sf.color,
  sf.saldo AS saldo_materializado,
  COALESCE(sum(l.entra - l.sale), 0) AS saldo_ledger,
  sf.saldo - COALESCE(sum(l.entra - l.sale), 0) AS diferencia
FROM saldos_financieros sf
LEFT JOIN ledger l
  ON l.cuenta_tipo = sf.cuenta_tipo::text
 AND l.cuenta_id = sf.cuenta_id
 AND l.color = sf.color::text
GROUP BY sf.cuenta_tipo, sf.cuenta_id, sf.color, sf.saldo;

GRANT SELECT ON public.v_saldos_control TO authenticated, service_role;
