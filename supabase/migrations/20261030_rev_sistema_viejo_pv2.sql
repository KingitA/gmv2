-- ═══════════════════════════════════════════════════════════════════════
-- REVERSAS DEL SISTEMA VIEJO AL PUNTO DE VENTA 0002 (P2-05, 2ª prueba integral, 30/10/2026)
--
-- Qué pasaba: la apertura de cuentas corrientes cargó 65 REVERSAS del sistema
-- viejo con su número original (0001-00067473 a 0001-00120976). Comparten el
-- punto de venta 0001 con las REV que hace gmv2 (0001-00000001 en adelante) y
-- se mezclan en las listas y en la numeración.
--
-- Qué decidió Juan: las REV del sistema viejo pasan al punto de venta 0002,
-- igual que los PRES viejos (#18). El número no cambia, solo el punto de venta:
-- "0001-00067473" → "0002-00067473". La importación ya las carga así.
--
-- Qué hace:
--   * Solo toca las REV de la apertura (observaciones "APERTURA GM…"), del punto
--     de venta 0001 y SIN CAE. Las REV de gmv2 y todo lo que tenga CAE no se tocan.
--   * Cambia el número y el punto de venta del comprobante, y en sus
--     observaciones deja también el número viejo ("… 0002-00067473 (en el
--     sistema viejo 0001-00067473) migrado …").
--   * Cambia el número en su renglón de la cuenta corriente
--     (cuenta_corriente_clientes) y en el kardex si tuviera alguno.
--   * Las imputaciones apuntan al comprobante por su id: no cambian.
--   * No cambia importes, saldos ni fechas.
--   * Si alguna REV 0002-xxxxxxxx ya existiera con el mismo número, NO hace nada
--     y avisa (para no romper el índice único ux_comprobantes_venta_numero).
--     Verificado en solo lectura el 30/10: no choca ninguna.
--   * No hace falta una fila REV/0002 en numeracion_comprobantes: gmv2 sigue
--     numerando sus REV en el 0001 (numeracion_reservar('REV','0001')), y ahí ya
--     no quedan números viejos.
--
-- IDEMPOTENTE: una segunda vez no encuentra nada que cambiar.
-- ═══════════════════════════════════════════════════════════════════════

do $$
declare
  v_choques  integer;
  v_cambios  integer;
begin
  create temp table p205_rev on commit drop as
  select v.id,
         v.numero_comprobante                                  as viejo,
         '0002-' || split_part(v.numero_comprobante, '-', 2)   as nuevo
    from public.comprobantes_venta v
   where v.tipo_comprobante = 'REV'
     and v.punto_venta = '0001'
     and v.observaciones ilike 'APERTURA GM%'
     and v.cae is null
     and v.numero_comprobante ~ '^0001-[0-9]{8}$';

  select count(*) into v_choques
    from p205_rev m
    join public.comprobantes_venta o
      on o.tipo_comprobante = 'REV' and o.punto_venta = '0002' and o.numero_comprobante = m.nuevo;
  if v_choques > 0 then
    raise exception 'P2-05: % REV 0002-xxxxxxxx ya existen con el mismo número. No se cambió nada: avisar antes de seguir.', v_choques;
  end if;

  -- Cuenta corriente: el renglón de cada REV
  update public.cuenta_corriente_clientes cc
     set numero_comprobante = m.nuevo,
         observaciones = replace(cc.observaciones, m.viejo, m.nuevo)
    from p205_rev m
   where cc.referencia_tipo = 'comprobante_venta'
     and cc.referencia_id = m.id
     and cc.numero_comprobante = m.viejo;

  -- Kardex (hoy ninguno: las REV de la apertura no mueven stock)
  update public.kardex k
     set numero_comprobante = m.nuevo
    from p205_rev m
   where k.comprobante_venta_id = m.id
     and k.numero_comprobante = m.viejo;

  -- El comprobante
  update public.comprobantes_venta v
     set numero_comprobante = m.nuevo,
         punto_venta = '0002',
         observaciones = replace(v.observaciones, ' ' || m.viejo || ' migrado',
                                 ' ' || m.nuevo || ' (en el sistema viejo ' || m.viejo || ') migrado')
    from p205_rev m
   where v.id = m.id;
  get diagnostics v_cambios = row_count;

  raise notice 'P2-05: % REV del sistema viejo pasaron al punto de venta 0002', v_cambios;
end $$;

-- Verificación (tiene que dar 0 en el 0001 de la apertura y 65 en el 0002):
-- select punto_venta, count(*) from comprobantes_venta
--  where tipo_comprobante = 'REV' and observaciones ilike 'APERTURA GM%' group by 1;
