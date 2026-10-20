-- ════════════════════════════════════════════════════════════════════════════
-- Artículos dados de baja (20/10/2026, decisiones del dueño)
-- 1) Historial de altas/bajas: quién y cuándo da de baja o REACTIVA un artículo
--    (desde /articulos, depósito web, app de depósito, importaciones). Lo llena un
--    trigger, así no depende de que cada pantalla se acuerde de registrarlo.
--    Usuario = el de la sesión (auth.uid()) o, si escribe el servidor con la
--    service key, el que el código deja en articulos.actualizado_por.
-- 2) match_articulos (búsqueda por IA): solo artículos activos. Antes los dados de
--    baja ocupaban lugares en los resultados y el código los descartaba después.
-- Seguro de re-ejecutar.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.articulos_estado_historial (
  id          uuid primary key default gen_random_uuid(),
  articulo_id uuid not null references public.articulos(id) on delete cascade,
  activo      boolean not null,           -- estado NUEVO: false = dado de baja, true = reactivado
  usuario_id  uuid,                       -- quién lo hizo
  origen      text,                       -- 'articulos' | 'deposito' | 'app_deposito' | 'importacion' | null
  created_at  timestamptz not null default now()
);
create index if not exists idx_articulos_estado_hist_art on public.articulos_estado_historial (articulo_id, created_at desc);

alter table public.articulos_estado_historial enable row level security;
drop policy if exists articulos_estado_historial_lectura on public.articulos_estado_historial;
create policy articulos_estado_historial_lectura on public.articulos_estado_historial
  for select to authenticated using (true);
grant select on public.articulos_estado_historial to authenticated;
grant all on public.articulos_estado_historial to service_role;

-- El código puede indicar el origen con set_config('gm.origen_articulo', '…', true)
-- dentro de la misma transacción; si no, queda null.
create or replace function public.articulos_registrar_estado()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if new.activo is distinct from old.activo then
    insert into public.articulos_estado_historial (articulo_id, activo, usuario_id, origen)
    values (new.id, coalesce(new.activo, false), coalesce(auth.uid(), new.actualizado_por),
            nullif(current_setting('gm.origen_articulo', true), ''));
  end if;
  return null;
end;
$fn$;

drop trigger if exists trg_articulos_estado_historial on public.articulos;
create trigger trg_articulos_estado_historial
  after update of activo on public.articulos
  for each row execute function public.articulos_registrar_estado();

-- Cambiar estado (baja / reactivar) registrando quién y desde dónde, en una sola transacción.
-- Devuelve los ids que realmente cambiaron.
create or replace function public.articulo_cambiar_estado(p_ids uuid[], p_activo boolean, p_usuario uuid, p_origen text)
returns setof uuid
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  perform set_config('gm.origen_articulo', coalesce(p_origen, ''), true);
  return query
    update public.articulos
       set activo = p_activo, actualizado_por = p_usuario
     where id = any(p_ids) and activo is distinct from p_activo
    returning id;
end;
$fn$;
revoke all on function public.articulo_cambiar_estado(uuid[], boolean, uuid, text) from public, anon, authenticated;
grant execute on function public.articulo_cambiar_estado(uuid[], boolean, uuid, text) to service_role;

-- Búsqueda por IA: solo activos (misma firma y resultado que antes)
create or replace function public.match_articulos(query_embedding vector, match_threshold double precision default 0.35, match_count integer default 20)
returns table(id uuid, similarity double precision)
language sql
stable
as $fn$
    select a.id, (1 - (a.embedding <=> query_embedding))::float as similarity
    from articulos a
    where a.embedding is not null
      and a.activo = true
      and 1 - (a.embedding <=> query_embedding) > match_threshold
    order by similarity desc
    limit match_count;
$fn$;
