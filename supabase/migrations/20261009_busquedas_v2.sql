-- ════════════════════════════════════════════════════════════════════════════
-- Búsquedas v2 — clientes y proveedores rankeados por CAMPO (09/10/2026)
--
-- Funciones NUEVAS (no reemplazan a search_clientes / search_proveedores):
-- aplicar este archivo no cambia nada de lo que corre hoy. El código nuevo usa
-- las _v2 y, si todavía no están, vuelve solo a las viejas.
--
-- Por qué: las v1 rankean por parecido contra TODO el search_text junto, y
-- cuando traían menos de 4 resultados el código sumaba "parecidos" de Gemini
-- (ver lib/search/hybrid.ts). Las v2 puntúan cada palabra según DÓNDE aparece:
--   palabra completa en nombre / razón social / dirección ........ 3
--   código exacto ................................................ 3 (+100 si es todo lo buscado)
--   palabra completa en localidad ................................ 2,9
--   comienzo de palabra (urqui → urquiza) en nombre / dirección .. 2
--   comienzo de palabra en localidad ............................. 1,9
--   en cualquier parte del texto (CUIT, provincia, etc.) ......... 1
--   suena igual en castellano (urkiza, urquisa, rivadabia) ....... 0,8
--   parecida (error de tipeo) .................................... 0,5
-- + 50 si los dígitos buscados (6 o más) están en el CUIT
-- + 1 si el nombre EMPIEZA con lo buscado, + 2 si ES lo buscado.
-- La dirección pesa igual que el nombre: a muchos clientes se los conoce por
-- dónde están ("el chino de Urquiza").
-- Palabras: si algún registro tiene TODAS, se muestran solo esos (AND). Si
-- ninguno las tiene todas ("chino urquiza"), se muestran los que tienen más.
-- Empates: alfabético por nombre.
-- ════════════════════════════════════════════════════════════════════════════

-- Clave fonética del castellano rioplatense sobre texto ya normalizado
-- (norm_search): qu/k/c dura → k, c suave/z → s, v → b, ll/y → y, h muda,
-- letras dobles → una.
create or replace function public.fonetica_es(t text)
returns text
language sql
immutable
as $fn$
  select regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(coalesce(t, ''),
      'qu', 'k', 'g'),
      'c([ei])', 's\1', 'g'),
      'c', 'k', 'g'),
      'z', 's', 'g'),
      'v', 'b', 'g'),
      'll', 'y', 'g'),
      'h', '', 'g'),
      '([a-z])\1+', '\1', 'g');
$fn$;

create or replace function public.search_clientes_v2(q text, match_count integer default 50, incluir_inactivos boolean default false)
returns table(id uuid, score real)
language sql
stable
as $fn$
  with p as (
    select public.norm_search(q) as nq,
           regexp_replace(coalesce(q, ''), '[^0-9]', '', 'g') as dig
  ),
  t as (
    select distinct tok, public.fonetica_es(tok) as ftok
    from p, unnest(string_to_array(p.nq, ' ')) tok where length(tok) > 0
  ),
  base as (
    select c.id, c.nombre, c.search_text as s,
           lower(coalesce(c.codigo_cliente, '')) as cod,
           ' ' || public.norm_search(concat_ws(' ', c.nombre, c.razon_social, c.nombre_razon_social)) || ' ' as n,
           ' ' || public.norm_search(c.direccion) || ' ' as d,
           ' ' || public.norm_search(c.localidad) || ' ' as l,
           regexp_replace(coalesce(c.cuit, ''), '[^0-9]', '', 'g') as cuit
    from public.clientes c
    where (incluir_inactivos or c.activo = true)
  ),
  m as (
    select b.id, t.tok,
      case
        when b.n like '% ' || t.tok || ' %' or b.d like '% ' || t.tok || ' %' then 3
        when b.cod = t.tok then 3
        when b.l like '% ' || t.tok || ' %' then 2.9
        when b.n like '% ' || t.tok || '%' or b.d like '% ' || t.tok || '%' then 2
        when b.l like '% ' || t.tok || '%' then 1.9
        when b.s like '%' || t.tok || '%' then 1
        when length(t.tok) >= 4 and ' ' || public.fonetica_es(b.n || b.d || b.l) || ' ' like '% ' || t.ftok || '%' then 0.8
        when length(t.tok) >= 4 and word_similarity(t.tok, b.s) >= 0.45 then 0.5
        else 0
      end as pts
    from base b cross join t
  ),
  agg as (
    select m.id, sum(m.pts) as pts, count(*) filter (where m.pts > 0) as hits
    from m group by m.id
  ),
  best as (select max(hits) as mh from agg)
  select b.id, (
      a.pts
      + case when b.cod <> '' and b.cod = p.nq then 100 else 0 end
      + case when length(p.dig) >= 6 and b.cuit like '%' || p.dig || '%' then 50 else 0 end
      + case when b.n like ' ' || p.nq || ' %' then 1 else 0 end
      + case when b.n = ' ' || p.nq || ' ' then 2 else 0 end
    )::real as score
  from agg a
  join base b on b.id = a.id
  cross join best
  cross join p
  where best.mh > 0 and a.hits = best.mh
  order by score desc, b.nombre asc
  limit match_count;
$fn$;

create or replace function public.search_proveedores_v2(q text, match_count integer default 50, incluir_inactivos boolean default false)
returns table(id uuid, score real)
language sql
stable
as $fn$
  with p as (
    select public.norm_search(q) as nq,
           regexp_replace(coalesce(q, ''), '[^0-9]', '', 'g') as dig
  ),
  t as (
    select distinct tok, public.fonetica_es(tok) as ftok
    from p, unnest(string_to_array(p.nq, ' ')) tok where length(tok) > 0
  ),
  base as (
    select pr.id, pr.nombre, pr.search_text as s,
           lower(coalesce(pr.codigo_proveedor, '')) as cod,
           ' ' || public.norm_search(concat_ws(' ', pr.nombre, pr.sigla)) || ' ' as n,
           ' ' || public.norm_search(pr.direccion) || ' ' as d,
           ' ' || public.norm_search(pr.localidad) || ' ' as l,
           regexp_replace(coalesce(pr.cuit, '') || ' ' || coalesce(pr.numero_cuit, ''), '[^0-9 ]', '', 'g') as cuit,
           ' ' || coalesce(mk.marcas, '') || ' ' as mk
    from public.proveedores pr
    left join (
      -- Marcas que vende cada proveedor: buscar "virulana" encuentra a Newell
      select a.proveedor_id, public.norm_search(string_agg(distinct a.marca_nombre, ' ')) as marcas
      from public.articulos a
      where a.activo = true and a.proveedor_id is not null and a.marca_nombre is not null
      group by a.proveedor_id
    ) mk on mk.proveedor_id = pr.id
    where (incluir_inactivos or pr.activo = true)
  ),
  m as (
    select b.id, t.tok,
      case
        when b.n like '% ' || t.tok || ' %' or b.d like '% ' || t.tok || ' %' then 3
        when b.cod = t.tok then 3
        when b.l like '% ' || t.tok || ' %' then 2.9
        when b.n like '% ' || t.tok || '%' or b.d like '% ' || t.tok || '%' then 2
        when b.l like '% ' || t.tok || '%' then 1.9
        when b.mk like '% ' || t.tok || '%' then 1.5
        when b.s like '%' || t.tok || '%' then 1
        when length(t.tok) >= 4 and ' ' || public.fonetica_es(b.n || b.d || b.l || b.mk) || ' ' like '% ' || t.ftok || '%' then 0.8
        when length(t.tok) >= 4 and word_similarity(t.tok, b.s || b.mk) >= 0.45 then 0.5
        else 0
      end as pts
    from base b cross join t
  ),
  agg as (
    select m.id, sum(m.pts) as pts, count(*) filter (where m.pts > 0) as hits
    from m group by m.id
  ),
  best as (select max(hits) as mh from agg)
  select b.id, (
      a.pts
      + case when b.cod <> '' and b.cod = p.nq then 100 else 0 end
      + case when length(p.dig) >= 6 and b.cuit like '%' || p.dig || '%' then 50 else 0 end
      + case when b.n like ' ' || p.nq || ' %' then 1 else 0 end
      + case when b.n = ' ' || p.nq || ' ' then 2 else 0 end
    )::real as score
  from agg a
  join base b on b.id = a.id
  cross join best
  cross join p
  where best.mh > 0 and a.hits = best.mh
  order by score desc, b.nombre asc
  limit match_count;
$fn$;

grant execute on function public.fonetica_es(text) to authenticated, service_role;
grant execute on function public.search_clientes_v2(text, integer, boolean) to authenticated, service_role;
grant execute on function public.search_proveedores_v2(text, integer, boolean) to authenticated, service_role;
