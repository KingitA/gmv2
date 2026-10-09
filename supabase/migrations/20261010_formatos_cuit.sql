-- ════════════════════════════════════════════════════════════════════════════
-- Formatos únicos — CUIT (10/10/2026)
-- En la base TODO CUIT se guarda "xx-xxxxxxxx-x" (mismo formato que se ve).
--   · normalizar_cuit(): 11 dígitos con cualquier separador → xx-xxxxxxxx-x;
--     vacío, máscara sin completar ("__-________-_") o todo ceros → NULL;
--     cualquier otra cosa queda como estaba (la valida la pantalla antes de guardar).
--   · Trigger en cada columna de CUIT: cualquier escritura futura (pantalla, app,
--     importación de Excel, IA) queda normalizada sola.
--   · Se corrigen los datos existentes.
-- Para mandar a ARCA / BCRA el código usa cuitDigitos() (lib/formato).
-- Seguro de re-ejecutar.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.normalizar_cuit(v text)
returns text
language sql
immutable
as $fn$
  select case
    when v is null then null
    when regexp_replace(v, '\D', '', 'g') = '' then null
    when regexp_replace(v, '\D', '', 'g') ~ '^0+$' then null
    when length(regexp_replace(v, '\D', '', 'g')) = 11 then
      substr(regexp_replace(v, '\D', '', 'g'), 1, 2) || '-' ||
      substr(regexp_replace(v, '\D', '', 'g'), 3, 8) || '-' ||
      substr(regexp_replace(v, '\D', '', 'g'), 11, 1)
    else btrim(v)
  end;
$fn$;

-- Trigger genérico: normaliza las columnas pasadas como argumentos.
create or replace function public.trg_normalizar_cuit()
returns trigger
language plpgsql
as $fn$
declare
  col text;
  cambios jsonb := '{}'::jsonb;
  actual text;
begin
  foreach col in array tg_argv loop
    actual := to_jsonb(new) ->> col;
    if actual is distinct from public.normalizar_cuit(actual) then
      cambios := cambios || jsonb_build_object(col, public.normalizar_cuit(actual));
    end if;
  end loop;
  if cambios <> '{}'::jsonb then
    new := jsonb_populate_record(new, cambios);
  end if;
  return new;
end;
$fn$;

do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('clientes', array['cuit']),
      ('clientes_info', array['cuit']),
      ('proveedores', array['cuit', 'numero_cuit']),
      ('transportes', array['cuit']),
      ('configuracion_empresa', array['cuit']),
      ('usuarios_crm', array['cuit']),
      ('pagos_detalle', array['cuit_emisor']),
      ('arca_solicitudes_cae', array['cliente_cuit'])
    ) as x(tabla, cols)
  loop
    if to_regclass('public.' || t.tabla) is null then continue; end if;
    execute format('drop trigger if exists trg_normalizar_cuit on public.%I', t.tabla);
    execute format(
      'create trigger trg_normalizar_cuit before insert or update of %s on public.%I for each row execute function public.trg_normalizar_cuit(%s)',
      array_to_string(t.cols, ', '), t.tabla,
      (select string_agg(quote_literal(c), ', ') from unnest(t.cols) c)
    );
  end loop;
end $$;

-- Datos existentes (solo filas que cambian; los triggers de sincronización a
-- las apps avisan de esos registros)
update public.clientes              set cuit = public.normalizar_cuit(cuit)               where cuit is distinct from public.normalizar_cuit(cuit);
update public.proveedores           set cuit = public.normalizar_cuit(cuit)               where cuit is distinct from public.normalizar_cuit(cuit);
update public.proveedores           set numero_cuit = public.normalizar_cuit(numero_cuit) where numero_cuit is distinct from public.normalizar_cuit(numero_cuit);
update public.transportes           set cuit = public.normalizar_cuit(cuit)               where cuit is distinct from public.normalizar_cuit(cuit);
update public.usuarios_crm          set cuit = public.normalizar_cuit(cuit)               where cuit is distinct from public.normalizar_cuit(cuit);
update public.pagos_detalle         set cuit_emisor = public.normalizar_cuit(cuit_emisor) where cuit_emisor is distinct from public.normalizar_cuit(cuit_emisor);
update public.arca_solicitudes_cae  set cliente_cuit = public.normalizar_cuit(cliente_cuit) where cliente_cuit is distinct from public.normalizar_cuit(cliente_cuit);
do $$ begin
  if to_regclass('public.clientes_info') is not null then
    update public.clientes_info set cuit = public.normalizar_cuit(cuit) where cuit is distinct from public.normalizar_cuit(cuit);
  end if;
end $$;
-- configuracion_empresa ya está bien (30-71022924-0): el trigger la protege de acá en más.

-- Control: no debería quedar ningún CUIT de 11 dígitos sin guiones
-- select 'clientes', count(*) from clientes where cuit !~ '^\d{2}-\d{8}-\d$'
-- union all select 'proveedores', count(*) from proveedores where cuit !~ '^\d{2}-\d{8}-\d$'
-- union all select 'transportes', count(*) from transportes where cuit !~ '^\d{2}-\d{8}-\d$';
