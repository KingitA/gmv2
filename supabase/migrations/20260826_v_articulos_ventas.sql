-- Ranking de ventas por artículo para "ordenar por ventas" en la app del
-- vendedor. Unidades y pedidos de los últimos 180 días (pedidos no
-- eliminados, líneas no bonificadas). Vista simple: se recalcula al vuelo,
-- el API la lee entera una vez por sesión (≈ tamaño del catálogo).
CREATE OR REPLACE VIEW v_articulos_ventas AS
SELECT
  d.articulo_id,
  SUM(d.cantidad)::numeric            AS unidades_180d,
  COUNT(DISTINCT d.pedido_id)::int    AS pedidos_180d
FROM pedidos_detalle d
JOIN pedidos p ON p.id = d.pedido_id
WHERE p.estado <> 'eliminado'
  AND p.eliminado_at IS NULL
  AND p.fecha >= CURRENT_DATE - INTERVAL '180 days'
  AND COALESCE(d.es_bonificado, false) = false
  AND d.articulo_id IS NOT NULL
GROUP BY d.articulo_id;

GRANT SELECT ON v_articulos_ventas TO authenticated;
