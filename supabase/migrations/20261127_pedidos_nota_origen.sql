-- ═══════════════════════════════════════════════════════════════════════
-- PEDIDOS: NOTA DEL SISTEMA APARTE DE LA OBSERVACIÓN ESCRITA A MANO (Juan, 27/11/2026)
--
-- Qué pasaba: el código guardaba en pedidos.observaciones textos fijos del sistema
-- ("Importado vía IA", "Aprobado desde importación manual", "Importado
-- automáticamente desde Gmail — Asunto … — De …", "Venta mostrador"…), mezclados
-- con lo que escribe una persona (el vendedor en la app, la oficina en el ERP).
--
-- Qué decidió Juan:
--   * Lo escrito a mano (pedidos.observaciones) se ve en el pedido, en el
--     encabezado de su impresión y al pie de todos los comprobantes.
--   * La nota del sistema (de dónde vino el pedido, con el nombre del archivo) se
--     ve SOLO en el pedido y en su impresión, nunca en los comprobantes.
--
-- Qué hace:
--   1) Columna nueva pedidos.nota_origen (la nota del sistema).
--   2) Pasa a nota_origen los textos fijos que hoy están en observaciones (hoy
--      ~1.940 pedidos). Si el pedido tenía además texto escrito a mano
--      ("Mostrador — <texto>"), el texto a mano queda en observaciones.
--      Solo toca pedidos que todavía no tienen nota_origen.
--   3) Las apps no cambian: siguen leyendo observaciones y ahora ven solo lo manual.
--
-- No toca comprobantes ni importes. IDEMPOTENTE.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.pedidos add column if not exists nota_origen text;

comment on column public.pedidos.nota_origen is
  'Nota del SISTEMA sobre el origen del pedido ("Importado vía IA - pedido juanenea 27-11.xlsx", "Venta mostrador"…). Se ve en el pedido y su impresión, NUNCA en los comprobantes. Lo escrito a mano va en observaciones';
comment on column public.pedidos.observaciones is
  'Observación ESCRITA A MANO (vendedor en la app, oficina en el ERP o en la importación). Se imprime en el pedido y al pie de los comprobantes';

-- Texto fijo completo → nota_origen, observaciones vacía
update public.pedidos
   set nota_origen = btrim(observaciones),
       observaciones = null
 where nota_origen is null
   and (btrim(observaciones) in ('Importado vía IA', 'Importado automáticamente vía IA',
                                 'Aprobado desde importación', 'Aprobado desde importación manual',
                                 'Venta mostrador')
        or observaciones like 'Importado automáticamente desde %');

-- "Mostrador — <texto a mano>": la nota al sistema, el texto a mano queda
update public.pedidos
   set nota_origen = 'Venta mostrador',
       observaciones = nullif(btrim(substr(observaciones, length('Mostrador — ') + 1)), '')
 where nota_origen is null
   and observaciones like 'Mostrador — %';

-- Verificación: no tiene que quedar ninguno de estos textos en observaciones
-- select count(*) from pedidos where observaciones ilike 'Importado%' or observaciones ilike 'Aprobado desde importaci%' or observaciones = 'Venta mostrador';
-- select nota_origen, count(*) from pedidos where nota_origen is not null group by 1 order by 2 desc limit 10;
