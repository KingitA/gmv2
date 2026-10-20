-- ════════════════════════════════════════════════════════════════════════════
-- Pedidos de la última semana: pasar renglones de artículos DADOS DE BAJA a su
-- artículo real (mismo código sin el 0 adelante). 20/10/2026, pedido del dueño.
--
-- Causa: la importación de pedidos tomaba "062216" (dado de baja) en vez de "62216".
-- Ya corregido en el código (bef0ecd). Esto arregla lo que se cargó mal.
-- Gemelos hoy: 020024→20024, 062216→62216, 062483→62483, 063534→63534.
-- Al 20/10 afecta 1 renglón: pedido 001831 (18 u. de 062216 → 62216).
--
-- Solo renglones SIN comprobante y de pedidos creados en los últimos 7 días.
-- Se conserva el precio con que se tomó el pedido (para el precio de hoy: Repreciar).
-- No mueve stock (el único trigger de pedidos_detalle avisa a las apps).
-- ════════════════════════════════════════════════════════════════════════════

begin;

with gemelo as (
  select a.id as viejo, b.id as real
  from public.articulos a
  join public.articulos b
    on b.activo = true
   and b.id <> a.id
   and ltrim(b.sku, '0') = ltrim(a.sku, '0')
  where a.activo = false
)
update public.pedidos_detalle d
   set articulo_id = g.real
  from gemelo g, public.pedidos p
 where d.articulo_id = g.viejo
   and p.id = d.pedido_id
   and p.created_at >= now() - interval '7 days'
   and d.comprobante_venta_detalle_id is null
returning p.numero_pedido, d.id as renglon, d.cantidad;

commit;
