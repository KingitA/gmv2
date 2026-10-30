-- ═══════════════════════════════════════════════════════════════════════
-- ELIMINAR UN CLIENTE DE VERDAD (P2-02, 2ª prueba integral, 29/10/2026)
--
-- Hasta hoy el tacho de /clientes solo lo "desactivaba": seguía en la base con su
-- código ocupado y aparecía en "Inactivos". Reglas de Juan (27/10):
--
--   * Tiene saldo (deuda o a favor): NO se elimina. "Tiene deuda de $X: primero
--     hay que saldarla". (Asumir la deuda va a ir a la caja de ajustes, P2-03,
--     que todavía no existe.)
--   * Tiene pedidos en curso (no entregados / rechazados / eliminados): no se
--     elimina hasta terminarlos o eliminarlos.
--   * Sin ningún movimiento (pedidos, comprobantes, cobros, devoluciones,
--     cuenta corriente, remitos, viajes, kardex): se BORRA de la base.
--   * Con historial (comprobantes con o sin CAE, pedidos, cobros…): se conserva
--     el historial (ventas, comisiones, y las facturas con CAE tienen dueño), se
--     borra su configuración (bonificaciones, condiciones por proveedor/marca,
--     zonas, precios calculados, métricas) y el cliente queda ESCONDIDO: no
--     aparece en ninguna lista (ni en "Inactivos") ni en búsquedas, y su código
--     queda LIBRE.
--
-- Lo hace la función cliente_eliminar(), que llama el servidor
-- (DELETE /api/clientes/[id], solo admin). Agrega una columna; no cambia datos.
-- IDEMPOTENTE.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.clientes add column if not exists eliminado_at timestamptz;
alter table public.clientes add column if not exists eliminado_por uuid;
alter table public.clientes add column if not exists codigo_cliente_eliminado text;

comment on column public.clientes.eliminado_at is
  'P2-02: cliente eliminado que se conserva escondido por su historial (no aparece en listas ni búsquedas)';
comment on column public.clientes.codigo_cliente_eliminado is
  'P2-02: el código que tenía al eliminarlo (el código queda libre; esto es solo para consulta)';

create index if not exists idx_clientes_eliminado on public.clientes (eliminado_at) where eliminado_at is not null;

create or replace function public.cliente_eliminar(p_cliente_id uuid, p_usuario_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_cli        record;
  v_saldo      numeric;
  v_en_curso   integer;
  v_historial  boolean := false;
  v_con_cae    boolean;
begin
  select id, codigo_cliente, eliminado_at into v_cli from clientes where id = p_cliente_id for update;
  if not found then
    return jsonb_build_object('resultado', 'no_existe');
  end if;
  if v_cli.eliminado_at is not null then
    return jsonb_build_object('resultado', 'ya_eliminado');
  end if;

  -- Saldo: misma cuenta que v_saldo_clientes (debe − haber del libro mayor)
  select coalesce(sum(debe), 0) - coalesce(sum(haber), 0) into v_saldo
    from cuenta_corriente_clientes where cliente_id = p_cliente_id;
  if abs(v_saldo) >= 0.01 then
    return jsonb_build_object('resultado', 'con_saldo', 'saldo', round(v_saldo, 2));
  end if;

  select count(*) into v_en_curso from pedidos
   where cliente_id = p_cliente_id
     and coalesce(estado, '') not in ('entregado', 'rechazado', 'eliminado', 'sistema_viejo');
  if v_en_curso > 0 then
    return jsonb_build_object('resultado', 'pedidos_en_curso', 'cantidad', v_en_curso);
  end if;

  v_con_cae := exists (select 1 from comprobantes_venta where cliente_id = p_cliente_id and cae is not null);

  -- ¿Tiene historial? (uno por uno: corta en el primero que encuentra)
  if v_con_cae
     or exists (select 1 from pedidos where cliente_id = p_cliente_id) then v_historial := true;
  elsif exists (select 1 from comprobantes_venta where cliente_id = p_cliente_id) then v_historial := true;
  elsif exists (select 1 from pagos_clientes where cliente_id = p_cliente_id) then v_historial := true;
  elsif exists (select 1 from cuenta_corriente_clientes where cliente_id = p_cliente_id) then v_historial := true;
  elsif exists (select 1 from cuenta_corriente_ajustes where cliente_id = p_cliente_id) then v_historial := true;
  elsif exists (select 1 from devoluciones where cliente_id = p_cliente_id) then v_historial := true;
  elsif exists (select 1 from remitos where cliente_id = p_cliente_id) then v_historial := true;
  elsif exists (select 1 from viajes_pagos where cliente_id = p_cliente_id) then v_historial := true;
  elsif exists (select 1 from viajes_paradas where cliente_id = p_cliente_id) then v_historial := true;
  elsif exists (select 1 from viajes_clientes where cliente_id = p_cliente_id) then v_historial := true;
  elsif exists (select 1 from reclamos_devoluciones where cliente_id = p_cliente_id) then v_historial := true;
  elsif exists (select 1 from resultado_operaciones where cliente_id = p_cliente_id) then v_historial := true;
  elsif exists (select 1 from kardex where cliente_id = p_cliente_id) then v_historial := true;
  end if;

  if not v_historial then
    -- Nada que conservar: se borra (la configuración se va en cascada)
    delete from clientes where id = p_cliente_id;
    return jsonb_build_object('resultado', 'borrado', 'codigo', v_cli.codigo_cliente);
  end if;

  -- Con historial: se borra la configuración y el cliente queda escondido
  delete from bonificaciones              where cliente_id = p_cliente_id;
  delete from cliente_proveedor_condicion where cliente_id = p_cliente_id;
  delete from cliente_marca_condicion     where cliente_id = p_cliente_id;
  delete from clientes_zonas              where cliente_id = p_cliente_id;
  delete from precios_calculados          where cliente_id = p_cliente_id;
  delete from metricas_clientes           where cliente_id = p_cliente_id;
  delete from historial_puntajes          where cliente_id = p_cliente_id;

  update clientes
     set activo = false,
         eliminado_at = now(),
         eliminado_por = p_usuario_id,
         codigo_cliente_eliminado = codigo_cliente,
         codigo_cliente = null
   where id = p_cliente_id;

  return jsonb_build_object('resultado', 'escondido', 'codigo', v_cli.codigo_cliente, 'con_cae', v_con_cae);
end;
$fn$;

revoke all on function public.cliente_eliminar(uuid, uuid) from public;
grant execute on function public.cliente_eliminar(uuid, uuid) to service_role;
