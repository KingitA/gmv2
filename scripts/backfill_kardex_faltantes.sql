-- =============================================================================
-- Backfill kardex para pedidos faltantes (000365 en adelante)
-- Inserta en kardex y comisiones para pedidos activos sin entradas.
-- Idempotente: el NOT EXISTS previene duplicados.
-- Aplicar en Supabase SQL Editor.
-- =============================================================================

BEGIN;

-- 1. Insertar filas en kardex
-- -----------------------------------------------------------------------------
INSERT INTO kardex (
  fecha,
  tipo_movimiento,
  signo,
  articulo_id,
  articulo_sku,
  articulo_descripcion,
  articulo_categoria,
  articulo_marca_id,
  articulo_proveedor_id,
  articulo_iva_compras,
  articulo_iva_ventas,
  cantidad,
  cliente_id,
  vendedor_id,
  proveedor_id,
  precio_costo,
  precio_lista,
  precio_unitario_final,
  iva_porcentaje,
  iva_monto_unitario,
  iva_incluido,
  subtotal_neto,
  subtotal_iva,
  subtotal_total,
  margen_unitario,
  margen_porcentaje,
  metodo_facturacion,
  color_dinero,
  descuento_mercaderia_pct,
  descuento_general_pct,
  descuento_cliente_pct,
  comision_viajante_pct,
  comision_viajante_monto,
  pedido_id,
  numero_pedido,
  lista_precio_id,
  provincia_destino,
  stock_antes,
  stock_despues
)
SELECT
  -- fecha del pedido como timestamptz
  p.fecha::timestamptz + INTERVAL '10 hours',   -- aprox 10hs AM Argentina
  'venta',
  -1,

  -- artículo denormalizado
  d.articulo_id,
  a.sku,
  a.descripcion,
  a.categoria,
  a.marca_id,
  a.proveedor_id,
  a.iva_compras,
  a.iva_ventas,

  d.cantidad,

  -- actores
  p.cliente_id,
  p.vendedor_id,
  a.proveedor_id,

  -- precios
  d.precio_costo,
  -- precio_lista: precio de lista pre-descuento-cliente (pedidos_detalle guarda el neto post-dto)
  -- como aproximación usamos precio_base que es el precio neto final al cliente
  d.precio_base                                                  AS precio_lista,
  d.precio_final                                                 AS precio_unitario_final,

  -- IVA
  CASE
    WHEN d.precio_base > 0 AND d.precio_final > d.precio_base
      THEN ROUND(((d.precio_final - d.precio_base) / d.precio_base) * 100, 2)
    ELSE 0
  END                                                            AS iva_porcentaje,
  CASE
    WHEN d.precio_final > d.precio_base
      THEN ROUND(d.precio_final - d.precio_base, 4)
    ELSE 0
  END                                                            AS iva_monto_unitario,
  (d.precio_final = d.precio_base)                              AS iva_incluido,

  -- subtotales
  ROUND(d.precio_base  * d.cantidad, 2)                         AS subtotal_neto,
  ROUND((d.precio_final - d.precio_base) * d.cantidad, 2)       AS subtotal_iva,
  d.subtotal                                                     AS subtotal_total,

  -- margen
  CASE
    WHEN d.precio_costo > 0
      THEN ROUND(d.precio_base - d.precio_costo, 4)
    ELSE NULL
  END                                                            AS margen_unitario,
  CASE
    WHEN d.precio_costo > 0 AND d.precio_base > 0
      THEN ROUND(((d.precio_base - d.precio_costo) / d.precio_base) * 100, 2)
    ELSE NULL
  END                                                            AS margen_porcentaje,

  -- comprobante / color dinero
  COALESCE(d.metodo_facturacion_item, p.metodo_facturacion_pedido)  AS metodo_facturacion,
  CASE
    WHEN COALESCE(d.metodo_facturacion_item, p.metodo_facturacion_pedido)
         IN ('Factura', 'Factura (21% IVA)')
      THEN 'BLANCO'
    ELSE 'NEGRO'
  END                                                            AS color_dinero,

  -- descuentos (sin datos históricos precisos → NULL; el backfill de descuentos
  --            ya poblará si hay descuentos_json disponible)
  NULL                                                           AS descuento_mercaderia_pct,
  NULL                                                           AS descuento_general_pct,
  0                                                              AS descuento_cliente_pct,

  -- comisión del viajante
  CASE
    WHEN p.vendedor_id IS NOT NULL AND a.segmento_precio IS NOT NULL THEN
      CASE
        WHEN a.segmento_precio = 'limpieza_bazar'
          THEN COALESCE(v.comision_limpieza_bazar, 0)
        WHEN a.segmento_precio = 'perfumeria' AND a.iva_ventas = 'factura'
          THEN COALESCE(v.comision_perfumeria_plus, 0)
        WHEN a.segmento_precio = 'perfumeria'
          THEN COALESCE(v.comision_perfumeria_0, 0)
        ELSE 0
      END
    ELSE 0
  END                                                            AS comision_viajante_pct,

  -- monto comisión: pct/100 × precioNeto × cantidad
  CASE
    WHEN p.vendedor_id IS NOT NULL AND a.segmento_precio IS NOT NULL THEN
      ROUND(
        d.precio_base * d.cantidad *
        CASE
          WHEN a.segmento_precio = 'limpieza_bazar'
            THEN COALESCE(v.comision_limpieza_bazar, 0)
          WHEN a.segmento_precio = 'perfumeria' AND a.iva_ventas = 'factura'
            THEN COALESCE(v.comision_perfumeria_plus, 0)
          WHEN a.segmento_precio = 'perfumeria'
            THEN COALESCE(v.comision_perfumeria_0, 0)
          ELSE 0
        END / 100,
      2)
    ELSE 0
  END                                                            AS comision_viajante_monto,

  -- referencias
  p.id                                                           AS pedido_id,
  p.numero_pedido,
  d.lista_precio_id,
  c.provincia                                                    AS provincia_destino,

  -- stock (sin datos históricos)
  NULL,
  NULL

FROM pedidos p
JOIN pedidos_detalle d ON d.pedido_id = p.id
JOIN articulos a ON a.id = d.articulo_id
JOIN clientes c ON c.id = p.cliente_id
LEFT JOIN vendedores v ON v.id = p.vendedor_id
WHERE p.eliminado_at IS NULL
  AND d.es_bonificado IS NOT TRUE   -- los bonificados van a $0, podrían distorsionar
  AND NOT EXISTS (
    SELECT 1 FROM kardex k WHERE k.pedido_id = p.id
  )
ORDER BY p.fecha, p.numero_pedido, d.id;


-- 2. Insertar comisiones para TODOS los kardex de tipo venta que tengan
--    comisión > 0 y no tengan registro en comisiones todavía.
--    Idempotente: el NOT EXISTS previene duplicados.
-- -----------------------------------------------------------------------------
INSERT INTO comisiones (
  kardex_id,
  viajante_id,
  pedido_id,
  monto,
  porcentaje,
  pagado,
  comprobante_cobrado,
  tipo,
  articulo_id,
  cantidad,
  precio_neto_unitario
)
SELECT
  k.id                          AS kardex_id,
  k.vendedor_id                 AS viajante_id,
  k.pedido_id,
  k.comision_viajante_monto     AS monto,
  k.comision_viajante_pct       AS porcentaje,
  false                         AS pagado,
  false                         AS comprobante_cobrado,
  'vendida'                     AS tipo,
  k.articulo_id,
  k.cantidad,
  k.precio_lista                AS precio_neto_unitario
FROM kardex k
WHERE k.tipo_movimiento = 'venta'
  AND k.comision_viajante_monto IS NOT NULL
  AND k.comision_viajante_monto > 0
  AND k.vendedor_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM comisiones c WHERE c.kardex_id = k.id
  );


-- 3. Verificación
-- -----------------------------------------------------------------------------
SELECT
  COUNT(*) FILTER (WHERE tipo_movimiento = 'venta') AS kardex_ventas_total,
  COUNT(DISTINCT pedido_id) FILTER (WHERE tipo_movimiento = 'venta') AS pedidos_con_kardex
FROM kardex;

SELECT COUNT(*) AS comisiones_total FROM comisiones WHERE tipo = 'vendida';

COMMIT;
