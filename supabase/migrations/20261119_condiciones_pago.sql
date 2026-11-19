-- ═══════════════════════════════════════════════════════════════════════
-- CONDICIONES DE PAGO NUEVAS + CÓDIGO POSTAL DEL CLIENTE (fase 1 de 4, 19/11/2026)
--
-- Qué pasaba: clientes.condicion_pago era un texto suelto ("Efectivo",
-- "Transferencia", "Cheque 30 días", "Cheque al día", "Cheque 30/60/90") que
-- mezclaba CUÁNDO paga el cliente con CÓMO paga. Los pedidos y comprobantes no
-- guardaban nada de eso, y el cliente no tenía código postal propio.
--
-- Qué decidió Juan:
--   * CONDICIÓN (cuándo paga): condicion_pago_tipo = contado | cuenta_corriente | anticipado,
--     con plazo_dias solo en cuenta corriente (contado y anticipado = 0).
--   * FORMA (cómo paga): forma_pago = efectivo | transferencia | cheque, y con cheque
--     cheque_dias_desde / cheque_dias_hasta (30–30 = cheque a 30 días; 0–0 = al día;
--     60–90 = muchos cheques escalonados). Los días cuentan desde el VENCIMIENTO de
--     la deuda (fecha del comprobante + plazo_dias).
--   * clientes.codigo_postal: campo nuevo de la ficha (si está vacío, la pantalla
--     propone el de la localidad; el remito usa el de la localidad si falta).
--
-- Qué hace:
--   1) Columnas nuevas en clientes; las mismas en pedidos con sufijo _pedido (las
--      llena la fase 2); comprobantes_venta.condicion_pago_texto (fecha_vencimiento
--      ya existe).
--   2) Pasa los clientes actuales: todos CONTADO según su texto viejo
--      (Efectivo → efectivo; Transferencia → transferencia; Cheque 30 días → cheque
--      30–30; Cheque al día → cheque 0–0; Cheque 30/60/90 → cheque 30–90). Sin texto
--      o con un texto que no se reconoce → queda vacío (nunca un valor supuesto).
--      Solo completa los que todavía no tienen condición nueva.
--   3) Compatibilidad con las APK instaladas y la importación de Excel, que siguen
--      mandando SOLO el texto viejo: un disparador lo traduce a los campos nuevos.
--      Y al revés: si se cargan los campos nuevos, el texto viejo queda legible
--      ("Efectivo", "Cheque 30 días"… o "Cuenta corriente 30 días · Efectivo").
--   4) NO FRENA NADA: el disparador acomoda lo incoherente (plazo sin cuenta
--      corriente, días de cheque sin cheque, hasta menor que desde) en vez de
--      rechazar el alta o el pedido. clientes.condicion_pago (texto viejo) NO se borra.
--
-- Misma tabla de traducción que lib/clientes/condicion-pago.ts. IDEMPOTENTE.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1) Columnas ───
alter table public.clientes add column if not exists condicion_pago_tipo text;
alter table public.clientes add column if not exists plazo_dias integer;
alter table public.clientes add column if not exists forma_pago text;
alter table public.clientes add column if not exists cheque_dias_desde integer;
alter table public.clientes add column if not exists cheque_dias_hasta integer;
alter table public.clientes add column if not exists codigo_postal text;

alter table public.pedidos add column if not exists condicion_pago_tipo_pedido text;
alter table public.pedidos add column if not exists plazo_dias_pedido integer;
alter table public.pedidos add column if not exists forma_pago_pedido text;
alter table public.pedidos add column if not exists cheque_dias_desde_pedido integer;
alter table public.pedidos add column if not exists cheque_dias_hasta_pedido integer;

alter table public.comprobantes_venta add column if not exists condicion_pago_texto text;

do $$ begin
  alter table public.clientes add constraint clientes_condicion_pago_tipo_chk
    check (condicion_pago_tipo in ('contado', 'cuenta_corriente', 'anticipado'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.clientes add constraint clientes_forma_pago_chk
    check (forma_pago in ('efectivo', 'transferencia', 'cheque'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.pedidos add constraint pedidos_condicion_pago_tipo_pedido_chk
    check (condicion_pago_tipo_pedido in ('contado', 'cuenta_corriente', 'anticipado'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.pedidos add constraint pedidos_forma_pago_pedido_chk
    check (forma_pago_pedido in ('efectivo', 'transferencia', 'cheque'));
exception when duplicate_object then null; end $$;

comment on column public.clientes.condicion_pago_tipo is 'Cuándo paga: contado (al recibir) / cuenta_corriente (a plazo_dias de la factura) / anticipado (antes de la entrega). Vacío = sin cargar';
comment on column public.clientes.plazo_dias is 'Días de cuenta corriente (vencimiento = fecha del comprobante + plazo). Contado y anticipado = 0';
comment on column public.clientes.forma_pago is 'Cómo paga: efectivo / transferencia / cheque. Vacío = sin cargar';
comment on column public.clientes.cheque_dias_desde is 'Con cheque: días desde el VENCIMIENTO de la deuda (0 = al día). 30–30 = cheque a 30 días';
comment on column public.clientes.cheque_dias_hasta is 'Con cheque: hasta cuántos días (>= desde). 60–90 = cheques escalonados de 60 a 90 días';
comment on column public.clientes.codigo_postal is 'Código postal del cliente (si falta, el remito usa el de la localidad)';
comment on column public.clientes.condicion_pago is 'TEXTO VIEJO (lo siguen leyendo/mandando las APK instaladas). Se mantiene solo desde condicion_pago_tipo / forma_pago y viceversa (trg_clientes_condicion_pago)';
comment on column public.pedidos.condicion_pago_tipo_pedido is 'Condición de pago de este pedido (copiada de la ficha, se puede cambiar): fase 2';
comment on column public.comprobantes_venta.condicion_pago_texto is 'Condición de pago impresa en el comprobante ("Cuenta corriente 30 días · Efectivo"): fase 2';

-- ─── Traducción texto viejo → campos nuevos (misma tabla que lib/clientes/condicion-pago.ts) ───
create or replace function public.condicion_pago_desde_texto(
  p_texto text,
  out condicion_pago_tipo text, out plazo_dias integer, out forma_pago text,
  out cheque_dias_desde integer, out cheque_dias_hasta integer)
language sql immutable as $fn$
  select coalesce(t.tipo, case when n.dias is not null then 'contado' end),
         coalesce(t.plazo, case when n.dias is not null then 0 end),
         coalesce(t.forma, case when n.dias is not null then 'cheque' end),
         coalesce(t.desde, n.dias),
         coalesce(t.hasta, n.dias)
  from (select btrim(lower(regexp_replace(translate(coalesce(p_texto, ''), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'), '\s+', ' ', 'g'))) as k) x
  left join (values
    ('efectivo',        'contado', 0, 'efectivo',      null::int, null::int),
    ('transferencia',   'contado', 0, 'transferencia', null,      null),
    ('cheque al dia',   'contado', 0, 'cheque',        0,         0),
    ('cheque 30 dias',  'contado', 0, 'cheque',        30,        30),
    ('cheque 30/60/90', 'contado', 0, 'cheque',        30,        90)
  ) as t(clave, tipo, plazo, forma, desde, hasta) on t.clave = x.k
  -- "Cheque 45 días" / "cheque a 45 dias" (escrito a mano en una APK o un Excel)
  left join lateral (select (regexp_match(x.k, '^cheques? (?:a )?(\d{1,3}) dias?$'))[1]::int as dias) n on t.clave is null
$fn$;

comment on function public.condicion_pago_desde_texto(text) is
  'Texto viejo de condición de pago → condición/forma nuevas. Texto no reconocido = todo vacío';

-- ─── Campos nuevos → texto legible ───
create or replace function public.condicion_pago_texto(
  p_tipo text, p_plazo integer, p_forma text, p_desde integer, p_hasta integer)
returns text language sql immutable as $fn$
  select nullif(concat_ws(' · ',
    case p_tipo
      when 'contado' then 'Contado'
      when 'anticipado' then 'Anticipado'
      when 'cuenta_corriente' then case when coalesce(p_plazo, 0) > 0 then 'Cuenta corriente ' || p_plazo || ' días' else 'Cuenta corriente' end
    end,
    case p_forma
      when 'efectivo' then 'Efectivo'
      when 'transferencia' then 'Transferencia'
      when 'cheque' then
        case
          when p_desde is null and p_hasta is null then 'Cheque'
          when coalesce(p_desde, p_hasta) = coalesce(p_hasta, p_desde) then
            case when coalesce(p_desde, p_hasta) = 0 then 'Cheque al día' else 'Cheque a ' || coalesce(p_desde, p_hasta) || ' días' end
          when coalesce(p_desde, 0) = 0 then 'Cheques del día a ' || p_hasta || ' días'
          else 'Cheques de ' || p_desde || ' a ' || p_hasta || ' días'
        end
    end), '')
$fn$;

comment on function public.condicion_pago_texto(text, integer, text, integer, integer) is
  '"Contado · Efectivo", "Cuenta corriente 30 días · Cheques de 60 a 90 días". Lo usan las fases siguientes para comprobantes';

-- ─── Campos nuevos → texto viejo para las APK (nombre viejo si es contado y existe; si no, el texto nuevo) ───
create or replace function public.condicion_pago_texto_viejo(
  p_tipo text, p_plazo integer, p_forma text, p_desde integer, p_hasta integer)
returns text language sql immutable as $fn$
  select case
    when p_tipo = 'contado' and p_forma = 'efectivo' then 'Efectivo'
    when p_tipo = 'contado' and p_forma = 'transferencia' then 'Transferencia'
    when p_tipo = 'contado' and p_forma = 'cheque' and p_desde = 0 and p_hasta = 0 then 'Cheque al día'
    when p_tipo = 'contado' and p_forma = 'cheque' and p_desde = 30 and p_hasta = 30 then 'Cheque 30 días'
    when p_tipo = 'contado' and p_forma = 'cheque' and p_desde = 30 and p_hasta = 90 then 'Cheque 30/60/90'
    else public.condicion_pago_texto(p_tipo, p_plazo, p_forma, p_desde, p_hasta)
  end
$fn$;

-- ─── Vencimiento de la deuda (fases 2 y 3) ───
create or replace function public.vencimiento_deuda(p_fecha date, p_plazo_dias integer)
returns date language sql immutable as $fn$
  select p_fecha + greatest(coalesce(p_plazo_dias, 0), 0)
$fn$;

comment on function public.vencimiento_deuda(date, integer) is
  'Vencimiento = fecha del comprobante + plazo_dias (contado/anticipado: el mismo día)';

-- ─── 3) Disparador de compatibilidad (clientes) ───
create or replace function public.trg_clientes_condicion_pago()
returns trigger
language plpgsql as $fn$
declare
  v record;
  v_nuevos_cambiaron boolean;
  v_texto_cambio boolean;
  v_dias integer;
begin
  if tg_op = 'INSERT' then
    v_nuevos_cambiaron := new.condicion_pago_tipo is not null or new.forma_pago is not null;
    v_texto_cambio := not v_nuevos_cambiaron and new.condicion_pago is not null;
  else
    v_nuevos_cambiaron :=
         new.condicion_pago_tipo is distinct from old.condicion_pago_tipo
      or new.plazo_dias        is distinct from old.plazo_dias
      or new.forma_pago        is distinct from old.forma_pago
      or new.cheque_dias_desde is distinct from old.cheque_dias_desde
      or new.cheque_dias_hasta is distinct from old.cheque_dias_hasta;
    v_texto_cambio := not v_nuevos_cambiaron and new.condicion_pago is distinct from old.condicion_pago;
  end if;

  -- Llegó solo el texto viejo (APK instalada, Excel, /api/vendedor/clientes): traducir
  if v_texto_cambio then
    select * into v from public.condicion_pago_desde_texto(new.condicion_pago);
    if v.condicion_pago_tipo is not null then
      new.condicion_pago_tipo := v.condicion_pago_tipo;
      new.plazo_dias := v.plazo_dias;
      new.forma_pago := v.forma_pago;
      new.cheque_dias_desde := v.cheque_dias_desde;
      new.cheque_dias_hasta := v.cheque_dias_hasta;
    elsif new.condicion_pago is null or btrim(new.condicion_pago) = '' then
      -- Borraron la condición: vacío
      new.condicion_pago_tipo := null; new.plazo_dias := null; new.forma_pago := null;
      new.cheque_dias_desde := null; new.cheque_dias_hasta := null;
    end if;
    -- Texto no reconocido: los campos nuevos quedan como estaban (no se inventa nada)
    return new;
  end if;

  if v_nuevos_cambiaron then
    -- Acomodar sin rechazar (no frenar ningún alta ni pedido)
    if new.condicion_pago_tipo is distinct from 'cuenta_corriente' then
      new.plazo_dias := case when new.condicion_pago_tipo is null then null else 0 end;
    elsif new.plazo_dias < 0 then
      new.plazo_dias := null;
    end if;
    if new.forma_pago is distinct from 'cheque' then
      new.cheque_dias_desde := null; new.cheque_dias_hasta := null;
    else
      if new.cheque_dias_desde < 0 then new.cheque_dias_desde := null; end if;
      if new.cheque_dias_hasta < 0 then new.cheque_dias_hasta := null; end if;
      new.cheque_dias_desde := coalesce(new.cheque_dias_desde, new.cheque_dias_hasta);
      new.cheque_dias_hasta := coalesce(new.cheque_dias_hasta, new.cheque_dias_desde);
      if new.cheque_dias_hasta < new.cheque_dias_desde then
        -- Cargado al revés (90 a 60): se dan vuelta
        v_dias := new.cheque_dias_desde;
        new.cheque_dias_desde := new.cheque_dias_hasta;
        new.cheque_dias_hasta := v_dias;
      end if;
    end if;
    -- Texto viejo legible para las APK instaladas
    new.condicion_pago := public.condicion_pago_texto_viejo(
      new.condicion_pago_tipo, new.plazo_dias, new.forma_pago, new.cheque_dias_desde, new.cheque_dias_hasta);
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_clientes_condicion_pago on public.clientes;
create trigger trg_clientes_condicion_pago
  before insert or update of condicion_pago, condicion_pago_tipo, plazo_dias, forma_pago, cheque_dias_desde, cheque_dias_hasta
  on public.clientes
  for each row execute function public.trg_clientes_condicion_pago();

-- ─── 2) Pase de los clientes actuales (solo los que no tienen condición nueva) ───
update public.clientes c
   set condicion_pago_tipo = t.condicion_pago_tipo,
       plazo_dias          = t.plazo_dias,
       forma_pago          = t.forma_pago,
       cheque_dias_desde   = t.cheque_dias_desde,
       cheque_dias_hasta   = t.cheque_dias_hasta
  from (select id, (public.condicion_pago_desde_texto(condicion_pago)).* from public.clientes
         where condicion_pago_tipo is null and forma_pago is null) t
 where c.id = t.id
   and t.condicion_pago_tipo is not null;

-- Verificación (predicción del 19/11: 610 contado/efectivo, 13 contado/transferencia,
-- 9 contado/cheque 30–30, 1 vacío):
-- select condicion_pago_tipo, forma_pago, cheque_dias_desde, cheque_dias_hasta, condicion_pago, count(*)
--   from clientes where eliminado_at is null group by 1,2,3,4,5 order by 6 desc;
