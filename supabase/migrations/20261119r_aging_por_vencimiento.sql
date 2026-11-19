-- ANTIGÜEDAD DE DEUDA DESDE EL VENCIMIENTO (cuentas corrientes, 19/11/2026 — aprobado por Juan)
--
-- Hasta hoy los tramos 0-29 / 30-59 / 60-89 / 90+ contaban días desde la FECHA del
-- comprobante. Con las condiciones de pago (fase 2) cada débito tiene su
-- fecha_vencimiento (fecha + plazo): ahora cuentan DÍAS DE ATRASO, desde
-- COALESCE(fecha_vencimiento, fecha). Lo que todavía no venció queda en 0 días
-- (tramo 0-29). Lo usan v_aging_clientes (tablero de Finanzas, Playroom) y
-- jarvis_deuda_antiguedad (Jarvis).
--
-- Además jarvis_deuda_antiguedad devuelve la columna nueva `vencida` (la misma de
-- cc_deuda_vencimiento, 20261119q): Jarvis deja de calcular su propio "más de 30
-- días = vencido" y usa esa.
--
-- Mismo reparto de antes: el saldo del libro se asigna a los débitos más nuevos
-- (por vencimiento) y lo cobrado se come lo más viejo.
--
-- NO APLICADA. Idempotente. Requiere 20261119q_deuda_vencida.sql (ya aplicada).

-- ── 1. Base de la antigüedad: días desde el vencimiento ─────────────────────
CREATE OR REPLACE FUNCTION public.cc_deuda_antiguedad_base(p_cliente_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(cliente_id uuid, saldo numeric, d0_29 numeric, d30_59 numeric, d60_89 numeric, d90_mas numeric, dias_mas_vieja integer, dias_promedio numeric, fecha_mas_vieja date, debitos_pendientes integer)
 LANGUAGE sql
 STABLE
AS $function$
  WITH saldos AS (
    SELECT cc.cliente_id, SUM(COALESCE(cc.debe, 0)) - SUM(COALESCE(cc.haber, 0)) AS s
    FROM cuenta_corriente_clientes cc
    JOIN clientes cl ON cl.id = cc.cliente_id AND NOT cl.es_empleado
    WHERE p_cliente_id IS NULL OR cc.cliente_id = p_cliente_id
    GROUP BY cc.cliente_id
    HAVING SUM(COALESCE(cc.debe, 0)) - SUM(COALESCE(cc.haber, 0)) > 0.5
  ), debitos AS (
    SELECT cc.cliente_id, cc.id, cc.fecha AS orden_fecha, cc.debe,
      -- Días de ATRASO: desde el vencimiento (fecha + plazo); sin él, desde la fecha
      COALESCE(cv.fecha_vencimiento, cv.fecha, (cc.fecha AT TIME ZONE 'America/Argentina/Buenos_Aires')::date) AS f
    FROM cuenta_corriente_clientes cc
    JOIN saldos s ON s.cliente_id = cc.cliente_id
    LEFT JOIN comprobantes_venta cv
      ON cc.referencia_tipo = 'comprobante_venta' AND cv.id = cc.referencia_id
    WHERE COALESCE(cc.debe, 0) > 0
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
    SELECT s.cliente_id,
      COALESCE((SELECT MIN(d.f) FROM debitos d WHERE d.cliente_id = s.cliente_id), public.hoy_ar()) AS f,
      s.s - COALESCE((SELECT SUM(p.monto) FROM pendiente p WHERE p.cliente_id = s.cliente_id), 0) AS monto
    FROM saldos s
  ), todo AS (
    SELECT p.cliente_id, p.f, p.monto FROM pendiente p WHERE p.monto > 0.005
    UNION ALL
    SELECT r.cliente_id, r.f, r.monto FROM resto r WHERE r.monto > 0.005
  ), con_dias AS (
    -- Lo que todavía no venció tiene 0 días de atraso
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
$function$;

-- ── 2. Jarvis: misma antigüedad + la deuda vencida de cc_deuda_vencimiento ──
-- Cambia la lista de columnas (agrega `vencida`): hay que borrarla y crearla.
DROP FUNCTION IF EXISTS public.jarvis_deuda_antiguedad(uuid, uuid, uuid);
CREATE FUNCTION public.jarvis_deuda_antiguedad(p_zona_id uuid DEFAULT NULL::uuid, p_vendedor_id uuid DEFAULT NULL::uuid, p_cliente_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(cliente_id uuid, cliente text, localidad text, zona text, vendedor text, saldo numeric, d0_29 numeric, d30_59 numeric, d60_89 numeric, d90_mas numeric, dias_mas_vieja integer, ultima_compra date, ultimo_pago date, vencida numeric)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT c.id AS cliente_id, COALESCE(c.nombre, c.nombre_razon_social)::text AS cliente, l.nombre::text AS localidad,
    z.nombre::text AS zona, v.nombre::text AS vendedor,
    b.saldo, b.d0_29, b.d30_59, b.d60_89, b.d90_mas, b.dias_mas_vieja,
    (SELECT MAX(pe.fecha) FROM pedidos pe WHERE pe.cliente_id = c.id AND pe.estado <> 'eliminado') AS ultima_compra,
    (SELECT MAX((cc.fecha AT TIME ZONE 'America/Argentina/Buenos_Aires')::date) FROM cuenta_corriente_clientes cc
      WHERE cc.cliente_id = c.id AND cc.tipo_movimiento = 'pago') AS ultimo_pago,
    COALESCE(dv.vencida, 0) AS vencida
  FROM public.cc_deuda_antiguedad_base(p_cliente_id) b
  JOIN clientes c ON c.id = b.cliente_id
  LEFT JOIN public.cc_deuda_vencimiento(p_cliente_id) dv ON dv.cliente_id = b.cliente_id
  LEFT JOIN localidades l ON l.id = c.localidad_id
  LEFT JOIN zonas z ON z.id = l.zona_id
  LEFT JOIN vendedores v ON v.id = c.vendedor_id
  WHERE (p_zona_id IS NULL OR l.zona_id = p_zona_id)
    AND (p_vendedor_id IS NULL OR c.vendedor_id = p_vendedor_id)
  ORDER BY b.saldo DESC
$function$;
REVOKE EXECUTE ON FUNCTION public.jarvis_deuda_antiguedad(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jarvis_deuda_antiguedad(uuid, uuid, uuid) TO service_role;

-- ── Verificación: los tramos suman el saldo (tiene que dar 0 filas) ──
SELECT * FROM public.cc_deuda_antiguedad_base(NULL)
WHERE abs(d0_29 + d30_59 + d60_89 + d90_mas - saldo) > 0.05;
