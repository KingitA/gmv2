-- ============================================================================
-- Búsqueda híbrida (léxica trigram + normalización) para artículos / clientes /
-- proveedores. Capa léxica primaria; el vector (embeddings ya existentes) actúa
-- como complemento desde el servidor.
--
-- Idempotente. Aplicar en Supabase SQL Editor. Cambios aditivos (sin downtime).
-- ============================================================================

-- 1) EXTENSIONES (en schema public, igual que `vector`, porque search_path no
--    incluye el schema `extensions`).
create extension if not exists pg_trgm with schema public;
create extension if not exists unaccent with schema public;

-- 2) NORMALIZACIÓN: minúsculas + sin acentos + solo [a-z0-9 ] + espacios colapsados.
--    Declarada IMMUTABLE para poder indexar expresiones que la usen.
create or replace function public.norm_search(t text)
returns text
language sql
immutable
as $$
  select btrim(
    regexp_replace(
      regexp_replace(lower(public.unaccent(coalesce(t, ''))), '[^a-z0-9]+', ' ', 'g'),
      ' +', ' ', 'g'
    )
  );
$$;

-- 3) COLUMNA search_text (documento de búsqueda combinado y YA NORMALIZADO).
alter table public.articulos    add column if not exists search_text text;
alter table public.clientes     add column if not exists search_text text;
alter table public.proveedores  add column if not exists search_text text;

-- 4) BUILDERS + TRIGGERS que mantienen search_text en cada INSERT/UPDATE.
--    Garantiza cobertura ante app, import masivo o SQL editor ("nada queda afuera").

-- 4a) ARTÍCULOS: incluye marca, proveedor y aliases (en otras tablas).
create or replace function public.articulos_build_search_text(a public.articulos)
returns text
language sql
stable
as $$
  select public.norm_search(concat_ws(' ',
    a.descripcion,
    a.sku,
    array_to_string(a.ean13, ' '),
    a.codigo_bulto,
    a.sigla,
    a.categoria, a.subcategoria, a.rubro,
    (select m.descripcion from public.marcas m where m.id = a.marca_id),
    (select m.codigo      from public.marcas m where m.id = a.marca_id),
    (select p.nombre      from public.proveedores p where p.id = a.proveedor_id),
    (select string_agg(
        concat_ws(' ', al.descripcion_proveedor, al.codigo_proveedor, al.alias_texto), ' ')
       from public.articulos_alias al where al.articulo_id = a.id)
  ));
$$;

create or replace function public.articulos_search_text_trg()
returns trigger language plpgsql as $$
begin
  new.search_text := public.articulos_build_search_text(new);
  return new;
end $$;

drop trigger if exists trg_articulos_search_text on public.articulos;
create trigger trg_articulos_search_text
  before insert or update on public.articulos
  for each row execute function public.articulos_search_text_trg();

-- 4a-bis) Refrescar el artículo padre cuando cambian sus aliases.
create or replace function public.articulos_alias_refresh_parent()
returns trigger language plpgsql as $$
declare aid uuid;
begin
  aid := coalesce(new.articulo_id, old.articulo_id);
  if aid is not null then
    update public.articulos
       set search_text = public.articulos_build_search_text(articulos)
     where id = aid;
  end if;
  return null;
end $$;

drop trigger if exists trg_articulos_alias_refresh on public.articulos_alias;
create trigger trg_articulos_alias_refresh
  after insert or update or delete on public.articulos_alias
  for each row execute function public.articulos_alias_refresh_parent();

-- 4b) CLIENTES (campos propios). Incluye variante compactada (sin espacios) para
--     siglas pegadas (K&M -> km).
create or replace function public.clientes_search_text_trg()
returns trigger language plpgsql as $$
declare base text;
begin
  base := public.norm_search(concat_ws(' ',
    new.nombre, new.razon_social, new.nombre_razon_social,
    new.cuit, new.codigo_cliente, new.localidad, new.provincia, new.direccion));
  new.search_text := base || ' ' || replace(base, ' ', '');
  return new;
end $$;

drop trigger if exists trg_clientes_search_text on public.clientes;
create trigger trg_clientes_search_text
  before insert or update on public.clientes
  for each row execute function public.clientes_search_text_trg();

-- 4c) PROVEEDORES (campos propios). Incluye variante compactada (siglas pegadas).
create or replace function public.proveedores_search_text_trg()
returns trigger language plpgsql as $$
declare base text;
begin
  base := public.norm_search(concat_ws(' ',
    new.nombre, new.sigla, new.cuit, new.numero_cuit,
    new.codigo_proveedor, new.localidad, new.direccion, new.mail_oficina));
  new.search_text := base || ' ' || replace(base, ' ', '');
  return new;
end $$;

drop trigger if exists trg_proveedores_search_text on public.proveedores;
create trigger trg_proveedores_search_text
  before insert or update on public.proveedores
  for each row execute function public.proveedores_search_text_trg();

-- 5) BACKFILL de filas existentes.
update public.articulos    set search_text = public.articulos_build_search_text(articulos);
update public.clientes     set search_text = public.norm_search(concat_ws(' ',
  nombre, razon_social, nombre_razon_social, cuit, codigo_cliente, localidad, provincia, direccion));
update public.proveedores  set search_text = public.norm_search(concat_ws(' ',
  nombre, sigla, cuit, numero_cuit, codigo_proveedor, localidad, direccion, mail_oficina));

-- 6) ÍNDICES GIN trigram (aceleran LIKE '%x%', similarity % y word_similarity <%).
create index if not exists idx_articulos_search_trgm   on public.articulos   using gin (search_text public.gin_trgm_ops);
create index if not exists idx_clientes_search_trgm     on public.clientes    using gin (search_text public.gin_trgm_ops);
create index if not exists idx_proveedores_search_trgm  on public.proveedores using gin (search_text public.gin_trgm_ops);

-- 7) RPCs de búsqueda léxica híbrida. Devuelven (id, score); el servidor hidrata.
--    Lógica: TOKEN-AND con tolerancia: cada token de la consulta debe estar como
--    substring O matchear por similitud de palabra (typos). Ranking por similitud
--    + bonus por prefijo / substring exacto de la consulta completa.

-- 7a) ARTÍCULOS
create or replace function public.search_articulos(q text, match_count int default 30)
returns table(id uuid, score real)
language sql stable as $$
  with params as (
    select public.norm_search(q) as nq
  ), toks as (
    select tok from params, unnest(string_to_array((select nq from params), ' ')) tok
    where length(tok) > 0
  )
  select a.id,
    ( greatest(word_similarity((select nq from params), a.search_text),
               similarity((select nq from params), a.search_text))
      + case when a.search_text like (select nq from params) || '%' then 0.5 else 0 end
      + case when a.search_text like '%' || (select nq from params) || '%' then 0.3 else 0 end
    )::real as score
  from public.articulos a
  where a.activo = true
    and not exists (
      select 1 from toks t
      where not (a.search_text like '%' || t.tok || '%'
                 or word_similarity(t.tok, a.search_text) > 0.5)
    )
  order by score desc
  limit match_count;
$$;

-- 7b) CLIENTES
create or replace function public.search_clientes(q text, match_count int default 30)
returns table(id uuid, score real)
language sql stable as $$
  with params as (
    select public.norm_search(q) as nq
  ), toks as (
    select tok from params, unnest(string_to_array((select nq from params), ' ')) tok
    where length(tok) > 0
  )
  select c.id,
    ( greatest(word_similarity((select nq from params), c.search_text),
               similarity((select nq from params), c.search_text))
      + case when c.search_text like (select nq from params) || '%' then 0.5 else 0 end
      + case when c.search_text like '%' || (select nq from params) || '%' then 0.3 else 0 end
    )::real as score
  from public.clientes c
  where c.activo = true
    and not exists (
      select 1 from toks t
      where not (c.search_text like '%' || t.tok || '%'
                 or word_similarity(t.tok, c.search_text) > 0.5)
    )
  order by score desc
  limit match_count;
$$;

-- 7c) PROVEEDORES
create or replace function public.search_proveedores(q text, match_count int default 30)
returns table(id uuid, score real)
language sql stable as $$
  with params as (
    select public.norm_search(q) as nq
  ), toks as (
    select tok from params, unnest(string_to_array((select nq from params), ' ')) tok
    where length(tok) > 0
  )
  select p.id,
    ( greatest(word_similarity((select nq from params), p.search_text),
               similarity((select nq from params), p.search_text))
      + case when p.search_text like (select nq from params) || '%' then 0.5 else 0 end
      + case when p.search_text like '%' || (select nq from params) || '%' then 0.3 else 0 end
    )::real as score
  from public.proveedores p
  where p.activo = true
    and not exists (
      select 1 from toks t
      where not (p.search_text like '%' || t.tok || '%'
                 or word_similarity(t.tok, p.search_text) > 0.5)
    )
  order by score desc
  limit match_count;
$$;

-- 8) Permisos para los roles de Supabase.
grant execute on function public.search_articulos(text, int)   to anon, authenticated, service_role;
grant execute on function public.search_clientes(text, int)    to anon, authenticated, service_role;
grant execute on function public.search_proveedores(text, int) to anon, authenticated, service_role;
grant execute on function public.norm_search(text)             to anon, authenticated, service_role;
