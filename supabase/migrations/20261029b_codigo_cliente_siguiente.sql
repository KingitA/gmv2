-- ═══════════════════════════════════════════════════════════════════════
-- CÓDIGO DE CLIENTE NUEVO = EL MÁS ALTO + 1 (P2-01, 2ª prueba integral, 29/10/2026)
--
-- Regla de Juan (27/10): el cliente nuevo recibe el número siguiente al código
-- más alto (hoy 90034 → 90035). Nunca se reusa un hueco (3, 4, 765…): un alta en
-- gmv2 no puede quedarse con el código de un cliente del sistema viejo que todavía
-- no se cargó acá (la apertura reconoce a los clientes por código).
--
-- Qué cambia: siguiente_codigo_cliente() y el disparador que pone el código
-- cuando el alta llega sin código. Los códigos no numéricos ('PRUEBA-R1') no
-- cuentan. Proveedores: SIN cambio (siguen con el primer libre).
--
-- No cambia datos. IDEMPOTENTE.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.siguiente_codigo_numerico(p_tabla text, p_columna text)
returns text
language plpgsql stable as $fn$
declare
  v text;
begin
  execute format($q$
    select (coalesce(max((%1$I)::bigint), 0) + 1)::text from public.%2$I
    where %1$I ~ '^\d{1,12}$'
  $q$, p_columna, p_tabla) into v;
  return coalesce(v, '1');
end;
$fn$;

create or replace function public.siguiente_codigo_cliente() returns text
language sql stable as $fn$ select public.siguiente_codigo_numerico('clientes', 'codigo_cliente') $fn$;

grant execute on function public.siguiente_codigo_numerico(text, text) to authenticated, service_role;
grant execute on function public.siguiente_codigo_cliente() to authenticated, service_role;

create or replace function public.trg_codigo_unico()
returns trigger
language plpgsql as $fn$
declare
  col text := tg_argv[0];
  actual text := to_jsonb(new) ->> col;
  nuevo text := nullif(regexp_replace(btrim(coalesce(actual, '')), '^0+(?=\d)', ''), '');
begin
  if tg_op = 'INSERT' and nuevo is null then
    -- Serializa las altas simultáneas para que dos no tomen el mismo número
    perform pg_advisory_xact_lock(hashtext('codigo:' || tg_table_name));
    -- Clientes: el más alto + 1 (P2-01). Proveedores: el primer libre.
    nuevo := case when tg_table_name = 'clientes'
                  then public.siguiente_codigo_numerico(tg_table_name, col)
                  else public.primer_codigo_libre(tg_table_name, col) end;
  end if;
  if nuevo is distinct from actual then
    new := jsonb_populate_record(new, jsonb_build_object(col, nuevo));
  end if;
  return new;
end;
$fn$;

-- Verificación: select public.siguiente_codigo_cliente();  -- hoy: 90035
