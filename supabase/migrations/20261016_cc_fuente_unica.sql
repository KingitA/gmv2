-- ═══════════════════════════════════════════════════════════════════════
-- CUENTAS CORRIENTES · Fuente única para la deuda por antigüedad (16/10/2026)
--
-- Problema: había TRES cálculos de "deuda por antigüedad" y ninguno daba lo
-- mismo. v_aging_clientes (tablero de Finanzas) sumaba el saldo pendiente de
-- cada comprobante, sin restar la plata a cuenta ni las NC sin imputar: daba
-- $47,8 M contra $35,35 M del libro mayor. Además tomaba la zona de
-- clientes_zonas (1 fila) y usaba CURRENT_DATE (UTC).
--
-- Regla (dueño, 16/10): el saldo de un cliente sale de UN solo lugar, el libro
-- mayor (cuenta_corriente_clientes). La antigüedad reparte ESE saldo sobre los
-- débitos más nuevos (lo pagado cancela primero lo más viejo = imputación a lo
-- más viejo). Así el total por antigüedad es SIEMPRE igual al libro.
--
-- 1. cc_deuda_antiguedad_base(): la fórmula única.
--    - Saldo = Σdebe − Σhaber del libro (solo clientes que deben > $0,50).
--    - Débitos = movimientos con debe, SIN los contra-asientos (anulación de un
--      pago, reversa de un ajuste, anulación de una NC/REV): esos devuelven
--      deuda vieja, no son compras nuevas.
--    - Fecha del débito = fecha del comprobante (si tiene), si no la fecha del
--      movimiento en hora argentina (corrige el corrimiento de 1 día de los
--      movimientos cargados con fecha a medianoche UTC).
--    - Si los débitos no alcanzan a cubrir el saldo (pasa solo con datos
--      viejos), el resto va a la fecha del débito más viejo: el total no se
--      pierde nunca.
-- 2. v_aging_clientes: misma vista, mismas columnas, ahora sobre la fórmula
--    única, con la zona de la localidad del cliente y hoy_ar().
-- 3. jarvis_deuda_antiguedad: misma firma y columnas, ahora sobre la fórmula
--    única (antes tenía su propia copia).
--
-- IDEMPOTENTE. Solo lectura de datos: no modifica ningún movimiento.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Fórmula única ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cc_deuda_antiguedad_base(p_cliente_id uuid DEFAULT NULL)
RETURNS TABLE(cliente_id uuid, saldo numeric, d0_29 numeric, d30_59 numeric, d60_89 numeric, d90_mas numeric,
              dias_mas_vieja integer, dias_promedio numeric, fecha_mas_vieja date, debitos_pendientes integer)
LANGUAGE sql STABLE AS $$
  WITH saldos AS (
    SELECT cc.cliente_id, SUM(COALESCE(cc.debe, 0)) - SUM(COALESCE(cc.haber, 0)) AS s
    FROM cuenta_corriente_clientes cc
    WHERE p_cliente_id IS NULL OR cc.cliente_id = p_cliente_id
    GROUP BY cc.cliente_id
    HAVING SUM(COALESCE(cc.debe, 0)) - SUM(COALESCE(cc.haber, 0)) > 0.5
  ), debitos AS (
    SELECT cc.cliente_id, cc.id, cc.fecha AS orden_fecha, cc.debe,
      COALESCE(cv.fecha, (cc.fecha AT TIME ZONE 'America/Argentina/Buenos_Aires')::date) AS f
    FROM cuenta_corriente_clientes cc
    JOIN saldos s ON s.cliente_id = cc.cliente_id
    LEFT JOIN comprobantes_venta cv
      ON cc.referencia_tipo = 'comprobante_venta' AND cv.id = cc.referencia_id
    WHERE COALESCE(cc.debe, 0) > 0
      -- contra-asientos: devuelven deuda vieja, no son débitos nuevos
      AND COALESCE(cc.referencia_tipo, '') <> 'pago_anulacion'
      AND COALESCE(cc.observaciones, '') NOT LIKE '%[reversa:%'
      AND cc.tipo_movimiento NOT IN ('nota_credito', 'pago')
  ), acumulado AS (
    SELECT d.*, SUM(d.debe) OVER (PARTITION BY d.cliente_id ORDER BY d.f DESC, d.orden_fecha DESC, d.id DESC) AS acum
    FROM debitos d
  ), pendiente AS (
    SELECT a.cliente_id, a.f, GREATEST(0, LEAST(a.debe, s.s - (a.acum - a.debe))) AS monto
    FROM acumulado a JOIN saldos s ON s.cliente_id = a.cliente_id
  ), resto AS (
    -- lo que los débitos no alcanzan a explicar va a la fecha más vieja (o a hoy)
    SELECT s.cliente_id,
      COALESCE((SELECT MIN(d.f) FROM debitos d WHERE d.cliente_id = s.cliente_id), public.hoy_ar()) AS f,
      s.s - COALESCE((SELECT SUM(p.monto) FROM pendiente p WHERE p.cliente_id = s.cliente_id), 0) AS monto
    FROM saldos s
  ), todo AS (
    SELECT p.cliente_id, p.f, p.monto FROM pendiente p WHERE p.monto > 0.005
    UNION ALL
    SELECT r.cliente_id, r.f, r.monto FROM resto r WHERE r.monto > 0.005
  ), con_dias AS (
    SELECT t.cliente_id, t.f, t.monto, GREATEST(0, public.hoy_ar() - t.f) AS dias FROM todo t
  )
  SELECT s.cliente_id,
    ROUND(s.s, 2) AS saldo,
    ROUND(COALESCE(SUM(c.monto) FILTER (WHERE c.dias < 30), 0), 2)              AS d0_29,
    ROUND(COALESCE(SUM(c.monto) FILTER (WHERE c.dias BETWEEN 30 AND 59), 0), 2) AS d30_59,
    ROUND(COALESCE(SUM(c.monto) FILTER (WHERE c.dias BETWEEN 60 AND 89), 0), 2) AS d60_89,
    ROUND(COALESCE(SUM(c.monto) FILTER (WHERE c.dias >= 90), 0), 2)             AS d90_mas,
    MAX(c.dias)::integer AS dias_mas_vieja,
    ROUND(SUM(c.monto * c.dias) / NULLIF(SUM(c.monto), 0), 1) AS dias_promedio,
    MIN(c.f) AS fecha_mas_vieja,
    COUNT(c.*)::integer AS debitos_pendientes
  FROM saldos s
  LEFT JOIN con_dias c ON c.cliente_id = s.cliente_id
  GROUP BY s.cliente_id, s.s
$$;

REVOKE EXECUTE ON FUNCTION public.cc_deuda_antiguedad_base(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cc_deuda_antiguedad_base(uuid) TO authenticated, service_role;

-- ─── 2. v_aging_clientes sobre la fórmula única ────────────────────────
-- Mismas columnas que antes (el tablero de Finanzas no cambia). Solo clientes
-- que deben; antes también listaba los que no, con ceros.
DROP VIEW IF EXISTS public.v_aging_clientes;
CREATE VIEW public.v_aging_clientes AS
SELECT
  b.cliente_id,
  COALESCE(c.nombre, c.nombre_razon_social)::text AS cliente_nombre,
  c.vendedor_id,
  v.nombre::text AS vendedor_nombre,
  l.zona_id,
  z.nombre::text AS zona_nombre,
  b.d0_29   AS corriente,
  b.d30_59  AS dias_30_59,
  b.d60_89  AS dias_60_89,
  b.d90_mas AS mas_90,
  b.saldo   AS saldo_total,
  b.dias_promedio AS dias_cobro_promedio,
  l.nombre::text AS localidad_nombre,
  b.dias_mas_vieja,
  b.fecha_mas_vieja,
  b.debitos_pendientes
FROM public.cc_deuda_antiguedad_base(NULL) b
JOIN clientes c ON c.id = b.cliente_id
LEFT JOIN vendedores v ON v.id = c.vendedor_id
LEFT JOIN localidades l ON l.id = c.localidad_id
LEFT JOIN zonas z ON z.id = l.zona_id;

GRANT SELECT ON public.v_aging_clientes TO authenticated, service_role;

-- ─── 3. Jarvis sobre la misma fórmula ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.jarvis_deuda_antiguedad(
  p_zona_id uuid DEFAULT NULL, p_vendedor_id uuid DEFAULT NULL, p_cliente_id uuid DEFAULT NULL)
RETURNS TABLE(cliente_id uuid, cliente text, localidad text, zona text, vendedor text,
              saldo numeric, d0_29 numeric, d30_59 numeric, d60_89 numeric, d90_mas numeric,
              dias_mas_vieja integer, ultima_compra date, ultimo_pago date)
LANGUAGE sql STABLE AS $$
  SELECT c.id AS cliente_id, COALESCE(c.nombre, c.nombre_razon_social)::text AS cliente, l.nombre::text AS localidad,
    z.nombre::text AS zona, v.nombre::text AS vendedor,
    b.saldo, b.d0_29, b.d30_59, b.d60_89, b.d90_mas, b.dias_mas_vieja,
    (SELECT MAX(pe.fecha) FROM pedidos pe WHERE pe.cliente_id = c.id AND pe.estado <> 'eliminado') AS ultima_compra,
    (SELECT MAX((cc.fecha AT TIME ZONE 'America/Argentina/Buenos_Aires')::date) FROM cuenta_corriente_clientes cc
      WHERE cc.cliente_id = c.id AND cc.tipo_movimiento = 'pago') AS ultimo_pago
  FROM public.cc_deuda_antiguedad_base(p_cliente_id) b
  JOIN clientes c ON c.id = b.cliente_id
  LEFT JOIN localidades l ON l.id = c.localidad_id
  LEFT JOIN zonas z ON z.id = l.zona_id
  LEFT JOIN vendedores v ON v.id = c.vendedor_id
  WHERE (p_zona_id IS NULL OR l.zona_id = p_zona_id)
    AND (p_vendedor_id IS NULL OR c.vendedor_id = p_vendedor_id)
  ORDER BY b.saldo DESC
$$;

REVOKE EXECUTE ON FUNCTION public.jarvis_deuda_antiguedad(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jarvis_deuda_antiguedad(uuid, uuid, uuid) TO service_role;

-- ─── Verificación (correr a mano después de aplicar) ───────────────────
-- Debe dar diferencia 0:
--   SELECT (SELECT SUM(saldo_total) FROM v_aging_clientes) AS antiguedad,
--          (SELECT SUM(saldo_actual) FROM v_saldo_clientes WHERE saldo_actual > 0.5) AS libro;
-- Y por cliente, la suma de los tramos igual al saldo:
--   SELECT * FROM v_aging_clientes WHERE ABS(corriente + dias_30_59 + dias_60_89 + mas_90 - saldo_total) > 0.02;
