-- ÍNDICES PARA LAS CONSULTAS LENTAS (24/11/2026)
--
-- CORRER SOLO, NO JUNTO CON OTRO SQL: CREATE INDEX CONCURRENTLY no puede ir dentro de
-- una transacción. En el editor de Supabase pegar y ejecutar ESTE archivo solo; si
-- protesta por la transacción, ejecutar cada CREATE INDEX por separado.
-- CONCURRENTLY = no bloquea las escrituras mientras se arma (tarda un poco más).
--
-- NO APLICADA. Idempotente (IF NOT EXISTS).

-- 1. Comisiones del vendedor (/api/vendedor/comisiones y la sync de billetera):
--    las ventas con comisión de un vendedor, recorridas por id. Hoy la base hace un
--    bitmap sobre todo el kardex del vendedor y ordena en disco (hasta 4,4 s por página).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_kardex_comision_vendedor
  ON public.kardex (vendedor_id, id)
  WHERE tipo_movimiento = 'venta'
    AND comision_viajante_monto IS NOT NULL
    AND comision_viajante_monto <> 0
    AND pedido_eliminado = false;

-- 2. Pedidos por vendedor (sync de pedidos, estadísticas, filtros por vendedor):
--    pedidos no tiene índice por vendedor_id.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pedidos_vendedor_fecha
  ON public.pedidos (vendedor_id, fecha DESC);

-- 3. Log de la sync por cambios (20261124a): el motor busca por tabla y seq; ya existe
--    idx_mobile_cambios_tabla_seq, no hace falta otro.

-- Verificación: 2 filas, indisvalid = true (si sale false, borrar y volver a crear)
SELECT c.relname AS indice, i.indisvalid
FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
WHERE c.relname IN ('idx_kardex_comision_vendedor', 'idx_pedidos_vendedor_fecha');
