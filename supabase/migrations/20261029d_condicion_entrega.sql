-- ═══════════════════════════════════════════════════════════════════════
-- FORMA DE ENTREGA: DEL CLIENTE AL PEDIDO, UN SOLO "RETIRA" Y FLETE EN
-- ORIGEN/DESTINO (P2-39, P2-09 y P2-07 · 2ª prueba integral, 29/10/2026)
--
-- P2-39: el pedido nacía sin forma de entrega (desde el 01/10, 358 de 361
--   pedidos la tienen vacía): un cliente que retira en mostrador no aparecía en
--   /mostrador "Para retirar" y su pedido podía subirse a un viaje. Ahora, al
--   crearse un pedido sin forma de entrega, copia la del cliente (sirve para
--   todas las altas: app vendedor, ERP, mails, importación, mostrador).
--   Los pedidos que ya existen NO se tocan (las pantallas usan la del cliente
--   cuando el pedido no la tiene).
--
-- P2-09: "retira en mostrador" estaba en dos datos que no coincidían
--   (condicion_entrega = 'retira_mostrador' pero retira_en_deposito = false, y el
--   precio miraba retira_en_deposito para no cobrar flete). Ahora quedan siempre
--   sincronizados: cambiar uno cambia el otro. Esta migración pone en true el
--   retira_en_deposito de los clientes que retiran en mostrador (hoy 8).
--   OJO: a esos clientes los precios manuales dejan de sumarles el flete de su
--   zona (es lo que corresponde: retiran ellos).
--
-- P2-07: cliente con "Envío por transporte": nuevo dato flete_pago = 'origen'
--   (lo pagamos nosotros al despachar) o 'destino' (lo paga el cliente al
--   recibir). Está en el cliente y se copia al pedido igual que la forma de
--   entrega. Si la forma de entrega no es transporte, queda vacío.
--
-- IDEMPOTENTE.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.clientes add column if not exists flete_pago text;
alter table public.pedidos  add column if not exists flete_pago text;

do $$ begin
  alter table public.clientes add constraint clientes_flete_pago_chk check (flete_pago in ('origen', 'destino'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.pedidos add constraint pedidos_flete_pago_chk check (flete_pago in ('origen', 'destino'));
exception when duplicate_object then null; end $$;

comment on column public.clientes.flete_pago is
  'P2-07: con envío por transporte, quién paga el flete: origen (nosotros al despachar) / destino (el cliente al recibir)';
comment on column public.pedidos.flete_pago is
  'P2-07: copiado del cliente al crear el pedido (ver clientes.flete_pago)';

-- ─── Cliente: condicion_entrega y retira_en_deposito siempre iguales (P2-09) ───
create or replace function public.trg_clientes_entrega_sync()
returns trigger
language plpgsql as $fn$
begin
  if tg_op = 'INSERT' then
    if new.condicion_entrega is null and coalesce(new.retira_en_deposito, false) then
      new.condicion_entrega := 'retira_mostrador';
    end if;
    new.retira_en_deposito := coalesce(new.condicion_entrega = 'retira_mostrador', false);
  elsif new.condicion_entrega is distinct from old.condicion_entrega then
    -- Manda la forma de entrega
    new.retira_en_deposito := coalesce(new.condicion_entrega = 'retira_mostrador', false);
  elsif new.retira_en_deposito is distinct from old.retira_en_deposito then
    -- Cambiaron solo el tilde de "retira" (pantallas viejas)
    if coalesce(new.retira_en_deposito, false) then
      new.condicion_entrega := 'retira_mostrador';
    elsif old.condicion_entrega = 'retira_mostrador' then
      new.condicion_entrega := 'entregamos_nosotros';
    end if;
    new.retira_en_deposito := coalesce(new.retira_en_deposito, false);
  end if;
  if new.condicion_entrega is distinct from 'transporte' then
    new.flete_pago := null;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_clientes_entrega_sync on public.clientes;
create trigger trg_clientes_entrega_sync
  before insert or update of condicion_entrega, retira_en_deposito, flete_pago on public.clientes
  for each row execute function public.trg_clientes_entrega_sync();

-- Clientes existentes: poner retira_en_deposito igual a la forma de entrega
update public.clientes
   set retira_en_deposito = coalesce(condicion_entrega = 'retira_mostrador', false)
 where retira_en_deposito is distinct from coalesce(condicion_entrega = 'retira_mostrador', false);

-- ─── Pedido nuevo: copia la forma de entrega (y quién paga el flete) del cliente (P2-39, P2-07) ───
create or replace function public.trg_pedidos_entrega_del_cliente()
returns trigger
language plpgsql as $fn$
declare
  v_cond  text;
  v_flete text;
begin
  if new.cliente_id is null then
    return new;
  end if;
  select condicion_entrega, flete_pago into v_cond, v_flete from public.clientes where id = new.cliente_id;
  if new.condicion_entrega is null then
    new.condicion_entrega := v_cond;
  end if;
  if new.flete_pago is null and new.condicion_entrega = 'transporte' and v_cond = 'transporte' then
    new.flete_pago := v_flete;
  end if;
  if new.condicion_entrega is distinct from 'transporte' then
    new.flete_pago := null;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_pedidos_entrega_del_cliente on public.pedidos;
create trigger trg_pedidos_entrega_del_cliente
  before insert on public.pedidos
  for each row execute function public.trg_pedidos_entrega_del_cliente();

-- Verificación:
-- select condicion_entrega, retira_en_deposito, count(*) from clientes group by 1,2;  -- retira_mostrador ↔ true
