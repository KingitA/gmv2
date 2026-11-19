-- CONDICIONES DE PAGO, FASE 3 (cuentas corrientes, 19/11/2026): DEUDA VENCIDA / A VENCER
-- por cliente, con UNA fuente para el ERP y las apps (la fase 4 la muestra en el filtro
-- "Deuda vencida / Deuda a vencer" de Mis clientes).
--
--   cc_deuda_vencimiento(p_cliente_id uuid DEFAULT NULL)   -- un cliente o todos
--   v_deuda_vencimiento                                     -- todos (para listas)
--   → cliente_id, saldo, vencida, a_vencer, vencimiento_mas_viejo, proximo_vencimiento
--
-- Regla:
--   · saldo = el del libro mayor (misma fuente que v_saldo_clientes / getSaldosCliente).
--   · Cada débito (FA/FB/FC/PRES/ND) vivo con saldo pendiente vence en su
--     fecha_vencimiento (fecha + plazo, fase 2); sin ella (facturado antes de la
--     fase 2), en su fecha. Los créditos (NC/REV) traen un vencimiento que no
--     significa nada: no se miran.
--   · Lo que el libro tiene de menos que esos débitos (créditos y pagos a cuenta sin
--     imputar) se aplica a lo MÁS VIEJO primero, como la antigüedad de deuda.
--   · Lo que el libro tiene de más (deuda sin comprobante: ajustes de la apertura,
--     "Ajustar saldo"…) es exigible: cuenta como VENCIDA.
--   · Vencida = lo pendiente con vencimiento ANTERIOR a hoy (hoy_ar()); a vencer = el resto.
--     vencida + a_vencer = saldo, siempre. Saldo ≤ 0 (al día o a favor): 0 y 0.
--
-- La misma regla en TypeScript (sin base, para tests y para las apps sin señal):
-- lib/cuenta-corriente/vencimientos.ts → repartirVencimientos.
--
-- NO APLICADA. Idempotente.

CREATE OR REPLACE FUNCTION public.cc_deuda_vencimiento(p_cliente_id uuid DEFAULT NULL)
RETURNS TABLE(
  cliente_id uuid,
  saldo numeric,
  vencida numeric,
  a_vencer numeric,
  vencimiento_mas_viejo date,
  proximo_vencimiento date
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH saldos AS (
    SELECT cc.cliente_id, SUM(COALESCE(cc.debe, 0)) - SUM(COALESCE(cc.haber, 0)) AS s
    FROM cuenta_corriente_clientes cc
    WHERE p_cliente_id IS NULL OR cc.cliente_id = p_cliente_id
    GROUP BY cc.cliente_id
  ), items AS (
    SELECT v.cliente_id, v.id, v.fecha, COALESCE(v.fecha_vencimiento, v.fecha) AS venc, v.saldo_pendiente AS monto
    FROM comprobantes_venta v
    JOIN saldos s ON s.cliente_id = v.cliente_id AND s.s > 0.005
    WHERE v.anulado_en IS NULL
      AND COALESCE(v.estado_pago, '') <> 'anulado'
      AND v.tipo_comprobante IN ('FA', 'FB', 'FC', 'PRES', 'ND', 'NDA', 'NDB', 'NDC')
      AND v.saldo_pendiente > 0.005
  ), tot AS (
    SELECT i.cliente_id, SUM(i.monto) AS t FROM items i GROUP BY i.cliente_id
  ), acum AS (
    SELECT i.*, SUM(i.monto) OVER (PARTITION BY i.cliente_id ORDER BY i.venc, i.fecha, i.id) AS acum
    FROM items i
  ), pendiente AS (
    -- crédito sin imputar = lo que los débitos suman de más sobre el saldo; se come lo más viejo
    SELECT a.cliente_id, a.venc,
      GREATEST(0, LEAST(a.monto, a.acum - GREATEST(0, t.t - s.s))) AS monto
    FROM acum a
    JOIN tot t ON t.cliente_id = a.cliente_id
    JOIN saldos s ON s.cliente_id = a.cliente_id
  ), resumen AS (
    SELECT s.cliente_id, s.s,
      CASE WHEN s.s <= 0.005 THEN 0 ELSE
        COALESCE(SUM(p.monto) FILTER (WHERE p.venc < public.hoy_ar()), 0)
        + GREATEST(0, s.s - COALESCE(t.t, 0))  -- deuda sin comprobante: exigible
      END AS vencida,
      MIN(p.venc) FILTER (WHERE p.monto > 0.005) AS mas_viejo,
      MIN(p.venc) FILTER (WHERE p.monto > 0.005 AND p.venc >= public.hoy_ar()) AS proximo
    FROM saldos s
    LEFT JOIN tot t ON t.cliente_id = s.cliente_id
    LEFT JOIN pendiente p ON p.cliente_id = s.cliente_id
    GROUP BY s.cliente_id, s.s, t.t
  )
  SELECT r.cliente_id,
    ROUND(r.s, 2) AS saldo,
    ROUND(r.vencida, 2) AS vencida,
    -- a vencer = saldo − vencida, así suman exacto aunque redondee
    CASE WHEN r.s <= 0.005 THEN 0 ELSE ROUND(r.s, 2) - ROUND(r.vencida, 2) END AS a_vencer,
    r.mas_viejo AS vencimiento_mas_viejo,
    r.proximo AS proximo_vencimiento
  FROM resumen r
$function$;

CREATE OR REPLACE VIEW public.v_deuda_vencimiento AS
  SELECT * FROM public.cc_deuda_vencimiento(NULL);

-- ── Verificación: tiene que dar 0 filas (vencida + a vencer = saldo con deuda) ──
SELECT * FROM public.v_deuda_vencimiento
WHERE saldo > 0.005 AND abs(vencida + a_vencer - saldo) > 0.001;
