-- Historial de importaciones masivas desde Excel (clientes, proveedores, articulos).
-- Registra cada actualización masiva con su resumen y el detalle fila por fila,
-- para poder reabrir la pantalla de resultados y re-exportarla más tarde.
--
-- NO reemplaza a importaciones_articulos (esa es exclusiva del flujo de listas de
-- precios por Gmail). Esta es para los importadores manuales de datos maestros.

create table if not exists public.importaciones_historial (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  modulo            text not null check (modulo in ('clientes', 'proveedores', 'articulos')),
  archivo_nombre    text,
  usuario_id        uuid,
  conector          text,                         -- columna usada para matchear (codigo_cliente, codigo_proveedor, sku, cuit)
  total_filas       integer not null default 0,
  actualizados      integer not null default 0,
  sin_cambios       integer not null default 0,
  no_encontrados    integer not null default 0,
  nuevos            integer not null default 0,
  errores           integer not null default 0,
  resultado         jsonb   not null default '[]'::jsonb   -- detalle fila por fila: [{ clave, nombre, status, cambios, error }]
);

create index if not exists idx_imp_hist_modulo_fecha
  on public.importaciones_historial (modulo, created_at desc);

-- El acceso se hace siempre con el service role desde las API routes (igual que
-- los importadores). Activamos RLS sin policies para que no quede expuesta a anon.
alter table public.importaciones_historial enable row level security;
