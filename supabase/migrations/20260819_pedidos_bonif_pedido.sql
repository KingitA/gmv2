-- Bonificaciones "solo este pedido" por SEGMENTO y TIPO (app vendedor, panel 👤).
-- pedidos.bonif_pedido jsonb:
--   { "viajante":   { "limpieza_bazar": 10, "perf0": 5, "perf_plus": 0 },
--     "mercaderia": { "limpieza_bazar": 3 } }
-- Cada tipo presente pisa la ficha del cliente (tabla bonificaciones) para los
-- segmentos que defina; los que no defina heredan. NULL = hereda todo.
-- Reemplaza a pedidos.bonif_viajante_pedido_pct (un solo % para todo), que se
-- migra y se elimina si existía. pedidos.bonif_mercaderia_pct (ERP, % general
-- de mercadería del pedido) se mantiene: bonif_pedido.mercaderia lo refina
-- por segmento (misma relación que lista_precio_pedido_id ↔ lista_*_pedido_id).

ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS bonif_pedido jsonb;

COMMENT ON COLUMN pedidos.bonif_pedido IS
  'Override de bonificaciones solo para este pedido: {viajante:{seg:%}, mercaderia:{seg:%}}. NULL = hereda de la ficha.';

-- Migrar el % único anterior (si la columna existe) a los tres segmentos
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pedidos' AND column_name = 'bonif_viajante_pedido_pct'
  ) THEN
    UPDATE pedidos
       SET bonif_pedido = jsonb_build_object(
             'viajante', jsonb_build_object(
               'limpieza_bazar', bonif_viajante_pedido_pct,
               'perf0',          bonif_viajante_pedido_pct,
               'perf_plus',      bonif_viajante_pedido_pct))
     WHERE bonif_viajante_pedido_pct IS NOT NULL
       AND bonif_pedido IS NULL;
    ALTER TABLE pedidos DROP COLUMN bonif_viajante_pedido_pct;
  END IF;
END $$;
