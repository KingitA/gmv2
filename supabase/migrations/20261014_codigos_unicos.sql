-- ════════════════════════════════════════════════════════════════════════════
-- Códigos únicos de cliente y proveedor (14/10/2026)
-- Regla del dueño: un código de cliente, proveedor o SKU NUNCA se repite.
--   · SKU de artículos: ya tiene índice único (articulos_sku_key). Nada que hacer.
--   · Cliente / proveedor:
--       - el código se guarda sin espacios y, si es numérico, sin ceros adelante;
--       - índice ÚNICO (la base rechaza un duplicado venga de donde venga);
--       - si un alta llega SIN código (alta del viajante, app offline, importación),
--         el trigger le asigna el PRIMER número libre desde 1 (1,2,3,5,8 → 4, 6, 7…).
--         Un código de un registro dado de baja sigue ocupado.
-- Antes hay que resolver los 3 duplicados que existen hoy (sección 1). REVISAR antes
-- de ejecutar: si preferís otra resolución, cambiá esa sección.
-- Seguro de re-ejecutar.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── Función: primer número libre de una tabla/columna ──────────────────────
create or replace function public.primer_codigo_libre(p_tabla text, p_columna text)
returns text
language plpgsql
stable
as $fn$
declare
  v text;
begin
  execute format($q$
    with n as (
      select distinct (%1$I)::bigint as x from public.%2$I
      where %1$I ~ '^\d{1,12}$'
    )
    select (case
      when not exists (select 1 from n where x = 1) then 1
      else (select min(x) + 1 from n where not exists (select 1 from n n2 where n2.x = n.x + 1))
    end)::text
  $q$, p_columna, p_tabla) into v;
  return coalesce(v, '1');
end;
$fn$;

create or replace function public.siguiente_codigo_cliente() returns text
language sql stable as $fn$ select public.primer_codigo_libre('clientes', 'codigo_cliente') $fn$;

create or replace function public.siguiente_codigo_proveedor() returns text
language sql stable as $fn$ select public.primer_codigo_libre('proveedores', 'codigo_proveedor') $fn$;

grant execute on function public.primer_codigo_libre(text, text) to authenticated, service_role;
grant execute on function public.siguiente_codigo_cliente() to authenticated, service_role;
grant execute on function public.siguiente_codigo_proveedor() to authenticated, service_role;

-- ── 1. Duplicados de hoy ────────────────────────────────────────────────────
-- Cliente 342: la ficha DADA DE BAJA es un duplicado del mismo cliente (mismo CUIT,
-- sin comprobantes). Se le saca el código; la activa conserva el 342.
update public.clientes set codigo_cliente = null
 where id = 'd17145a7-89dc-4360-b4cb-fc3c5881f7b6' and codigo_cliente = '342';

-- Proveedor 104: TEXTIL DOSS cargado dos veces (mismo CUIT). El segundo (sin artículos
-- ni órdenes de compra) se queda sin código; TEXTIL DOSS S.R.L conserva el 104.
update public.proveedores set codigo_proveedor = null
 where id = 'fae4bf64-8d92-49a0-bbc2-bc0f8a5a54be' and codigo_proveedor = '104';

-- Proveedor 30: son DOS proveedores distintos. MATERIA HNOS. (tiene una orden de
-- compra) conserva el 30; WALE'S (SEISEME) pasa al primer número libre.
update public.proveedores set codigo_proveedor = public.siguiente_codigo_proveedor()
 where id = 'ec7b361e-425a-4b01-8e61-0a02d9b31f19' and codigo_proveedor = '30';

-- Forma única de los códigos existentes (espacios, vacíos, ceros adelante)
update public.clientes set codigo_cliente = nullif(regexp_replace(btrim(codigo_cliente), '^0+(?=\d)', ''), '')
 where codigo_cliente is distinct from nullif(regexp_replace(btrim(codigo_cliente), '^0+(?=\d)', ''), '');
update public.proveedores set codigo_proveedor = nullif(regexp_replace(btrim(codigo_proveedor), '^0+(?=\d)', ''), '')
 where codigo_proveedor is distinct from nullif(regexp_replace(btrim(codigo_proveedor), '^0+(?=\d)', ''), '');

-- ── 2. Índices únicos ───────────────────────────────────────────────────────
create unique index if not exists uq_clientes_codigo on public.clientes (codigo_cliente) where codigo_cliente is not null;
create unique index if not exists uq_proveedores_codigo on public.proveedores (codigo_proveedor) where codigo_proveedor is not null;

-- ── 3. Trigger: normaliza el código y asigna el primer libre si viene vacío ──
create or replace function public.trg_codigo_unico()
returns trigger
language plpgsql
as $fn$
declare
  col text := tg_argv[0];
  actual text := to_jsonb(new) ->> col;
  nuevo text := nullif(regexp_replace(btrim(coalesce(actual, '')), '^0+(?=\d)', ''), '');
begin
  if tg_op = 'INSERT' and nuevo is null then
    -- Serializa las altas simultáneas para que dos no tomen el mismo número
    perform pg_advisory_xact_lock(hashtext('codigo:' || tg_table_name));
    nuevo := public.primer_codigo_libre(tg_table_name, col);
  end if;
  if nuevo is distinct from actual then
    new := jsonb_populate_record(new, jsonb_build_object(col, nuevo));
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_codigo_unico on public.clientes;
create trigger trg_codigo_unico before insert or update of codigo_cliente on public.clientes
  for each row execute function public.trg_codigo_unico('codigo_cliente');

drop trigger if exists trg_codigo_unico on public.proveedores;
create trigger trg_codigo_unico before insert or update of codigo_proveedor on public.proveedores
  for each row execute function public.trg_codigo_unico('codigo_proveedor');

commit;

-- Control:
-- select public.siguiente_codigo_cliente(), public.siguiente_codigo_proveedor();
-- select codigo_cliente, count(*) from clientes where codigo_cliente is not null group by 1 having count(*) > 1;  -- 0 filas
