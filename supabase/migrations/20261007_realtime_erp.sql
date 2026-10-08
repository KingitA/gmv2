-- Actualización EN VIVO del ERP (rediseño frontend, 07/10/2026).
-- Agrega a la publicación de Supabase Realtime las tablas que muestran las
-- pantallas del ERP, para que un cambio hecho en una PC (o en el depósito, o
-- en la app del vendedor) aparezca solo en las demás, sin refrescar.
-- Hasta hoy solo estaba "pedidos". Ninguna de estas tablas tiene RLS, así que
-- no hace falta tocar políticas. No modifica datos ni estructura.
--
-- Idempotente: si una tabla ya está publicada, la saltea.

do $$
declare
  t text;
  tablas text[] := array[
    'pedidos', 'pedidos_detalle', 'picking_items', 'remitos',
    'viajes', 'viaje_zonas',
    'clientes', 'comprobantes_venta', 'devoluciones',
    'pagos_clientes', 'pagos_detalle', 'imputaciones',
    'vencimientos', 'cheques', 'kardex_contable',
    'proveedores', 'ordenes_pago', 'ordenes_compra', 'comprobantes_compra', 'cuenta_corriente_proveedores'
  ];
begin
  foreach t in array tablas loop
    if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t)
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t)
    then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
