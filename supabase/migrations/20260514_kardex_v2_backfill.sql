-- =============================================================================
-- Backfill histórico: Kardex V2
-- Vincula datos existentes de comisiones, recepciones y ordenes_compra
-- al kardex. Idempotente: solo actualiza columnas que estén en NULL.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Comisión viajante en kardex  ← desde comisiones (tipo='vendida')
--    Match por pedido_id + articulo_id
-- -----------------------------------------------------------------------------
UPDATE kardex k
SET
  comision_viajante_pct   = c.porcentaje,
  comision_viajante_monto = c.monto,
  -- Si kardex no tenía vendedor_id (backfill histórico), tomarlo de comisiones
  vendedor_id = COALESCE(k.vendedor_id, c.viajante_id)
FROM comisiones c
WHERE c.tipo = 'vendida'
  AND c.pedido_id    IS NOT NULL
  AND c.articulo_id  IS NOT NULL
  AND c.pedido_id    = k.pedido_id
  AND c.articulo_id  = k.articulo_id
  AND k.tipo_movimiento = 'venta'
  AND k.comision_viajante_monto IS NULL
  AND c.monto > 0;

-- -----------------------------------------------------------------------------
-- 2. Vincular comisiones históricas al kardex (kardex_id en comisiones)
--    Necesario para que el flag pagado sea consultable desde el nuevo playroom
-- -----------------------------------------------------------------------------
UPDATE comisiones c
SET kardex_id = k.id
FROM kardex k
WHERE c.tipo        = 'vendida'
  AND c.pedido_id   IS NOT NULL
  AND c.articulo_id IS NOT NULL
  AND c.pedido_id   = k.pedido_id
  AND c.articulo_id = k.articulo_id
  AND k.tipo_movimiento = 'venta'
  AND c.kardex_id IS NULL;

-- -----------------------------------------------------------------------------
-- 3. comprobante_cobrado en kardex  ← desde comisiones (tipo='cobrada')
--    Match por comprobante_venta_id
-- -----------------------------------------------------------------------------
UPDATE kardex k
SET
  comprobante_cobrado          = true,
  fecha_comprobante_cobrado    = sub.fecha_cobrado
FROM (
  SELECT DISTINCT ON (comprobante_venta_id)
    comprobante_venta_id,
    fecha_comprobante_cobrado AS fecha_cobrado
  FROM comisiones
  WHERE tipo = 'cobrada'
    AND comprobante_cobrado = true
    AND comprobante_venta_id IS NOT NULL
  ORDER BY comprobante_venta_id, fecha_comprobante_cobrado DESC NULLS LAST
) sub
WHERE k.comprobante_venta_id = sub.comprobante_venta_id
  AND k.tipo_movimiento = 'venta'
  AND (k.comprobante_cobrado IS NULL OR k.comprobante_cobrado = false);

-- -----------------------------------------------------------------------------
-- 4. Descuentos de proveedor en kardex  ← desde recepciones_items
--    Requiere haber corrido 20260514_recepciones_items_descuentos.sql primero.
--    Datos históricos = 0 (DEFAULT), solo tiene efecto en recepciones futuras.
-- -----------------------------------------------------------------------------
UPDATE kardex k
SET
  descuento_proveedor_pct            = NULLIF(ri.descuento_pct, 0),
  descuento_proveedor_financiero_pct = NULLIF(ri.descuento_financiero_pct, 0),
  descuento_proveedor_comercial_pct  = NULLIF(ri.descuento_comercial_pct, 0)
FROM recepciones_items ri
WHERE k.recepcion_id  = ri.recepcion_id
  AND k.articulo_id   = ri.articulo_id
  AND k.tipo_movimiento = 'compra'
  AND k.descuento_proveedor_pct IS NULL
  AND (ri.descuento_pct > 0 OR ri.descuento_financiero_pct > 0 OR ri.descuento_comercial_pct > 0);

-- -----------------------------------------------------------------------------
-- 5. comprador_id en kardex  ← desde ordenes_compra.creado_por
--    Match por orden_compra_id
-- -----------------------------------------------------------------------------
UPDATE kardex k
SET comprador_id = oc.creado_por
FROM ordenes_compra oc
WHERE k.orden_compra_id = oc.id
  AND k.comprador_id IS NULL
  AND oc.creado_por IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 6. receptor_id en kardex  ← desde recepciones.actualizado_por
--    (quien finalizó la recepción = receptor). Match por recepcion_id
-- -----------------------------------------------------------------------------
UPDATE kardex k
SET receptor_id = r.actualizado_por
FROM recepciones r
WHERE k.recepcion_id = r.id
  AND k.receptor_id IS NULL
  AND r.actualizado_por IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 7. Resumen: cuántas filas quedaron actualizadas por bloque
-- -----------------------------------------------------------------------------
SELECT
  'kardex con comision_viajante_monto'   AS metrica,
  COUNT(*) FILTER (WHERE comision_viajante_monto IS NOT NULL AND comision_viajante_monto > 0) AS con_dato,
  COUNT(*) FILTER (WHERE comision_viajante_monto IS NULL) AS sin_dato,
  COUNT(*) AS total
FROM kardex WHERE tipo_movimiento = 'venta'

UNION ALL

SELECT
  'comisiones con kardex_id vinculado',
  COUNT(*) FILTER (WHERE kardex_id IS NOT NULL),
  COUNT(*) FILTER (WHERE kardex_id IS NULL),
  COUNT(*)
FROM comisiones WHERE tipo = 'vendida'

UNION ALL

SELECT
  'kardex compras con descuento_proveedor_pct',
  COUNT(*) FILTER (WHERE descuento_proveedor_pct IS NOT NULL),
  COUNT(*) FILTER (WHERE descuento_proveedor_pct IS NULL),
  COUNT(*)
FROM kardex WHERE tipo_movimiento = 'compra'

UNION ALL

SELECT
  'kardex con comprador_id',
  COUNT(*) FILTER (WHERE comprador_id IS NOT NULL),
  COUNT(*) FILTER (WHERE comprador_id IS NULL),
  COUNT(*)
FROM kardex WHERE tipo_movimiento = 'compra';
