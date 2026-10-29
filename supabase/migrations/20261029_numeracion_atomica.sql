-- ═══════════════════════════════════════════════════════════════════════
-- NUMERACIÓN SIN REPETIDOS (P2-22, 2ª prueba integral, 29/10/2026)
--
-- Qué pasaba: el 28/10 dos pedidos generados casi a la vez (0,2 s de diferencia)
-- salieron los dos como PRES 0001-00000030. El sistema leía el último número,
-- le sumaba 1 y lo guardaba recién al final: dos máquinas a la vez leían el
-- mismo número.
--
-- Qué hace esta migración:
--   1) numeracion_reservar(tipo, pv): reserva el número de un comprobante
--      interno (PRES, REV, etc.) de una sola vez, adentro de la base. Dos
--      máquinas a la vez nunca reciben el mismo: la segunda espera a la primera.
--      Si el número ya existe en comprobantes_venta (p. ej. una copia de la
--      apertura con su número original), lo saltea y toma el siguiente libre.
--   2) Turno fiscal (FA/FB/NC/ND con CAE): numeracion_tomar_turno /
--      numeracion_soltar_turno. Mientras una máquina le pide el CAE a ARCA, las
--      demás del mismo tipo y punto de venta esperan su turno (uno atrás del
--      otro). El turno vence solo a los 90 segundos por si una máquina se cuelga.
--      El número lo sigue dando ARCA (último autorizado + 1): si ARCA rechaza, no
--      se consume ningún número y no quedan huecos.
--   3) Renumera el ÚNICO duplicado que hay hoy: el PRES 0001-00000030 ANULADO de
--      PRUEBA 3 (cliente 90031, dato de la prueba, sin CAE). El vivo queda con su
--      número. Solo toca ese comprobante y sus renglones de cuenta corriente y
--      kardex (que guardan el número como texto).
--   4) Índice único: nunca más dos comprobantes con el mismo tipo + punto de
--      venta + número, anulados incluidos. Única excepción: el "PRES
--      0002-00000001" de respaldo de devoluciones, que es uno por cliente a
--      propósito (ux_comprobantes_venta_respaldo_devolucion).
--
--   5) Candado por pedido al facturar (pedidos.facturando_at): si dos máquinas
--      aprietan "Generar" del MISMO pedido a la vez, la segunda se frena (antes
--      podían facturarlo dos veces).
--
-- No toca ningún comprobante con CAE. IDEMPOTENTE: se puede correr dos veces.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS facturando_at timestamptz;

COMMENT ON COLUMN public.pedidos.facturando_at IS
  'P2-22: cuándo empezó una facturación en curso del pedido (candado; NULL = libre)';

ALTER TABLE public.numeracion_comprobantes
  ADD COLUMN IF NOT EXISTS turno_token uuid,
  ADD COLUMN IF NOT EXISTS turno_hasta timestamptz;

COMMENT ON COLUMN public.numeracion_comprobantes.turno_token IS
  'P2-22: quién tiene el turno para emitir un comprobante fiscal de este tipo y PV (NULL = libre)';
COMMENT ON COLUMN public.numeracion_comprobantes.turno_hasta IS
  'P2-22: hasta cuándo vale el turno; vencido, lo puede tomar otro';

-- ─── 1) Número interno atómico ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.numeracion_reservar(p_tipo text, p_punto_venta text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_num integer;
BEGIN
  -- El UPDATE bloquea la fila: una segunda llamada simultánea espera acá y
  -- después ve el número ya avanzado.
  UPDATE numeracion_comprobantes
     SET ultimo_numero = ultimo_numero + 1, updated_at = now()
   WHERE tipo_comprobante = p_tipo AND punto_venta = p_punto_venta
  RETURNING ultimo_numero INTO v_num;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Numeración no encontrada para % punto de venta %', p_tipo, p_punto_venta;
  END IF;

  -- Saltear números que ya existen (copias de la apertura con su número original)
  WHILE EXISTS (
    SELECT 1 FROM comprobantes_venta
     WHERE tipo_comprobante = p_tipo AND punto_venta = p_punto_venta
       AND numero_comprobante = p_punto_venta || '-' || lpad(v_num::text, 8, '0')
  ) LOOP
    v_num := v_num + 1;
  END LOOP;

  UPDATE numeracion_comprobantes SET ultimo_numero = v_num
   WHERE tipo_comprobante = p_tipo AND punto_venta = p_punto_venta AND ultimo_numero <> v_num;

  RETURN v_num;
END;
$$;

REVOKE ALL ON FUNCTION public.numeracion_reservar(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.numeracion_reservar(text, text) TO authenticated, service_role;

-- ─── 2) Turno fiscal ─────────────────────────────────────────────────────
-- Devuelve el token del turno, o NULL si lo tiene otro (el que llama reintenta).
CREATE OR REPLACE FUNCTION public.numeracion_tomar_turno(p_tipo text, p_punto_venta text, p_segundos integer DEFAULT 90)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token uuid := gen_random_uuid();
BEGIN
  UPDATE numeracion_comprobantes
     SET turno_token = v_token,
         turno_hasta = now() + make_interval(secs => greatest(p_segundos, 10))
   WHERE tipo_comprobante = p_tipo AND punto_venta = p_punto_venta
     AND (turno_token IS NULL OR turno_hasta < now());
  IF FOUND THEN
    RETURN v_token;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM numeracion_comprobantes WHERE tipo_comprobante = p_tipo AND punto_venta = p_punto_venta) THEN
    RAISE EXCEPTION 'Numeración no encontrada para % punto de venta %', p_tipo, p_punto_venta;
  END IF;
  RETURN NULL;
END;
$$;

-- Suelta el turno y deja ultimo_numero igual al último que ARCA tiene autorizado.
-- Si el turno ya venció y lo tomó otro, no toca nada (devuelve false).
CREATE OR REPLACE FUNCTION public.numeracion_soltar_turno(p_tipo text, p_punto_venta text, p_token uuid, p_ultimo_numero integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE numeracion_comprobantes
     SET ultimo_numero = coalesce(p_ultimo_numero, ultimo_numero),
         turno_token = NULL, turno_hasta = NULL, updated_at = now()
   WHERE tipo_comprobante = p_tipo AND punto_venta = p_punto_venta AND turno_token = p_token;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.numeracion_tomar_turno(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.numeracion_soltar_turno(text, text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.numeracion_tomar_turno(text, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.numeracion_soltar_turno(text, text, uuid, integer) TO authenticated, service_role;

-- ─── 3) El duplicado de la prueba (PRES 0001-00000030 anulado, PRUEBA 3) ──
DO $$
DECLARE
  v_id     uuid;
  v_cli    uuid;
  v_viejo  text := '0001-00000030';
  v_nuevo  text;
BEGIN
  SELECT id, cliente_id INTO v_id, v_cli
    FROM comprobantes_venta
   WHERE id = 'c5702f42-041d-4465-aa8e-aab61a8488f3'
     AND tipo_comprobante = 'PRES' AND punto_venta = '0001'
     AND numero_comprobante = v_viejo
     AND anulado_en IS NOT NULL AND cae IS NULL;

  -- Solo si sigue duplicado (si ya se corrió, no hace nada)
  IF v_id IS NOT NULL AND (
       SELECT count(*) FROM comprobantes_venta
        WHERE tipo_comprobante = 'PRES' AND punto_venta = '0001' AND numero_comprobante = v_viejo) > 1 THEN
    v_nuevo := '0001-' || lpad(public.numeracion_reservar('PRES', '0001')::text, 8, '0');

    UPDATE comprobantes_venta
       SET numero_comprobante = v_nuevo,
           observaciones = concat_ws(' · ', nullif(observaciones, ''),
             'Renumerado (antes ' || v_viejo || ', salió repetido por P2-22)')
     WHERE id = v_id;

    UPDATE cuenta_corriente_clientes SET numero_comprobante = v_nuevo
     WHERE cliente_id = v_cli AND numero_comprobante = v_viejo;

    UPDATE kardex SET numero_comprobante = v_nuevo
     WHERE comprobante_venta_id = v_id AND numero_comprobante = v_viejo;

    RAISE NOTICE 'PRES % anulado renumerado a %', v_viejo, v_nuevo;
  END IF;
END $$;

-- ─── 4) Índice único ─────────────────────────────────────────────────────
-- Si quedara otro duplicado, esto falla con el número repetido a la vista
-- (no se crea a medias): avisar antes de seguir.
CREATE UNIQUE INDEX IF NOT EXISTS ux_comprobantes_venta_numero
  ON public.comprobantes_venta (tipo_comprobante, punto_venta, numero_comprobante)
  WHERE NOT (tipo_comprobante = 'PRES' AND numero_comprobante = '0002-00000001');

-- Verificación (debe dar 0 filas):
-- SELECT tipo_comprobante, punto_venta, numero_comprobante, count(*)
--   FROM comprobantes_venta
--  WHERE NOT (tipo_comprobante = 'PRES' AND numero_comprobante = '0002-00000001')
--  GROUP BY 1,2,3 HAVING count(*) > 1;
