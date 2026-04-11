-- Elimina las combinaciones de IVA que no se van a usar.
-- Quedan solo 5 filas:
--   LIMPIEZA_BAZAR  factura            factura       (+ +)
--   LIMPIEZA_BAZAR  adquisicion_stock  presupuesto   (0 0)
--   LIMPIEZA_BAZAR  mixto              presupuesto   (½ 0)
--   PERFUMERIA      factura            factura       (+ +)
--   PERFUMERIA      adquisicion_stock  presupuesto   (0 0)

DELETE FROM listas_precio_reglas
WHERE
  (grupo_precio = 'LIMPIEZA_BAZAR' AND iva_compras = 'factura'           AND iva_ventas = 'presupuesto') OR
  (grupo_precio = 'LIMPIEZA_BAZAR' AND iva_compras = 'adquisicion_stock' AND iva_ventas = 'factura'    ) OR
  (grupo_precio = 'LIMPIEZA_BAZAR' AND iva_compras = 'mixto'             AND iva_ventas = 'factura'    ) OR
  (grupo_precio = 'PERFUMERIA'     AND iva_compras = 'factura'           AND iva_ventas = 'presupuesto') OR
  (grupo_precio = 'PERFUMERIA'     AND iva_compras = 'adquisicion_stock' AND iva_ventas = 'factura'    ) OR
  (grupo_precio = 'PERFUMERIA'     AND iva_compras = 'mixto'             AND iva_ventas = 'factura'    ) OR
  (grupo_precio = 'PERFUMERIA'     AND iva_compras = 'mixto'             AND iva_ventas = 'presupuesto');
