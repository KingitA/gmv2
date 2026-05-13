-- ============================================================
-- Backfill histórico: poblar columnas individuales de descuento
-- en kardex a partir de datos ya existentes.
--
-- Ejecutar en Supabase SQL Editor (admin).
-- Es idempotente: usa WHERE columna IS NULL o chequea valores.
-- ============================================================

-- ─── PARTE 1: precio_lista + descuentos mercadería/general/viajante ──────────
-- Fuente: descuentos_json + precio_unitario_bruto
-- Solo actualiza filas con descuentos_json no vacío.

WITH extracted AS (
  SELECT
    id,
    precio_unitario_bruto,

    -- descuento mercadería (tipo='oferta')
    (SELECT (elem->>'porcentaje')::numeric
     FROM jsonb_array_elements(descuentos_json) elem
     WHERE elem->>'tipo' = 'oferta' LIMIT 1)                          AS merc_pct,
    (SELECT (elem->>'monto_unitario')::numeric
     FROM jsonb_array_elements(descuentos_json) elem
     WHERE elem->>'tipo' = 'oferta' LIMIT 1)                          AS merc_monto,

    -- descuento general / cliente (tipo='general')
    (SELECT (elem->>'porcentaje')::numeric
     FROM jsonb_array_elements(descuentos_json) elem
     WHERE elem->>'tipo' = 'general' LIMIT 1)                         AS gen_pct,
    (SELECT (elem->>'monto_unitario')::numeric
     FROM jsonb_array_elements(descuentos_json) elem
     WHERE elem->>'tipo' = 'general' LIMIT 1)                         AS gen_monto,

    -- descuento viajante (tipo='viajante')
    (SELECT (elem->>'porcentaje')::numeric
     FROM jsonb_array_elements(descuentos_json) elem
     WHERE elem->>'tipo' = 'viajante' LIMIT 1)                        AS viaj_pct,
    (SELECT (elem->>'monto_unitario')::numeric
     FROM jsonb_array_elements(descuentos_json) elem
     WHERE elem->>'tipo' = 'viajante' LIMIT 1)                        AS viaj_monto

  FROM kardex
  WHERE tipo_movimiento IN ('venta', 'nota_credito_venta')
    AND descuentos_json IS NOT NULL
    AND jsonb_array_length(descuentos_json) > 0
    AND precio_lista IS NULL   -- solo rows sin backfill previo
)
UPDATE kardex k
SET
  -- precio_lista = precio_unitario_bruto descontado el dto mercadería
  precio_lista = CASE
    WHEN e.merc_pct IS NOT NULL AND e.merc_pct > 0
      THEN round(e.precio_unitario_bruto * (1 - e.merc_pct / 100), 4)
    ELSE e.precio_unitario_bruto
  END,

  descuento_mercaderia_pct    = NULLIF(e.merc_pct,   0),
  descuento_mercaderia_monto  = NULLIF(e.merc_monto, 0),
  descuento_general_pct       = NULLIF(e.gen_pct,    0),
  descuento_general_monto     = NULLIF(e.gen_monto,  0),
  descuento_viajante_pct      = NULLIF(e.viaj_pct,   0),
  descuento_viajante_monto    = NULLIF(e.viaj_monto, 0)
FROM extracted e
WHERE k.id = e.id;


-- ─── PARTE 2: precio_lista para filas sin descuentos ─────────────────────────
-- Si no hay descuentos, precio_lista = precio_unitario_bruto.

UPDATE kardex
SET precio_lista = precio_unitario_bruto
WHERE tipo_movimiento IN ('venta', 'nota_credito_venta')
  AND precio_lista IS NULL
  AND precio_unitario_bruto IS NOT NULL;


-- ─── PARTE 3: descuento financiero (10% pago contado) ────────────────────────
-- Fuente: comprobantes que tienen una NC/REV con artículo SKU 11115 en el mismo pago.
--
-- Cadena: pago → imputaciones → NC/REV con detalle artículo 11115
--                             → mismas imputaciones → FA/FB/FC/PRES originales
--                             → kardex de esos comprobantes

WITH bonif_articulo AS (
  -- ID del artículo de bonificación (SKU 11115)
  SELECT id FROM articulos WHERE sku = '11115' LIMIT 1
),
nc_con_bonif AS (
  -- NC/REV que contienen el artículo de bonificación
  SELECT DISTINCT cvd.comprobante_id
  FROM comprobantes_venta_detalle cvd
  JOIN bonif_articulo ba ON ba.id = cvd.articulo_id
  JOIN comprobantes_venta cv ON cv.id = cvd.comprobante_id
  WHERE cv.tipo_comprobante IN ('NCA', 'NCB', 'NCC', 'REV')
),
pagos_con_bonif AS (
  -- Pagos que tienen una NC de bonificación imputada
  SELECT DISTINCT i.pago_id
  FROM imputaciones i
  JOIN nc_con_bonif nc ON nc.comprobante_id = i.comprobante_id
),
comprobantes_bonificados AS (
  -- Comprobantes originales (FA/FB/FC/PRES) del mismo pago
  SELECT DISTINCT i.comprobante_id
  FROM imputaciones i
  JOIN pagos_con_bonif p ON p.pago_id = i.pago_id
  JOIN comprobantes_venta cv ON cv.id = i.comprobante_id
  WHERE cv.tipo_comprobante IN ('FA', 'FB', 'FC', 'PRES')
)
UPDATE kardex k
SET
  descuento_financiero_pct   = 10,
  descuento_financiero_monto = round(k.precio_unitario_neto * 0.10, 4)
FROM comprobantes_bonificados cb
WHERE k.comprobante_venta_id = cb.comprobante_id
  AND k.tipo_movimiento = 'venta'
  AND k.descuento_financiero_pct IS NULL;  -- idempotente


-- ─── Verificación (ejecutar por separado para revisar) ────────────────────────
/*
SELECT
  COUNT(*)                                              AS total_ventas,
  COUNT(*) FILTER (WHERE precio_lista IS NOT NULL)      AS con_precio_lista,
  COUNT(*) FILTER (WHERE descuento_mercaderia_pct > 0)  AS con_dto_mercaderia,
  COUNT(*) FILTER (WHERE descuento_general_pct > 0)     AS con_dto_general,
  COUNT(*) FILTER (WHERE descuento_viajante_pct > 0)    AS con_dto_viajante,
  COUNT(*) FILTER (WHERE descuento_financiero_pct > 0)  AS con_dto_financiero
FROM kardex
WHERE tipo_movimiento = 'venta';
*/
