-- ═════════════════════════════════════════════════════════════════════════════
-- CONTROL (SOLO LECTURA — no cambia nada) · Prueba integral de ENTRADA, E-52
--
-- Comprobantes de compra cuyo saldo propio (comprobantes_compra.saldo_pendiente)
-- bajó SIN que haya una imputación equivalente en la cuenta corriente del
-- proveedor (imputaciones_proveedores). Es la huella del problema E-52: una
-- orden de pago imputada por el vencimiento bajaba el saldo del comprobante
-- pero no la factura en la cuenta corriente, que quedaba "pagable otra vez".
--
-- Cómo leer cada fila:
--   saldo_segun_cc           = lo que la cuenta corriente dice que se debe
--   saldo_segun_comprobante  = lo que el comprobante dice que se debe
--   diferencia               = pagado según el comprobante que la CC no registra
--   ordenes_de_pago          = las OP que tocaron ese comprobante (y su estado)
--
-- Ojo: si saldo_segun_comprobante es 0, estado_pago no es 'pagado' y no hay
-- ninguna orden de pago, puede ser un comprobante que nunca llevó saldo propio
-- (no es un pago perdido). Las filas con una OP 'pagada' son las que importan.
--
-- Resultado esperado hoy (16/11/2026): ninguna fila con OP pagada (hay una sola
-- OP en la base y está pendiente).
-- ═════════════════════════════════════════════════════════════════════════════
SELECT
  p.nombre                                                        AS proveedor,
  c.tipo_comprobante,
  c.numero_comprobante,
  c.fecha_comprobante,
  cc.monto                                                        AS monto_en_cc,
  COALESCE(i.imputado, 0)                                         AS imputado_en_cc,
  round(cc.monto - COALESCE(i.imputado, 0), 2)                    AS saldo_segun_cc,
  COALESCE(c.saldo_pendiente, 0)                                  AS saldo_segun_comprobante,
  round(cc.monto - COALESCE(i.imputado, 0) - COALESCE(c.saldo_pendiente, 0), 2) AS diferencia,
  c.estado_pago,
  (
    SELECT string_agg(DISTINCT o.numero_op || ' (' || o.estado || ')', ', ')
    FROM ordenes_pago_imputaciones oi
    JOIN ordenes_pago o ON o.id = oi.orden_pago_id
    LEFT JOIN vencimientos v ON v.id = oi.vencimiento_id
    WHERE oi.comprobante_compra_id = c.id
       OR oi.movimiento_cc_id = cc.id
       OR (v.referencia_tipo = 'cuenta_corriente'   AND v.referencia_id = cc.id)
       OR (v.referencia_tipo = 'comprobante_compra' AND v.referencia_id = c.id)
  )                                                               AS ordenes_de_pago
FROM comprobantes_compra c
JOIN cuenta_corriente_proveedores cc
  ON cc.referencia_tipo = 'comprobante_compra' AND cc.referencia_id = c.id AND cc.monto > 0
LEFT JOIN proveedores p ON p.id = c.proveedor_id
LEFT JOIN LATERAL (
  SELECT sum(ip.monto_imputado) AS imputado
  FROM imputaciones_proveedores ip
  WHERE ip.id_movimiento_documento = cc.id
) i ON true
WHERE round(cc.monto - COALESCE(i.imputado, 0), 2) > COALESCE(c.saldo_pendiente, 0) + 0.01
ORDER BY p.nombre, c.fecha_comprobante, c.numero_comprobante;
