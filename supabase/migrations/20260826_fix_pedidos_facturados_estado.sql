-- ─────────────────────────────────────────────────────────────────────────────
-- Corrección de datos (una sola vez): pedidos con comprobante VIGENTE que
-- quedaron en estado "impreso" porque el pase a "facturado" lo hacía el
-- navegador en un segundo paso que no siempre llegaba.
-- Detectados el 26/08/2026: 001236, 001126, 000907, 000864, 000572, 000569.
-- Desde el commit que acompaña esta migración, el estado lo pone el servidor
-- al emitir el comprobante (app/api/comprobantes-venta/generar/route.ts).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Ver qué se va a tocar (revisar antes de aplicar el paso 2)
SELECT p.numero_pedido, p.estado, p.fecha,
       string_agg(cv.tipo_comprobante || ' ' || cv.numero_comprobante, ', ' ORDER BY cv.fecha) AS comprobantes
FROM pedidos p
JOIN comprobantes_venta cv ON cv.pedido_id = p.id AND cv.anulado_en IS NULL
WHERE p.estado IN ('en_venta', 'pendiente', 'impreso', 'en_preparacion', 'pendiente_facturacion')
GROUP BY p.id
ORDER BY p.fecha DESC;

-- 2) Aplicar: pasar a "facturado" todo pedido con comprobante vigente que siga en un estado previo
UPDATE pedidos p
SET estado = 'facturado'
WHERE p.estado IN ('en_venta', 'pendiente', 'impreso', 'en_preparacion', 'pendiente_facturacion')
  AND EXISTS (
    SELECT 1 FROM comprobantes_venta cv
    WHERE cv.pedido_id = p.id AND cv.anulado_en IS NULL
  );
