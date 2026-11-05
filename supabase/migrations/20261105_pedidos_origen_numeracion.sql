-- ═══════════════════════════════════════════════════════════════════════
-- CARGAR PEDIDO DESDE DEPÓSITO + NÚMERO DE PEDIDO SEGURO (05/11/2026)
--
-- 1) pedidos.origen: de dónde salió el pedido. Por ahora solo se marcan los
--    que se cargan desde la app de Depósito:
--      'deposito_propio'  → el empleado para su cuenta personal
--      'deposito_cliente' → el cliente se armó la mercadería y el empleado la cargó
--    NULL = cualquier otro (ERP, vendedor, mostrador, mail). Los "cargados en
--    depósito" no van a la cola de preparación (ya están armados), se facturan
--    estando en "pendiente" y al facturar pasan directo a "entregado".
--
-- 2) Número de pedido atómico: pedido_numero_reservar() (como
--    numeracion_reservar de los comprobantes). Antes cada puerta (ERP,
--    vendedor, mostrador, mail) leía el último número y le sumaba 1: dos a la
--    vez podían salir con el mismo número. Ahora el número sale de una
--    secuencia de la base que arranca después del más alto que ya existe, y se
--    saltea cualquier número que ya esté usado. Nunca se repite.
--
-- 3) Índice único sobre numero_pedido, SOLO si hoy no hay repetidos. Si los
--    hay, la migración no falla: avisa (NOTICE) y deja el índice sin crear.
--    Para ver los repetidos:
--      SELECT numero_pedido, count(*) FROM pedidos
--       WHERE numero_pedido IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
--
-- No toca ningún dato existente. IDEMPOTENTE: se puede correr dos veces.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1) Origen del pedido ───────────────────────────────────────────────
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS origen text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pedidos_origen_check') THEN
    ALTER TABLE public.pedidos
      ADD CONSTRAINT pedidos_origen_check CHECK (origen IS NULL OR origen IN ('deposito_propio', 'deposito_cliente'));
  END IF;
END $$;

COMMENT ON COLUMN public.pedidos.origen IS
  'De dónde salió el pedido: deposito_propio / deposito_cliente (cargado en la app de Depósito, ya armado: no va a la cola y al facturar pasa a entregado). NULL = ERP, vendedor, mostrador o mail.';

-- ─── 2) Número de pedido atómico ────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.pedidos_numero_seq AS bigint MINVALUE 1;

-- Arranca después del número más alto que ya existe (sin bajar nunca la secuencia)
DO $$
DECLARE
  v_max bigint;
  v_seq bigint;
  v_llamada boolean;
BEGIN
  SELECT COALESCE(max(n), 0) INTO v_max
    FROM (
      SELECT NULLIF(regexp_replace(numero_pedido, '[^0-9]', '', 'g'), '') AS d
        FROM public.pedidos
       WHERE numero_pedido IS NOT NULL
    ) s
    CROSS JOIN LATERAL (SELECT CASE WHEN length(s.d) <= 15 THEN s.d::bigint END AS n) x;
  SELECT last_value, is_called INTO v_seq, v_llamada FROM public.pedidos_numero_seq;
  IF NOT v_llamada THEN v_seq := 0; END IF;
  IF v_max > v_seq THEN
    PERFORM setval('public.pedidos_numero_seq', v_max, true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.pedido_numero_reservar()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_num bigint;
  v_txt text;
BEGIN
  -- nextval es atómico: dos llamadas a la vez nunca reciben el mismo número.
  -- Se saltean los que ya existen (cargados a mano o por una puerta vieja).
  LOOP
    v_num := nextval('public.pedidos_numero_seq');
    v_txt := lpad(v_num::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM pedidos WHERE numero_pedido = v_txt);
  END LOOP;
  RETURN v_txt;
END;
$$;

COMMENT ON FUNCTION public.pedido_numero_reservar() IS
  'Reserva el próximo número de pedido (6 dígitos) sin repetir: secuencia pedidos_numero_seq, saltea los ya usados. La usan todas las puertas (lib/utils/next-order-number.ts).';

REVOKE ALL ON FUNCTION public.pedido_numero_reservar() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pedido_numero_reservar() TO authenticated, service_role;

-- ─── 3) Índice único (solo si no hay repetidos) ─────────────────────────
DO $$
DECLARE
  v_rep integer;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ux_pedidos_numero_pedido') THEN
    RETURN;
  END IF;
  SELECT count(*) INTO v_rep FROM (
    SELECT numero_pedido FROM public.pedidos
     WHERE numero_pedido IS NOT NULL
     GROUP BY numero_pedido HAVING count(*) > 1
  ) d;
  IF v_rep > 0 THEN
    RAISE NOTICE 'Hay % números de pedido repetidos: el índice único NO se creó. Ver la consulta del encabezado.', v_rep;
  ELSE
    CREATE UNIQUE INDEX ux_pedidos_numero_pedido ON public.pedidos (numero_pedido) WHERE numero_pedido IS NOT NULL;
  END IF;
END $$;

-- Verificación (debe devolver la columna, la función y, si no había repetidos, el índice)
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'pedidos' AND column_name = 'origen') AS columna_origen,
  (SELECT count(*) FROM pg_proc WHERE proname = 'pedido_numero_reservar') AS funcion_numero,
  (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ux_pedidos_numero_pedido') AS indice_unico,
  (SELECT last_value FROM public.pedidos_numero_seq) AS ultimo_numero;
