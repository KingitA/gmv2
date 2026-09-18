-- =====================================================================
-- App Depósito (com.gm.deposito) — ver MOBILE.md → "Depósito"
-- ADITIVA e IDEMPOTENTE. No modifica ni borra datos existentes.
--
--  1. Triggers del log de cambios (mobile_cambios) sobre las tablas de la cola
--     de trabajo del depósito: los handhelds se enteran en segundos de un
--     pedido nuevo / urgente / renglón tomado por otro operario.
--     Reusan mobile_registrar_cambio() de la fundación: NUNCA bloquean una
--     escritura del ERP (EXCEPTION → WARNING).
--  2. deposito_ajustes_movil: auditoría + segunda defensa de idempotencia de
--     los ajustes de stock hechos desde el handheld.
--
-- La app funciona SIN esta migración (cae a snapshot + refresco periódico);
-- con ella, la cola se actualiza en segundos y los ajustes quedan auditados.
-- =====================================================================

-- ─── 1. Log de cambios ───────────────────────────────────────────────
DO $$
DECLARE t RECORD;
BEGIN
  IF to_regprocedure('public.mobile_registrar_cambio()') IS NULL THEN
    RAISE NOTICE 'Falta la migración 20260918_mobile_fundacion.sql: no se crean triggers.';
    RETURN;
  END IF;
  FOR t IN SELECT * FROM (VALUES
      -- dataset deposito_pedidos (fila = pedido)
      ('pedidos', 'id'),
      ('pedidos_detalle', 'pedido_id'),
      -- solo invalidación (datasets snapshot): recepciones y devoluciones
      ('ordenes_compra', 'id'),
      ('recepciones', 'orden_compra_id'),
      ('recepciones_items', 'recepcion_id'),
      ('devoluciones', 'id')
    ) AS v(tabla, ref)
  LOOP
    IF to_regclass('public.' || t.tabla) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_mobile_cambios ON public.%I', t.tabla);
      EXECUTE format(
        'CREATE TRIGGER trg_mobile_cambios AFTER INSERT OR UPDATE OR DELETE ON public.%I
           FOR EACH ROW EXECUTE FUNCTION public.mobile_registrar_cambio(%L)', t.tabla, t.ref);
    END IF;
  END LOOP;
END $$;

-- Marca inicial: el motor de sync usa delta para deposito_pedidos solo si el log
-- tiene entradas de `pedidos` (así sabe que el trigger existe). El id nulo no
-- corresponde a ningún pedido: el dispositivo lo recibe como un borrado inocuo.
DO $$
BEGIN
  IF to_regclass('public.mobile_cambios') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.mobile_cambios WHERE tabla = 'pedidos') THEN
    INSERT INTO public.mobile_cambios (tabla, registro_id, ref_id, op)
    VALUES ('pedidos', '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'U');
  END IF;
END $$;

-- ─── 2. Ajustes de stock desde el handheld ───────────────────────────
CREATE TABLE IF NOT EXISTS public.deposito_ajustes_movil (
  idempotency_key  UUID          PRIMARY KEY,
  articulo_id      UUID          NOT NULL,
  tipo             TEXT          NOT NULL CHECK (tipo IN ('correccion', 'entrada', 'salida')),
  cantidad         NUMERIC       NOT NULL,
  motivo           TEXT,
  -- stock que mostraba el handheld cuando el operario contó
  stock_visto      NUMERIC,
  -- stock real del servidor al aplicar / después de aplicar (NULL = sin aplicar todavía)
  stock_anterior   NUMERIC,
  stock_nuevo      NUMERIC,
  usuario_id       UUID,
  device_id        TEXT,
  capturado_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deposito_ajustes_movil_articulo ON public.deposito_ajustes_movil (articulo_id, created_at DESC);
-- Solo service role (igual que el resto de las tablas mobile_*)
ALTER TABLE public.deposito_ajustes_movil ENABLE ROW LEVEL SECURITY;
