-- ═══════════════════════════════════════════════════════════════════════
-- VENTAS POR ARTÍCULO: SE CALCULAN DE NOCHE, NO EN CADA PEDIDO
-- (P2-49 · base saturada a ratos, 29/10/2026)
--
-- Qué pasaba: v_articulos_ventas (unidades vendidas en 180 días, para "ordenar
-- por ventas" en la app vendedor) recorría TODOS los renglones de pedidos
-- (82.000) cada vez que alguien la pedía: en cada sincronización de cada equipo.
-- La tabla pedidos_detalle llevaba 62.000 lecturas completas. Con varios equipos
-- rebajando el catálogo a la vez la base no daba abasto (statement timeout).
--
-- Qué hace:
--   1) mv_articulos_ventas: el mismo cálculo guardado (vista materializada).
--      v_articulos_ventas pasa a leer de ahí: quien la use no cambia nada.
--   2) Se recalcula sola todas las noches a las 3:30 (hora argentina) con
--      pg_cron, sin bloquear a nadie (REFRESH … CONCURRENTLY). Para el orden por
--      ventas, el dato del día anterior alcanza.
--   3) Índice que faltaba en pedidos_detalle por artículo (lo usan otras
--      consultas por artículo: kardex, historial, devoluciones).
--
-- No cambia datos. IDEMPOTENTE.
-- ═══════════════════════════════════════════════════════════════════════

create index if not exists idx_pedidos_detalle_articulo on public.pedidos_detalle (articulo_id);

create materialized view if not exists public.mv_articulos_ventas as
select d.articulo_id,
       sum(d.cantidad) as unidades_180d,
       (count(distinct d.pedido_id))::integer as pedidos_180d
  from public.pedidos_detalle d
  join public.pedidos p on p.id = d.pedido_id
 where p.estado::text <> 'eliminado'
   and p.eliminado_at is null
   and p.fecha >= (public.hoy_ar() - interval '180 days')
   and coalesce(d.es_bonificado, false) = false
   and d.articulo_id is not null
 group by d.articulo_id;

-- Necesario para refrescar sin bloquear (CONCURRENTLY)
create unique index if not exists ux_mv_articulos_ventas on public.mv_articulos_ventas (articulo_id);

-- Misma forma que antes (mismas columnas y tipos): las lecturas no cambian
create or replace view public.v_articulos_ventas as
select articulo_id, unidades_180d, pedidos_180d from public.mv_articulos_ventas;

grant select on public.mv_articulos_ventas to authenticated, service_role;
grant select on public.v_articulos_ventas to authenticated, service_role;

-- Recalcular todas las noches 3:30 ART = 6:30 UTC (mismo nombre ⇒ se reemplaza)
select cron.schedule(
  'refrescar-articulos-ventas',
  '30 6 * * *',
  $$refresh materialized view concurrently public.mv_articulos_ventas$$
);

-- Verificación:
-- select count(*) from v_articulos_ventas;            -- instantáneo
-- select * from cron.job where jobname = 'refrescar-articulos-ventas';
