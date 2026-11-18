-- ─────────────────────────────────────────────────────────────────────────────
-- Jarvis y reportes de COMPRAS (Tanda 2-B: E-80, E-81, E-83, E-101) — 19/11/2026
--
-- TODO es de SOLO LECTURA: funciones que consultan, y UNA tabla nueva (ia_fallas) donde el
-- sistema anota cuando un servicio de IA rechaza un pedido por saldo o cuota. No cambia ningún
-- dato existente. Se puede correr las veces que haga falta.
--
-- Requiere aplicadas: 20261117n (órdenes de compra), 20261117p (órdenes de pago: usa
-- cc_proveedor_saldo_movimiento), 20261117b (recepciones_diferencias), 20261118d (documentos
-- de recepción con lectura_estado).
--
-- Reglas que respetan todas las consultas:
--   · COMPRADO = comprobantes de compra VALIDADOS (estado validado / cerrado). Sin remitos, sin
--     notas "esperadas", sin estimados ni provisiones de órdenes de compra.
--   · Notas de crédito y reversas RESTAN.
--   · Canal: Adquisición y Reversa = sin factura ("negro"); el resto = con factura ("blanco").
--   · DEUDA con un proveedor = saldo de su cuenta corriente (lo comprometido por órdenes de
--     compra NO es deuda y va aparte) + vencimientos cargados a mano que no tienen comprobante.
--     Una sola cuenta para todas las herramientas (E-83).
--
-- Permisos: solo el servidor (service_role). Quién puede ver qué lo decide el código que llama.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════ 0. Fallas de IA por saldo o cuota (E-101) ═════════════════════
CREATE TABLE IF NOT EXISTS public.ia_fallas (
  id          bigserial PRIMARY KEY,
  servicio    text NOT NULL,                 -- gemini | claude
  estado      int,                           -- código HTTP (402 sin crédito, 429 cuota)
  mensaje     text,
  origen      text,                          -- dónde pasó ("lectura de comprobante de compra"…)
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ia_fallas_fecha ON public.ia_fallas (created_at DESC);
ALTER TABLE public.ia_fallas ENABLE ROW LEVEL SECURITY;   -- sin políticas: solo el servidor
COMMENT ON TABLE public.ia_fallas IS
  'Cada vez que un servicio de IA rechaza un pedido por saldo/cuota (E-101). La lee el vigía lectura_ia de Jarvis.';

-- ═════════════════════ 1. Cuenta corriente de proveedores ═════════════════════

-- 1.a Ítems ABIERTOS de la cuenta corriente: deudas con saldo, créditos sin aplicar y lo
--     comprometido por órdenes de compra. Los pagos anulados y su anulación no figuran (se
--     compensan entre sí).
CREATE OR REPLACE FUNCTION public.jarvis_cc_abiertos(p_proveedor_id uuid DEFAULT NULL)
RETURNS TABLE(proveedor_id uuid, movimiento_id uuid, fecha date, clase text, tipo_movimiento text,
              tipo_comprobante text, numero_comprobante text, descripcion text,
              monto numeric, saldo numeric, vence date, dias_vencido integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH base AS (
    SELECT cc.id, cc.proveedor_id, (cc.fecha AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS fecha,
           cc.tipo_movimiento::text AS tipo_movimiento, cc.tipo_comprobante::text AS tipo_comprobante,
           cc.numero_comprobante::text AS numero_comprobante, cc.descripcion, cc.monto,
           CASE WHEN cc.tipo_movimiento = 'orden_compra' THEN cc.monto
                ELSE public.cc_proveedor_saldo_movimiento(cc.id) END AS saldo,
           COALESCE(cc.fecha_vencimiento,
                    (SELECT min(v.fecha_vencimiento) FROM vencimientos v
                      WHERE v.referencia_tipo = 'cuenta_corriente' AND v.referencia_id = cc.id
                        AND v.estado IN ('pendiente', 'vencido') AND NOT COALESCE(v.es_estimado, false)),
                    (cc.fecha AT TIME ZONE 'America/Argentina/Buenos_Aires')::date) AS vence
    FROM cuenta_corriente_proveedores cc
    WHERE (p_proveedor_id IS NULL OR cc.proveedor_id = p_proveedor_id)
      AND cc.tipo_movimiento <> 'anulacion'
      AND NOT (cc.referencia_tipo = 'orden_pago' AND EXISTS (
            SELECT 1 FROM cuenta_corriente_proveedores an
             WHERE an.referencia_tipo = 'orden_pago_anulacion' AND an.referencia_id = cc.referencia_id))
  )
  SELECT b.proveedor_id, b.id, b.fecha,
         CASE WHEN b.tipo_movimiento = 'orden_compra' THEN 'comprometido'
              WHEN b.saldo > 0 THEN 'deuda' ELSE 'credito' END,
         b.tipo_movimiento, b.tipo_comprobante, b.numero_comprobante, b.descripcion,
         round(b.monto, 2), round(b.saldo, 2),
         CASE WHEN b.tipo_movimiento <> 'orden_compra' AND b.saldo > 0 THEN b.vence END,
         CASE WHEN b.tipo_movimiento <> 'orden_compra' AND b.saldo > 0 AND b.vence < public.hoy_ar()
              THEN (public.hoy_ar() - b.vence) END
  FROM base b
  WHERE abs(b.saldo) > 0.01
$$;

-- 1.b Vencimientos de proveedor cargados A MANO (sin comprobante ni movimiento de cuenta
--     corriente detrás): son deuda que la cuenta corriente no conoce. Sin estimados.
CREATE OR REPLACE FUNCTION public.jarvis_vencimientos_a_mano(p_proveedor_id uuid DEFAULT NULL)
RETURNS TABLE(proveedor_id uuid, vencimiento_id uuid, concepto text, tipo text, monto numeric, vence date, dias_vencido integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT v.proveedor_id, v.id, v.concepto::text, v.tipo::text, round(v.monto, 2), v.fecha_vencimiento,
         CASE WHEN v.fecha_vencimiento < public.hoy_ar() THEN (public.hoy_ar() - v.fecha_vencimiento) END
  FROM vencimientos v
  WHERE v.proveedor_id IS NOT NULL
    AND (p_proveedor_id IS NULL OR v.proveedor_id = p_proveedor_id)
    AND v.estado IN ('pendiente', 'vencido')
    AND NOT COALESCE(v.es_estimado, false)
    AND COALESCE(v.monto, 0) > 0
    AND NOT (v.referencia_id IS NOT NULL AND COALESCE(v.referencia_tipo, '') IN ('cuenta_corriente', 'comprobante_compra', 'orden_compra'))
$$;

-- 1.c Resumen por proveedor: LA deuda (E-83) y su antigüedad.
--     saldo_cc           = suma de la cuenta corriente (sin lo comprometido por órdenes de compra)
--     vencimientos_a_mano = deuda anotada en el calendario sin comprobante
--     deuda_total        = saldo_cc + vencimientos_a_mano      ← "cuánto le debemos"
--     La antigüedad reparte lo ABIERTO (comprobantes con saldo + vencimientos a mano) por días
--     de vencido; los créditos sin aplicar van en su columna y ya están restados en deuda_total.
CREATE OR REPLACE FUNCTION public.jarvis_cc_proveedores(p_proveedor_id uuid DEFAULT NULL)
RETURNS TABLE(proveedor_id uuid, proveedor text, saldo_cc numeric, vencimientos_a_mano numeric, deuda_total numeric,
              deuda_abierta numeric, creditos_sin_aplicar numeric, comprometido_oc numeric,
              a_vencer numeric, vencido_1_30 numeric, vencido_31_60 numeric, vencido_61_90 numeric, vencido_mas_90 numeric,
              proximo_vencimiento date, comprobantes_abiertos bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH saldos AS (
    SELECT cc.proveedor_id, sum(cc.monto) FILTER (WHERE cc.tipo_movimiento <> 'orden_compra') AS saldo_cc
    FROM cuenta_corriente_proveedores cc
    WHERE (p_proveedor_id IS NULL OR cc.proveedor_id = p_proveedor_id)
    GROUP BY 1
  ), abiertos AS (
    SELECT a.proveedor_id,
           sum(a.saldo) FILTER (WHERE a.clase = 'deuda') AS deuda_abierta,
           sum(a.saldo) FILTER (WHERE a.clase = 'credito') AS creditos,
           sum(a.saldo) FILTER (WHERE a.clase = 'comprometido') AS comprometido,
           count(*) FILTER (WHERE a.clase = 'deuda') AS n
    FROM public.jarvis_cc_abiertos(p_proveedor_id) a GROUP BY 1
  ), partidas AS (       -- todo lo que hay que pagar, con su fecha
    SELECT a.proveedor_id, a.saldo AS importe, a.vence, COALESCE(a.dias_vencido, 0) AS dias
    FROM public.jarvis_cc_abiertos(p_proveedor_id) a WHERE a.clase = 'deuda'
    UNION ALL
    SELECT m.proveedor_id, m.monto, m.vence, COALESCE(m.dias_vencido, 0)
    FROM public.jarvis_vencimientos_a_mano(p_proveedor_id) m
  ), tramos AS (
    SELECT pa.proveedor_id,
           sum(pa.importe) FILTER (WHERE pa.dias <= 0) AS a_vencer,
           sum(pa.importe) FILTER (WHERE pa.dias BETWEEN 1 AND 30) AS v30,
           sum(pa.importe) FILTER (WHERE pa.dias BETWEEN 31 AND 60) AS v60,
           sum(pa.importe) FILTER (WHERE pa.dias BETWEEN 61 AND 90) AS v90,
           sum(pa.importe) FILTER (WHERE pa.dias > 90) AS vmas,
           min(pa.vence) FILTER (WHERE pa.vence >= public.hoy_ar()) AS prox
    FROM partidas pa GROUP BY 1
  ), mano AS (
    SELECT m.proveedor_id, sum(m.monto) AS total FROM public.jarvis_vencimientos_a_mano(p_proveedor_id) m GROUP BY 1
  )
  SELECT p.id, p.nombre::text,
         round(COALESCE(s.saldo_cc, 0), 2), round(COALESCE(mn.total, 0), 2),
         round(COALESCE(s.saldo_cc, 0) + COALESCE(mn.total, 0), 2),
         round(COALESCE(ab.deuda_abierta, 0), 2), round(COALESCE(ab.creditos, 0), 2), round(COALESCE(ab.comprometido, 0), 2),
         round(COALESCE(t.a_vencer, 0), 2), round(COALESCE(t.v30, 0), 2), round(COALESCE(t.v60, 0), 2),
         round(COALESCE(t.v90, 0), 2), round(COALESCE(t.vmas, 0), 2),
         t.prox, COALESCE(ab.n, 0)
  FROM proveedores p
  LEFT JOIN saldos s ON s.proveedor_id = p.id
  LEFT JOIN abiertos ab ON ab.proveedor_id = p.id
  LEFT JOIN tramos t ON t.proveedor_id = p.id
  LEFT JOIN mano mn ON mn.proveedor_id = p.id
  WHERE (p_proveedor_id IS NULL OR p.id = p_proveedor_id)
    AND (p_proveedor_id IS NOT NULL
         OR abs(COALESCE(s.saldo_cc, 0)) > 0.01 OR COALESCE(mn.total, 0) > 0.01
         OR abs(COALESCE(ab.comprometido, 0)) > 0.01 OR COALESCE(ab.n, 0) > 0)
$$;

-- 1.d jarvis_proveedores_resumen: MISMA firma y columnas que 20261014h; cambia solo de dónde sale
--     la deuda (antes: suma de vencimientos, con estimados aparte; ahora: jarvis_cc_proveedores).
CREATE OR REPLACE FUNCTION public.jarvis_proveedores_resumen(p_proveedor_id uuid DEFAULT NULL)
RETURNS TABLE(proveedor_id uuid, proveedor text, articulos_activos bigint,
              venta_30d numeric, costo_30d numeric, ultimo_aumento date, dias_sin_aumento integer,
              articulos_aumentados_90d bigint, aumento_promedio_pct_90d numeric,
              deuda_pendiente numeric, deuda_vencida numeric, proximo_vencimiento date, oc_abiertas bigint,
              deuda_estimada numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH v30 AS (
    SELECT k.articulo_proveedor_id AS pid,
      SUM(CASE WHEN k.tipo_movimiento = 'nota_credito_venta' THEN -1 ELSE 1 END * COALESCE(k.subtotal_neto, k.subtotal_total, 0)) AS neto,
      SUM(CASE WHEN k.tipo_movimiento = 'nota_credito_venta' THEN -1 ELSE 1 END
          * CASE WHEN COALESCE(k.precio_costo, 0) > 0 THEN k.precio_costo
                 WHEN COALESCE(a.ultimo_costo, 0) > 0 THEN a.ultimo_costo
                 ELSE COALESCE(a.precio_compra, 0) END
          * ABS(COALESCE(k.cantidad, 0))) AS costo
    FROM kardex k LEFT JOIN articulos a ON a.id = k.articulo_id
    WHERE k.tipo_movimiento IN ('venta', 'nota_credito_venta')
      AND COALESCE(k.pedido_eliminado, false) = false
      AND k.fecha >= ((public.hoy_ar() - 30)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')
      AND (p_proveedor_id IS NULL OR k.articulo_proveedor_id = p_proveedor_id)
    GROUP BY 1
  ), versiones AS (
    -- Historial de precios de artículos (desde 18/09/2026; la versión del
    -- 01/01/2000 es la foto inicial, no un cambio). Aumento = cambió precio_compra.
    -- Solo versiones CON precio: así una versión sin precio no corta la comparación
    SELECT h.registro_id, h.datos->>'proveedor_id' AS pid, h.vigente_desde,
      (h.datos->>'precio_compra')::numeric AS pc,
      LAG((h.datos->>'precio_compra')::numeric) OVER (PARTITION BY h.registro_id ORDER BY h.vigente_desde) AS pc_ant
    FROM precio_insumos_historial h
    WHERE h.tabla = 'articulos' AND NULLIF(h.datos->>'precio_compra', '')::numeric > 0
  ), aumentos AS (
    SELECT pid,
      MAX(vigente_desde) AS ultimo,
      COUNT(DISTINCT registro_id) FILTER (WHERE vigente_desde >= (public.hoy_ar() - 90)) AS n90,
      AVG((pc / pc_ant - 1) * 100) FILTER (WHERE vigente_desde >= (public.hoy_ar() - 90)) AS pct90
    FROM versiones
    WHERE pc_ant > 0 AND pc > pc_ant   -- solo subas (una baja no es "aumentó")
    GROUP BY pid
  )
  SELECT p.id AS proveedor_id, p.nombre::text AS proveedor,
    (SELECT COUNT(*) FROM articulos a WHERE a.proveedor_id = p.id AND a.activo IS NOT FALSE) AS articulos_activos,
    ROUND(COALESCE(v.neto, 0), 2) AS venta_30d, ROUND(COALESCE(v.costo, 0), 2) AS costo_30d,
    (au.ultimo AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS ultimo_aumento,
    public.hoy_ar() - (au.ultimo AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS dias_sin_aumento,
    COALESCE(au.n90, 0) AS articulos_aumentados_90d, ROUND(au.pct90, 1) AS aumento_promedio_pct_90d,
    -- E-83: la deuda es la MISMA que muestra la cuenta corriente del proveedor (jarvis_cc_proveedores):
    -- saldo de la cuenta corriente + vencimientos cargados a mano que no tienen comprobante.
    -- "deuda_estimada" pasa a ser lo COMPROMETIDO por órdenes de compra sin facturar (no es deuda).
    ROUND(COALESCE(cc.deuda_total, 0), 2) AS deuda_pendiente, ROUND(COALESCE(cc.vencido, 0), 2) AS deuda_vencida, cc.proximo_vencimiento,
    (SELECT COUNT(*) FROM ordenes_compra o WHERE o.proveedor_id = p.id
       AND o.estado NOT IN ('recibida_completa', 'finalizada', 'cancelada')) AS oc_abiertas,
    ROUND(COALESCE(cc.comprometido_oc, 0), 2) AS deuda_estimada
  FROM proveedores p
  LEFT JOIN v30 v ON v.pid = p.id
  LEFT JOIN aumentos au ON au.pid = p.id::text
  LEFT JOIN (
    SELECT x.proveedor_id, x.deuda_total, x.comprometido_oc, x.proximo_vencimiento,
           x.vencido_1_30 + x.vencido_31_60 + x.vencido_61_90 + x.vencido_mas_90 AS vencido
    FROM public.jarvis_cc_proveedores(p_proveedor_id) x
  ) cc ON cc.proveedor_id = p.id
  WHERE (p_proveedor_id IS NULL OR p.id = p_proveedor_id)
  ORDER BY v.neto DESC NULLS LAST
$$;

-- ═════════════════════ 2. Compras ═════════════════════

-- 2.a Compras de un período, agrupadas. p_agrupar: total | proveedor | mes | canal | articulo.
--     Por encabezado (total/proveedor/mes/canal): netos y totales de cada comprobante.
--     Por artículo (o si se filtra un artículo): renglones; importes NETOS (sin IVA) y unidades.
CREATE OR REPLACE FUNCTION public.jarvis_compras(
  p_desde date, p_hasta date, p_agrupar text DEFAULT 'total',
  p_proveedor_id uuid DEFAULT NULL, p_articulo_id uuid DEFAULT NULL
) RETURNS TABLE(clave_id text, clave text, comprobantes bigint,
                blanco_neto numeric, blanco_total numeric, negro_total numeric, total numeric, unidades numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_articulo_id IS NOT NULL OR p_agrupar = 'articulo' THEN
    RETURN QUERY
    WITH lineas AS (
      SELECT c.id AS comp_id, c.proveedor_id, c.fecha_comprobante,
             CASE WHEN c.tipo_comprobante IN ('Adquisicion', 'ADQ', 'Reversa', 'REV') THEN 'negro' ELSE 'blanco' END AS canal,
             CASE WHEN c.tipo_comprobante IN ('NC', 'NCA', 'NCB', 'NCC', 'Reversa', 'REV') THEN -1 ELSE 1 END AS signo,
             d.articulo_id,
             round(COALESCE(d.cantidad_facturada, 0)
                   * public.oc_neto_unitario(d.precio_unitario, d.descuento1, d.descuento2, d.descuento3, d.descuento4, pr.tipo_descuento::text), 2) AS neto,
             COALESCE(d.cantidad_facturada, 0) * CASE WHEN d.tipo_cantidad = 'bulto'
                  THEN COALESCE(NULLIF(ri.factor_conversion, 0), NULLIF(a.unidades_por_bulto, 0), 1) ELSE 1 END AS unidades
      FROM comprobantes_compra c
      JOIN comprobantes_compra_detalle d ON d.comprobante_id = c.id
      LEFT JOIN proveedores pr ON pr.id = c.proveedor_id
      LEFT JOIN articulos a ON a.id = d.articulo_id
      LEFT JOIN recepciones_items ri ON ri.id = d.recepcion_item_id
      WHERE c.estado IN ('validado', 'cerrado') AND c.tipo_comprobante <> 'Remito'
        AND c.fecha_comprobante BETWEEN p_desde AND p_hasta
        AND (p_proveedor_id IS NULL OR c.proveedor_id = p_proveedor_id)
        AND (p_articulo_id IS NULL OR d.articulo_id = p_articulo_id)
        AND d.articulo_id IS NOT NULL
        AND COALESCE(d.match_estado, '') <> 'no_mercaderia'
    )
    , claves AS (
      SELECT l.*,
             CASE p_agrupar WHEN 'proveedor' THEN l.proveedor_id::text WHEN 'mes' THEN to_char(l.fecha_comprobante, 'YYYY-MM')
                            WHEN 'canal' THEN l.canal WHEN 'articulo' THEN l.articulo_id::text ELSE 'total' END AS k_id,
             CASE p_agrupar WHEN 'proveedor' THEN pv.nombre::text WHEN 'mes' THEN to_char(l.fecha_comprobante, 'YYYY-MM')
                            WHEN 'canal' THEN l.canal
                            WHEN 'articulo' THEN (COALESCE(ar.sku || ' — ', '') || COALESCE(ar.descripcion, ''))::text ELSE 'Total' END AS k_nombre
      FROM lineas l
      LEFT JOIN proveedores pv ON pv.id = l.proveedor_id
      LEFT JOIN articulos ar ON ar.id = l.articulo_id
    )
    SELECT l.k_id, max(l.k_nombre),
           count(DISTINCT l.comp_id),
           round(sum(l.signo * l.neto) FILTER (WHERE l.canal = 'blanco'), 2),
           NULL::numeric,
           round(sum(l.signo * l.neto) FILTER (WHERE l.canal = 'negro'), 2),
           round(sum(l.signo * l.neto), 2),
           round(sum(l.signo * l.unidades), 2)
    FROM claves l
    GROUP BY l.k_id;
  ELSE
    RETURN QUERY
    WITH comp AS (
      SELECT c.id, c.proveedor_id, c.fecha_comprobante,
             CASE WHEN c.tipo_comprobante IN ('Adquisicion', 'ADQ', 'Reversa', 'REV') THEN 'negro' ELSE 'blanco' END AS canal,
             CASE WHEN c.tipo_comprobante IN ('NC', 'NCA', 'NCB', 'NCC', 'Reversa', 'REV') THEN -1 ELSE 1 END AS signo,
             abs(COALESCE(c.total_neto, 0)) AS neto,
             abs(COALESCE(NULLIF(c.total_factura_declarado, 0), c.total_calculado, 0)) AS tot
      FROM comprobantes_compra c
      WHERE c.estado IN ('validado', 'cerrado') AND c.tipo_comprobante <> 'Remito'
        AND c.fecha_comprobante BETWEEN p_desde AND p_hasta
        AND (p_proveedor_id IS NULL OR c.proveedor_id = p_proveedor_id)
    )
    , claves AS (
      SELECT k.*,
             CASE p_agrupar WHEN 'proveedor' THEN k.proveedor_id::text WHEN 'mes' THEN to_char(k.fecha_comprobante, 'YYYY-MM')
                            WHEN 'canal' THEN k.canal ELSE 'total' END AS k_id,
             CASE p_agrupar WHEN 'proveedor' THEN pv.nombre::text WHEN 'mes' THEN to_char(k.fecha_comprobante, 'YYYY-MM')
                            WHEN 'canal' THEN k.canal ELSE 'Total' END AS k_nombre
      FROM comp k LEFT JOIN proveedores pv ON pv.id = k.proveedor_id
    )
    SELECT k.k_id, max(k.k_nombre),
           count(*),
           round(sum(k.signo * k.neto) FILTER (WHERE k.canal = 'blanco'), 2),
           round(sum(k.signo * k.tot) FILTER (WHERE k.canal = 'blanco'), 2),
           round(sum(k.signo * k.tot) FILTER (WHERE k.canal = 'negro'), 2),
           round(sum(k.signo * k.tot), 2),
           NULL::numeric
    FROM claves k
    GROUP BY k.k_id;
  END IF;
END;
$$;

-- 2.b Compras por proveedor Y mes (reporte): una fila por proveedor y mes, con y sin factura.
CREATE OR REPLACE FUNCTION public.jarvis_compras_proveedor_mes(p_desde date, p_hasta date, p_proveedor_id uuid DEFAULT NULL)
RETURNS TABLE(proveedor_id uuid, proveedor text, mes text, comprobantes bigint,
              blanco_neto numeric, blanco_total numeric, negro_total numeric, total numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH comp AS (
    SELECT c.proveedor_id, to_char(c.fecha_comprobante, 'YYYY-MM') AS mes,
           CASE WHEN c.tipo_comprobante IN ('Adquisicion', 'ADQ', 'Reversa', 'REV') THEN 'negro' ELSE 'blanco' END AS canal,
           CASE WHEN c.tipo_comprobante IN ('NC', 'NCA', 'NCB', 'NCC', 'Reversa', 'REV') THEN -1 ELSE 1 END AS signo,
           abs(COALESCE(c.total_neto, 0)) AS neto,
           abs(COALESCE(NULLIF(c.total_factura_declarado, 0), c.total_calculado, 0)) AS tot
    FROM comprobantes_compra c
    WHERE c.estado IN ('validado', 'cerrado') AND c.tipo_comprobante <> 'Remito'
      AND c.fecha_comprobante BETWEEN p_desde AND p_hasta
      AND (p_proveedor_id IS NULL OR c.proveedor_id = p_proveedor_id)
  )
  SELECT k.proveedor_id, max(pv.nombre)::text, k.mes, count(*),
         round(COALESCE(sum(k.signo * k.neto) FILTER (WHERE k.canal = 'blanco'), 0), 2),
         round(COALESCE(sum(k.signo * k.tot) FILTER (WHERE k.canal = 'blanco'), 0), 2),
         round(COALESCE(sum(k.signo * k.tot) FILTER (WHERE k.canal = 'negro'), 0), 2),
         round(sum(k.signo * k.tot), 2)
  FROM comp k LEFT JOIN proveedores pv ON pv.id = k.proveedor_id
  GROUP BY k.proveedor_id, k.mes
$$;

-- 2.c Renglones comprados (para "última compra de…" y la evolución del costo), del más nuevo
--     al más viejo. Cantidad y precio tal cual la factura; neto_unitario = neto de la línea
--     dividido las unidades (si la factura vino por bulto se convierte con el factor de la recepción).
CREATE OR REPLACE FUNCTION public.jarvis_compras_renglones(
  p_articulo_id uuid DEFAULT NULL, p_proveedor_id uuid DEFAULT NULL,
  p_desde date DEFAULT NULL, p_hasta date DEFAULT NULL, p_limite int DEFAULT 20
) RETURNS TABLE(comprobante_id uuid, fecha date, proveedor_id uuid, proveedor text, tipo_comprobante text, numero_comprobante text,
                canal text, orden text, articulo_id uuid, sku text, articulo text,
                cantidad numeric, tipo_cantidad text, unidades numeric, precio_lista numeric,
                descuentos text, neto_linea numeric, neto_unitario numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.fecha_comprobante, c.proveedor_id, pr.nombre::text, c.tipo_comprobante::text, c.numero_comprobante::text,
         CASE WHEN c.tipo_comprobante IN ('Adquisicion', 'ADQ', 'Reversa', 'REV') THEN 'negro' ELSE 'blanco' END,
         oc.numero_orden::text, d.articulo_id, a.sku::text, a.descripcion::text,
         d.cantidad_facturada, COALESCE(d.tipo_cantidad, 'unidad')::text,
         x.unidades, d.precio_unitario,
         NULLIF(concat_ws(' + ', NULLIF(d.descuento1, 0)::text, NULLIF(d.descuento2, 0)::text, NULLIF(d.descuento3, 0)::text, NULLIF(d.descuento4, 0)::text), ''),
         x.neto, CASE WHEN x.unidades > 0 THEN round(x.neto / x.unidades, 2) END
  FROM comprobantes_compra c
  JOIN comprobantes_compra_detalle d ON d.comprobante_id = c.id
  LEFT JOIN proveedores pr ON pr.id = c.proveedor_id
  LEFT JOIN articulos a ON a.id = d.articulo_id
  LEFT JOIN recepciones_items ri ON ri.id = d.recepcion_item_id
  LEFT JOIN ordenes_compra oc ON oc.id = c.orden_compra_id
  CROSS JOIN LATERAL (
    SELECT round(COALESCE(d.cantidad_facturada, 0)
                 * public.oc_neto_unitario(d.precio_unitario, d.descuento1, d.descuento2, d.descuento3, d.descuento4, pr.tipo_descuento::text), 2) AS neto,
           COALESCE(d.cantidad_facturada, 0) * CASE WHEN d.tipo_cantidad = 'bulto'
                THEN COALESCE(NULLIF(ri.factor_conversion, 0), NULLIF(a.unidades_por_bulto, 0), 1) ELSE 1 END AS unidades
  ) x
  WHERE c.estado IN ('validado', 'cerrado')
    AND c.tipo_comprobante IN ('FA', 'FB', 'FC', 'Adquisicion', 'ADQ')
    AND d.articulo_id IS NOT NULL AND COALESCE(d.match_estado, '') <> 'no_mercaderia'
    AND (p_articulo_id IS NULL OR d.articulo_id = p_articulo_id)
    AND (p_proveedor_id IS NULL OR c.proveedor_id = p_proveedor_id)
    AND (p_desde IS NULL OR c.fecha_comprobante >= p_desde)
    AND (p_hasta IS NULL OR c.fecha_comprobante <= p_hasta)
  ORDER BY c.fecha_comprobante DESC, c.created_at DESC, d.id
  LIMIT GREATEST(1, LEAST(COALESCE(p_limite, 20), 2000))
$$;

-- ═════════════════════ 3. Notas de crédito / débito esperadas ═════════════════════
-- Las que el proveedor todavía no mandó (estado 'esperada') y, para poder contestar "¿ya está
-- hecha la nota de crédito?", las que YA llegaron en los últimos p_dias_llegadas días (la misma
-- fila pasa a validada con el número real). p_texto busca por palabras en el proveedor, el motivo
-- y los artículos ("cremas dentales colgate"): tienen que aparecer TODAS las palabras.
CREATE OR REPLACE FUNCTION public.jarvis_notas_esperadas(
  p_proveedor_id uuid DEFAULT NULL, p_texto text DEFAULT NULL, p_dias_llegadas int DEFAULT 365
) RETURNS TABLE(nota_id uuid, tipo text, situacion text, motivo text, proveedor_id uuid, proveedor text,
                anotada date, dias integer, total numeric, neto numeric,
                numero_real text, fecha_real date, orden text, factura text, articulos text, unidades numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH notas AS (
    SELECT c.id, c.proveedor_id, c.estado, c.origen_nc, c.tipo_comprobante, c.numero_comprobante, c.fecha_comprobante,
           c.created_at, c.fecha_validacion, c.total_factura_declarado, c.total_neto, c.orden_compra_id, c.comprobante_asociado_id
    FROM comprobantes_compra c
    WHERE (p_proveedor_id IS NULL OR c.proveedor_id = p_proveedor_id)
      AND ( c.estado = 'esperada'
         OR ( c.estado IN ('validado', 'cerrado') AND c.origen_nc IS NOT NULL
              AND c.tipo_comprobante IN ('NC', 'NCA', 'NCB', 'NCC', 'ND', 'NDA', 'NDB', 'NDC')
              AND COALESCE(c.fecha_validacion, c.created_at) >= now() - make_interval(days => GREATEST(COALESCE(p_dias_llegadas, 365), 0)) ) )
  ), arts AS (
    -- de qué artículos es: lo que se resolvió en la recepción y, si los tiene, los renglones de la nota
    SELECT n.id AS nota_id, string_agg(DISTINCT x.txt, '; ') AS articulos, sum(x.unidades) AS unidades
    FROM notas n
    JOIN LATERAL (
      SELECT COALESCE(a.sku || ' ', '') || COALESCE(a.descripcion, rd.descripcion, '(sin artículo)')
             || ' (' || trim(to_char(rd.unidades, 'FM999G999G990D##')) || ' u.)' AS txt, rd.unidades
      FROM recepciones_diferencias rd LEFT JOIN articulos a ON a.id = rd.articulo_id
      WHERE rd.nc_esperada_id = n.id
      UNION ALL
      SELECT COALESCE(a.sku || ' ', '') || COALESCE(a.descripcion, d.descripcion_proveedor, '(sin artículo)')
             || ' (' || trim(to_char(d.cantidad_facturada, 'FM999G999G990D##')) || ')', d.cantidad_facturada
      FROM comprobantes_compra_detalle d LEFT JOIN articulos a ON a.id = d.articulo_id
      WHERE d.comprobante_id = n.id
    ) x ON true
    GROUP BY n.id
  )
  SELECT n.id,
         CASE WHEN n.tipo_comprobante IN ('ND', 'NDA', 'NDB', 'NDC') THEN 'nota de débito' ELSE 'nota de crédito' END,
         CASE WHEN n.estado = 'esperada' THEN 'esperada' ELSE 'llegó' END,
         COALESCE(n.origen_nc, '')::text, n.proveedor_id, pr.nombre::text,
         (n.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date,
         (public.hoy_ar() - (n.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date),
         round(abs(COALESCE(n.total_factura_declarado, 0)), 2), round(abs(COALESCE(n.total_neto, 0)), 2),
         CASE WHEN n.estado <> 'esperada' THEN n.numero_comprobante::text END,
         CASE WHEN n.estado <> 'esperada' THEN n.fecha_comprobante END,
         oc.numero_orden::text,
         (SELECT f.tipo_comprobante || ' ' || f.numero_comprobante FROM comprobantes_compra f WHERE f.id = n.comprobante_asociado_id)::text,
         ar.articulos, ar.unidades
  FROM notas n
  LEFT JOIN proveedores pr ON pr.id = n.proveedor_id
  LEFT JOIN ordenes_compra oc ON oc.id = n.orden_compra_id
  LEFT JOIN arts ar ON ar.nota_id = n.id
  WHERE NULLIF(trim(COALESCE(p_texto, '')), '') IS NULL
     OR NOT EXISTS (
          -- sin acentos y sin el plural: "cremas dentales" encuentra "CREMA DENTAL"
          SELECT 1 FROM regexp_split_to_table(translate(lower(trim(p_texto)), 'áéíóúü', 'aeiouu'), '\s+') w
          WHERE length(w) > 1
            AND translate(lower(COALESCE(pr.nombre, '') || ' ' || COALESCE(n.origen_nc, '') || ' ' || COALESCE(ar.articulos, '')
                      || ' ' || COALESCE(n.numero_comprobante, '') || ' ' || COALESCE(oc.numero_orden, '')), 'áéíóúü', 'aeiouu')
                NOT LIKE '%' || replace(replace(CASE WHEN length(w) > 4 THEN regexp_replace(w, '(es|s)$', '') ELSE w END, '%', ''), '_', '') || '%')
$$;

-- ═════════════════════ 4. Órdenes de compra pendientes de recibir ═════════════════════
-- Lo recibido de una orden = lo contado en sus recepciones FINALIZADAS (sin lo "fuera de orden").
CREATE OR REPLACE FUNCTION public.jarvis_oc_pendientes(p_proveedor_id uuid DEFAULT NULL)
RETURNS TABLE(orden_id uuid, orden text, proveedor_id uuid, proveedor text, estado text, fecha_orden date,
              enviada date, envios integer, enviada_a_prueba date, fecha_estimada date, dias_atraso integer,
              renglones bigint, renglones_pendientes bigint, unidades_pedidas numeric, unidades_recibidas numeric,
              total_estimado numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH pedido AS (
    SELECT d.orden_compra_id, d.articulo_id,
           sum(d.cantidad_pedida * CASE WHEN COALESCE(d.tipo_cantidad, 'bulto') = 'bulto'
                 THEN COALESCE(NULLIF(d.unidades_por_bulto, 0), NULLIF(a.unidades_por_bulto, 0), 1) ELSE 1 END) AS unidades
    FROM ordenes_compra_detalle d LEFT JOIN articulos a ON a.id = d.articulo_id
    GROUP BY 1, 2
  ), recibido AS (
    SELECT r.orden_compra_id, ri.articulo_id,
           sum(COALESCE(ri.cantidad_fisica_base, ri.cantidad_fisica * COALESCE(NULLIF(ri.factor_conteo, 0), 1), 0)) AS unidades
    FROM recepciones r JOIN recepciones_items ri ON ri.recepcion_id = r.id
    WHERE r.estado = 'finalizada' AND NOT COALESCE(ri.fuera_de_oc, false)
    GROUP BY 1, 2
  )
  SELECT o.id, o.numero_orden::text, o.proveedor_id, pr.nombre::text, o.estado::text,
         (o.fecha_orden AT TIME ZONE 'America/Argentina/Buenos_Aires')::date,
         (o.enviada_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date, COALESCE(o.envios, 0),
         (o.prueba_enviada_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date,
         o.fecha_estimada_recepcion,
         CASE WHEN o.fecha_estimada_recepcion < public.hoy_ar() THEN (public.hoy_ar() - o.fecha_estimada_recepcion) END,
         count(pe.articulo_id),
         count(pe.articulo_id) FILTER (WHERE pe.unidades - COALESCE(re.unidades, 0) > 0.0001),
         round(COALESCE(sum(pe.unidades), 0), 2), round(COALESCE(sum(LEAST(COALESCE(re.unidades, 0), pe.unidades)), 0), 2),
         o.total_estimado
  FROM ordenes_compra o
  LEFT JOIN proveedores pr ON pr.id = o.proveedor_id
  LEFT JOIN pedido pe ON pe.orden_compra_id = o.id
  LEFT JOIN recibido re ON re.orden_compra_id = o.id AND re.articulo_id = pe.articulo_id
  WHERE o.estado IN ('pendiente', 'enviada', 'confirmada', 'en_camino', 'recibida_parcial')
    AND (p_proveedor_id IS NULL OR o.proveedor_id = p_proveedor_id)
  GROUP BY o.id, pr.nombre
$$;

-- Qué artículos faltan recibir de las órdenes abiertas (una orden o todas las de un proveedor).
CREATE OR REPLACE FUNCTION public.jarvis_oc_faltantes(p_orden_id uuid DEFAULT NULL, p_proveedor_id uuid DEFAULT NULL)
RETURNS TABLE(orden_id uuid, orden text, proveedor text, articulo_id uuid, sku text, articulo text,
              unidades_pedidas numeric, unidades_recibidas numeric, unidades_pendientes numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH pedido AS (
    SELECT d.orden_compra_id, d.articulo_id,
           sum(d.cantidad_pedida * CASE WHEN COALESCE(d.tipo_cantidad, 'bulto') = 'bulto'
                 THEN COALESCE(NULLIF(d.unidades_por_bulto, 0), NULLIF(a.unidades_por_bulto, 0), 1) ELSE 1 END) AS unidades
    FROM ordenes_compra_detalle d LEFT JOIN articulos a ON a.id = d.articulo_id
    GROUP BY 1, 2
  ), recibido AS (
    SELECT r.orden_compra_id, ri.articulo_id,
           sum(COALESCE(ri.cantidad_fisica_base, ri.cantidad_fisica * COALESCE(NULLIF(ri.factor_conteo, 0), 1), 0)) AS unidades
    FROM recepciones r JOIN recepciones_items ri ON ri.recepcion_id = r.id
    WHERE r.estado = 'finalizada' AND NOT COALESCE(ri.fuera_de_oc, false)
    GROUP BY 1, 2
  )
  SELECT o.id, o.numero_orden::text, pr.nombre::text, pe.articulo_id, a.sku::text, a.descripcion::text,
         round(pe.unidades, 2), round(COALESCE(re.unidades, 0), 2), round(pe.unidades - COALESCE(re.unidades, 0), 2)
  FROM ordenes_compra o
  JOIN pedido pe ON pe.orden_compra_id = o.id
  LEFT JOIN recibido re ON re.orden_compra_id = o.id AND re.articulo_id = pe.articulo_id
  LEFT JOIN articulos a ON a.id = pe.articulo_id
  LEFT JOIN proveedores pr ON pr.id = o.proveedor_id
  WHERE o.estado IN ('pendiente', 'enviada', 'confirmada', 'en_camino', 'recibida_parcial')
    AND (p_orden_id IS NULL OR o.id = p_orden_id)
    AND (p_proveedor_id IS NULL OR o.proveedor_id = p_proveedor_id)
    AND pe.unidades - COALESCE(re.unidades, 0) > 0.0001
$$;

-- ═════════════════════ 5. Diferencias de factura y cumplimiento ═════════════════════
-- Diferencias de precio y de cantidad ya RESUELTAS en la verificación: qué se decidió con cada una.
CREATE OR REPLACE FUNCTION public.jarvis_diferencias_compra(
  p_desde date DEFAULT NULL, p_hasta date DEFAULT NULL, p_proveedor_id uuid DEFAULT NULL, p_orden_id uuid DEFAULT NULL
) RETURNS TABLE(diferencia_id uuid, fecha date, proveedor_id uuid, proveedor text, orden text, factura text,
                articulo_id uuid, sku text, articulo text, tipo text, destino text, unidades numeric,
                importe_neto numeric, importe_total numeric, nota text, descripcion text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT rd.id, (rd.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date, oc.proveedor_id, pr.nombre::text, oc.numero_orden::text,
         (SELECT f.tipo_comprobante || ' ' || f.numero_comprobante FROM comprobantes_compra f WHERE f.id = nt.comprobante_asociado_id)::text,
         rd.articulo_id, a.sku::text, COALESCE(a.descripcion, rd.descripcion)::text, rd.tipo::text, rd.destino::text,
         round(rd.unidades, 2), rd.importe_neto, rd.importe_total,
         CASE WHEN nt.id IS NULL THEN NULL
              WHEN nt.estado = 'esperada' THEN 'esperada desde el ' || to_char(nt.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY')
              ELSE 'llegó: ' || nt.tipo_comprobante || ' ' || nt.numero_comprobante END::text,
         rd.descripcion
  FROM recepciones_diferencias rd
  LEFT JOIN ordenes_compra oc ON oc.id = rd.orden_compra_id
  LEFT JOIN proveedores pr ON pr.id = oc.proveedor_id
  LEFT JOIN articulos a ON a.id = rd.articulo_id
  LEFT JOIN comprobantes_compra nt ON nt.id = rd.nc_esperada_id
  WHERE (p_desde IS NULL OR (rd.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date >= p_desde)
    AND (p_hasta IS NULL OR (rd.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date <= p_hasta)
    AND (p_proveedor_id IS NULL OR oc.proveedor_id = p_proveedor_id)
    AND (p_orden_id IS NULL OR rd.orden_compra_id = p_orden_id)
$$;

-- Cumplimiento por proveedor en un período: cuántas órdenes se recibieron, cuántos renglones, y
-- cuántos tuvieron faltante, sobrante o diferencia de precio (y por cuánta plata).
CREATE OR REPLACE FUNCTION public.jarvis_cumplimiento_proveedores(p_desde date, p_hasta date, p_proveedor_id uuid DEFAULT NULL)
RETURNS TABLE(proveedor_id uuid, proveedor text, ordenes_recibidas bigint, renglones_recibidos bigint,
              faltantes bigint, faltante_importe numeric, sobrantes bigint,
              diferencias_precio bigint, diferencia_precio_importe numeric, renglones_con_problema_pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH rec AS (
    SELECT oc.proveedor_id, count(DISTINCT r.orden_compra_id) AS ordenes, count(ri.id) AS renglones
    FROM recepciones r
    JOIN ordenes_compra oc ON oc.id = r.orden_compra_id
    LEFT JOIN recepciones_items ri ON ri.recepcion_id = r.id AND NOT COALESCE(ri.fuera_de_oc, false)
    WHERE r.estado = 'finalizada'
      AND (COALESCE(r.fecha_fin, r.created_at) AT TIME ZONE 'America/Argentina/Buenos_Aires')::date BETWEEN p_desde AND p_hasta
      AND (p_proveedor_id IS NULL OR oc.proveedor_id = p_proveedor_id)
    GROUP BY 1
  ), dif AS (
    SELECT oc.proveedor_id,
           count(*) FILTER (WHERE rd.tipo = 'cantidad' AND rd.destino NOT IN ('espera_factura', 'bonificado')) AS faltantes,
           sum(rd.importe_total) FILTER (WHERE rd.tipo = 'cantidad' AND rd.destino NOT IN ('espera_factura', 'bonificado')) AS faltante_importe,
           count(*) FILTER (WHERE rd.tipo = 'cantidad' AND rd.destino IN ('espera_factura', 'bonificado')) AS sobrantes,
           count(*) FILTER (WHERE rd.tipo = 'precio') AS precio,
           sum(rd.importe_total) FILTER (WHERE rd.tipo = 'precio') AS precio_importe
    FROM recepciones_diferencias rd JOIN ordenes_compra oc ON oc.id = rd.orden_compra_id
    WHERE (rd.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date BETWEEN p_desde AND p_hasta
      AND (p_proveedor_id IS NULL OR oc.proveedor_id = p_proveedor_id)
    GROUP BY 1
  )
  SELECT p.id, p.nombre::text, COALESCE(rec.ordenes, 0), COALESCE(rec.renglones, 0),
         COALESCE(dif.faltantes, 0), round(COALESCE(dif.faltante_importe, 0), 2), COALESCE(dif.sobrantes, 0),
         COALESCE(dif.precio, 0), round(COALESCE(dif.precio_importe, 0), 2),
         CASE WHEN COALESCE(rec.renglones, 0) > 0
              THEN round(100.0 * (COALESCE(dif.faltantes, 0) + COALESCE(dif.sobrantes, 0) + COALESCE(dif.precio, 0)) / rec.renglones, 1) END
  FROM proveedores p
  LEFT JOIN rec ON rec.proveedor_id = p.id
  LEFT JOIN dif ON dif.proveedor_id = p.id
  WHERE (rec.proveedor_id IS NOT NULL OR dif.proveedor_id IS NOT NULL)
$$;

-- ═════════════════════ 6. Documentos de recepción sin leer (vigía) ═════════════════════
CREATE OR REPLACE FUNCTION public.jarvis_documentos_sin_leer(p_horas int DEFAULT 24)
RETURNS TABLE(documento_id uuid, recepcion_id uuid, orden text, proveedor text, tipo_documento text,
              lectura_estado text, subido timestamptz, horas integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.id, d.recepcion_id, oc.numero_orden::text, pr.nombre::text, d.tipo_documento::text,
         COALESCE(d.lectura_estado, 'no_leido')::text, d.created_at,
         (extract(epoch FROM now() - d.created_at) / 3600)::int
  FROM recepciones_documentos d
  JOIN recepciones r ON r.id = d.recepcion_id
  LEFT JOIN ordenes_compra oc ON oc.id = r.orden_compra_id
  LEFT JOIN proveedores pr ON pr.id = COALESCE(r.proveedor_id, oc.proveedor_id)
  WHERE r.estado <> 'cancelada'
    AND d.created_at < now() - make_interval(hours => GREATEST(COALESCE(p_horas, 24), 0))
    AND ( d.lectura_estado IN ('no_leido', 'pendiente', 'leyendo')
       OR (d.lectura_estado IS NULL AND NOT COALESCE(d.procesado, false) AND COALESCE((d.datos_ocr ->> 'no_leido')::boolean, false)) )
$$;

-- ═════════════════════ 7. IVA compras (crédito fiscal) — reporte de IVA (E-81) ═════════════════════
-- Antes el reporte traía TODOS los renglones a Node, no restaba las notas de crédito y contaba
-- comprobantes sin validar. Ahora la cuenta se hace acá:
--   · solo comprobantes VALIDADOS con IVA discriminado (factura A, nota de débito y de crédito A;
--     una NC/ND sin letra cuenta si la factura a la que está asociada es A, o si trae IVA);
--   · las notas de crédito RESTAN;
--   · el total sale del IVA del ENCABEZADO de cada comprobante (el que se controló al validar);
--     el reparto por alícuota (10,5 % y otras) sale de los renglones, y el 21 % es el resto.
CREATE OR REPLACE FUNCTION public.reporte_iva_compras(p_desde date, p_hasta date)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH comp AS (
    SELECT c.id, CASE WHEN c.tipo_comprobante IN ('NC', 'NCA') THEN -1 ELSE 1 END AS signo,
           abs(COALESCE(c.total_neto, 0)) AS neto, abs(COALESCE(c.total_iva, 0)) AS iva,
           abs(COALESCE(c.percepcion_iva_monto, 0)) AS perc_iva, abs(COALESCE(c.percepcion_iibb_monto, 0)) AS perc_iibb,
           pr.tipo_descuento::text AS tipo_descuento
    FROM comprobantes_compra c
    LEFT JOIN proveedores pr ON pr.id = c.proveedor_id
    LEFT JOIN comprobantes_compra f ON f.id = c.comprobante_asociado_id
    WHERE c.estado IN ('validado', 'cerrado')
      AND c.fecha_comprobante BETWEEN p_desde AND p_hasta
      AND ( c.tipo_comprobante IN ('FA', 'NDA', 'NCA')
         OR ( c.tipo_comprobante IN ('NC', 'ND')
              AND (f.tipo_comprobante = 'FA' OR (f.id IS NULL AND COALESCE(c.total_iva, 0) <> 0)) ) )
  ), por_alicuota AS (
    SELECT k.id,
           sum(l.neto * l.alic / 100.0) FILTER (WHERE l.alic = 10.5) AS iva_105,
           sum(l.neto * l.alic / 100.0) FILTER (WHERE l.alic NOT IN (21, 10.5) AND l.alic > 0) AS iva_otras
    FROM comp k
    JOIN LATERAL (
      SELECT COALESCE(d.cantidad_facturada, 0)
             * public.oc_neto_unitario(d.precio_unitario, d.descuento1, d.descuento2, d.descuento3, d.descuento4, k.tipo_descuento) AS neto,
             COALESCE(d.iva_porcentaje, 0) AS alic
      FROM comprobantes_compra_detalle d WHERE d.comprobante_id = k.id
    ) l ON true
    GROUP BY k.id
  ), t AS (
    SELECT COALESCE(sum(k.signo * k.neto), 0) AS base, COALESCE(sum(k.signo * k.iva), 0) AS iva,
           COALESCE(sum(k.signo * LEAST(COALESCE(a.iva_105, 0), k.iva)), 0) AS iva_105,
           COALESCE(sum(k.signo * LEAST(COALESCE(a.iva_otras, 0), GREATEST(k.iva - COALESCE(a.iva_105, 0), 0))), 0) AS iva_otras,
           COALESCE(sum(k.signo * k.perc_iva), 0) AS perc_iva, COALESCE(sum(k.signo * k.perc_iibb), 0) AS perc_iibb,
           count(*) AS comprobantes, count(*) FILTER (WHERE k.signo < 0) AS notas_credito
    FROM comp k LEFT JOIN por_alicuota a ON a.id = k.id
  )
  SELECT jsonb_build_object(
    'base_imponible', round(t.base, 2),
    'iva_21', round(t.iva - t.iva_105 - t.iva_otras, 2),
    'iva_10_5', round(t.iva_105, 2),
    'iva_otras', round(t.iva_otras, 2),
    'total_credito', round(t.iva, 2),
    'percepciones_iva', round(t.perc_iva, 2),
    'percepciones_iibb', round(t.perc_iibb, 2),
    'comprobantes', t.comprobantes,
    'notas_credito', t.notas_credito)
  FROM t
$$;

-- ═════════════════════ Permisos: solo el servidor ═════════════════════
DO $perm$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'jarvis_cc_abiertos(uuid)', 'jarvis_vencimientos_a_mano(uuid)', 'jarvis_cc_proveedores(uuid)',
    'jarvis_proveedores_resumen(uuid)',
    'jarvis_compras(date, date, text, uuid, uuid)', 'jarvis_compras_proveedor_mes(date, date, uuid)',
    'jarvis_compras_renglones(uuid, uuid, date, date, int)',
    'jarvis_notas_esperadas(uuid, text, int)',
    'jarvis_oc_pendientes(uuid)', 'jarvis_oc_faltantes(uuid, uuid)',
    'jarvis_diferencias_compra(date, date, uuid, uuid)', 'jarvis_cumplimiento_proveedores(date, date, uuid)',
    'jarvis_documentos_sin_leer(int)', 'reporte_iva_compras(date, date)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $perm$;
REVOKE ALL ON TABLE public.ia_fallas FROM anon, authenticated;
GRANT ALL ON TABLE public.ia_fallas TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ia_fallas_id_seq TO service_role;

-- Comprobaciones (solo lectura), después de aplicar:
--   select * from public.jarvis_cc_proveedores() order by deuda_total desc limit 20;
--   select * from public.jarvis_compras(public.hoy_ar() - 365, public.hoy_ar(), 'canal');
--   select * from public.jarvis_notas_esperadas(null, null) order by dias desc limit 20;
--   select * from public.jarvis_oc_pendientes() order by fecha_orden;
--   select public.reporte_iva_compras(date_trunc('month', public.hoy_ar())::date, public.hoy_ar());
