-- Fecha de entrega "suelta" del pedido (rediseño CLIENTES, decisión del dueño 07/10/2026).
-- Permite dejar un pedido asignado a un DÍA del calendario sin viaje todavía.
-- Es opcional: un pedido sin fecha sigue apareciendo en el ERP según su estado,
-- como siempre. Si el pedido está en un viaje, manda la fecha del viaje.
-- No cambia datos existentes (columna nueva, vacía) y las apps no la leen.

alter table public.pedidos add column if not exists fecha_entrega date;

comment on column public.pedidos.fecha_entrega is
  'Día previsto de entrega cuando el pedido todavía no está en un viaje (calendario de CLIENTES). Opcional.';

create index if not exists idx_pedidos_fecha_entrega
  on public.pedidos (fecha_entrega)
  where fecha_entrega is not null;
