-- ============================================================================
-- 20261016c — Revisión de devoluciones renglón por renglón
-- ============================================================================
-- Regla del dueño (16/10/2026): una devolución que carga el vendedor o el
-- chofer queda PENDIENTE hasta que depósito (o la oficina) revisa la
-- mercadería. Al revisar se puede aceptar unos renglones y rechazar otros,
-- cambiar la cantidad aceptada (vinieron 3, 1 vencido → se aceptan 2) y la
-- condición (vendible / no vendible). Solo lo aceptado suma stock, vale en el
-- saldo del cliente y entra en la NC/REV que emite una persona de la oficina.
--
-- Para la auditoría se guarda quién decidió (usuario real, uuid), cuándo, y los
-- valores originales de cada renglón (cantidad, condición, vendible).
--
-- Un renglón rechazado queda con cantidad 0 (y subtotal 0): así el saldo
-- (lib/cuenta-corriente/saldo.ts vía devoluciones_detalle.subtotal) se corrige
-- solo. Por eso el CHECK viejo "cantidad > 0" pasa a "cantidad >= 0".
--
-- Idempotente. No borra datos.
-- ============================================================================

alter table public.devoluciones_detalle add column if not exists cantidad_original numeric;
alter table public.devoluciones_detalle add column if not exists estado_renglon varchar default 'pendiente';
alter table public.devoluciones_detalle add column if not exists motivo_revision text;
alter table public.devoluciones_detalle add column if not exists revisado_por uuid;
alter table public.devoluciones_detalle add column if not exists revisado_at timestamptz;
alter table public.devoluciones_detalle add column if not exists condicion_original varchar;
alter table public.devoluciones_detalle add column if not exists es_vendible_original boolean;

alter table public.devoluciones add column if not exists revisado_por uuid;

-- Valores posibles del estado del renglón
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'devoluciones_detalle_estado_renglon_chk'
      and conrelid = 'public.devoluciones_detalle'::regclass
  ) then
    alter table public.devoluciones_detalle
      add constraint devoluciones_detalle_estado_renglon_chk
      check (estado_renglon in ('pendiente', 'aceptado', 'rechazado'));
  end if;
end $$;

-- cantidad > 0  →  cantidad >= 0 (un renglón rechazado queda en 0)
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.devoluciones_detalle'::regclass
      and contype = 'c'
      and conname <> 'devoluciones_detalle_cantidad_no_negativa'
      and pg_get_constraintdef(oid) ~* '\(cantidad > \(?0'
  loop
    execute format('alter table public.devoluciones_detalle drop constraint %I', c.conname);
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conname = 'devoluciones_detalle_cantidad_no_negativa'
      and conrelid = 'public.devoluciones_detalle'::regclass
  ) then
    alter table public.devoluciones_detalle
      add constraint devoluciones_detalle_cantidad_no_negativa check (cantidad >= 0);
  end if;
end $$;

-- Backfill: lo cargado hasta hoy es el valor original
update public.devoluciones_detalle
set cantidad_original = cantidad
where cantidad_original is null;

-- Renglones de devoluciones ya resueltas antes de este cambio
update public.devoluciones_detalle d
set estado_renglon = case when v.estado = 'rechazado' then 'rechazado' else 'aceptado' end
from public.devoluciones v
where v.id = d.devolucion_id
  and v.estado in ('confirmado', 'facturado', 'rechazado')
  and (d.estado_renglon is null or d.estado_renglon = 'pendiente');

update public.devoluciones_detalle
set estado_renglon = 'pendiente'
where estado_renglon is null;

comment on column public.devoluciones_detalle.cantidad_original is 'Cantidad que cargó el vendedor/chofer, antes de la revisión de depósito';
comment on column public.devoluciones_detalle.estado_renglon is 'pendiente | aceptado | rechazado (revisión de depósito u oficina)';
comment on column public.devoluciones_detalle.revisado_por is 'auth.users.id de quien revisó el renglón';
comment on column public.devoluciones.revisado_por is 'auth.users.id de quien aceptó/rechazó la devolución (confirmado_por guarda el nombre)';
