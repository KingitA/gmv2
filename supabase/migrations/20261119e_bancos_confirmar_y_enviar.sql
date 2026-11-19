-- =====================================================================
-- Tanda 2-A (segunda parte) — la orden de pago se confirma sola cuando el banco confirma la
-- firma, se le manda al proveedor, y el estado de las operaciones se consulta cada 15 minutos.
--
-- Decisión de Juan (19/11/2026): «Si, se confirma como pagada cuando el banco confirma la
-- transferencia y se envia la orden de pago en caso de tener alguien a quien mandarselo, sino,
-- queda cerrada sin enviar.»
--
-- Requiere 20261119d_bancos_operaciones.sql. Idempotente: se puede correr más de una vez.
--
-- 1) ordenes_pago: constancia de que la confirmó el sistema por la firma del banco.
-- 2) ordenes_pago_envios: registro de cada envío de la orden al proveedor (a quién, cuándo,
--    si fue en modo prueba, o por qué no se pudo).
-- 3) Consulta periódica: cada 15 minutos, en horario bancario, la base le pide al sistema que
--    actualice las operaciones que esperan la firma. Queda APAGADA hasta que se cargue la
--    dirección y la clave (ver el final de este archivo).
-- =====================================================================

-- ─── 1) Confirmada por el banco ──────────────────────────────────────────────────────────────
ALTER TABLE public.ordenes_pago ADD COLUMN IF NOT EXISTS confirmada_por_banco_at timestamptz;
ALTER TABLE public.ordenes_pago ADD COLUMN IF NOT EXISTS confirmada_por_banco_operacion_id uuid;
COMMENT ON COLUMN public.ordenes_pago.confirmada_por_banco_at IS
  'Si tiene fecha: la orden la confirmó el SISTEMA cuando el banco confirmó la firma (no una persona con el tilde verde). confirmado_por = quien mandó el pago al banco.';
COMMENT ON COLUMN public.ordenes_pago.confirmada_por_banco_operacion_id IS
  'La operación de bancos_operaciones cuya confirmación disparó la confirmación de la orden (ahí está quién la mandó y cuándo).';

-- ─── 2) Envíos de la orden de pago al proveedor ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ordenes_pago_envios (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_pago_id     uuid REFERENCES public.ordenes_pago(id) ON DELETE SET NULL,
  orden_pago_numero text,
  proveedor_id      uuid,
  -- enviada = el mail salió · sin_mail = el proveedor no tiene a quién mandárselo · fallo = no se pudo
  estado            text NOT NULL CHECK (estado IN ('enviada', 'sin_mail', 'fallo')),
  -- banco = al confirmarse sola · confirmacion = al confirmar con el tilde verde · manual = botón enviar / reintentar
  origen            text NOT NULL CHECK (origen IN ('banco', 'confirmacion', 'manual')),
  enviado_a         text,                       -- a quién salió DE VERDAD (en modo prueba, la dirección de prueba)
  habria_ido_a      text,                       -- los mails del proveedor
  modo_prueba       boolean NOT NULL DEFAULT false,
  cuenta_envio      text,
  mensaje_id        text,
  adjuntos          text[],
  error             text,
  creado_at         timestamptz NOT NULL DEFAULT now(),
  creado_por        uuid
);
CREATE INDEX IF NOT EXISTS ordenes_pago_envios_por_orden ON public.ordenes_pago_envios (orden_pago_id, creado_at DESC);
COMMENT ON TABLE public.ordenes_pago_envios IS
  'Registro de cada envío de una orden de pago al proveedor por mail: a quién salió, cuándo, si fue en modo prueba (compras_envio_ajustes), o por qué no se pudo. La orden queda pagada igual aunque el mail falle.';

ALTER TABLE public.ordenes_pago_envios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ordenes_pago_envios FROM anon, authenticated;
GRANT ALL ON TABLE public.ordenes_pago_envios TO service_role;

-- ─── 3) Consulta periódica al banco ──────────────────────────────────────────────────────────
-- Una sola fila. Mientras url o secreto estén vacíos, o activo = false, la consulta no hace nada.
CREATE TABLE IF NOT EXISTS public.bancos_consulta_ajustes (
  id             boolean PRIMARY KEY DEFAULT true CHECK (id),
  url            text,          -- https://<dominio del sistema>/api/cron/bancos-credicoop
  secreto        text,          -- el mismo valor que la variable CRON_SECRET del sistema
  activo         boolean NOT NULL DEFAULT true,
  ultima_at      timestamptz,
  actualizado_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.bancos_consulta_ajustes (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
COMMENT ON TABLE public.bancos_consulta_ajustes IS
  'A dónde llama la base cada 15 minutos para que el sistema actualice las operaciones de Credicoop que esperan la firma. Solo la ve el rol de servicio.';

ALTER TABLE public.bancos_consulta_ajustes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bancos_consulta_ajustes FROM anon, authenticated;
GRANT ALL ON TABLE public.bancos_consulta_ajustes TO service_role;

-- Llama al sistema (ruta /api/cron/bancos-credicoop) SOLO en horario bancario de la Argentina
-- (lunes a viernes de 8 a 20) y solo si hay algo esperando. Devuelve qué hizo, en palabras.
CREATE OR REPLACE FUNCTION public.bancos_consulta_periodica() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_aj record;
  v_ahora timestamp := now() AT TIME ZONE 'America/Argentina/Buenos_Aires';
BEGIN
  IF extract(isodow FROM v_ahora) > 5 OR extract(hour FROM v_ahora) < 8 OR extract(hour FROM v_ahora) >= 20 THEN
    RETURN 'fuera del horario bancario';
  END IF;
  SELECT * INTO v_aj FROM bancos_consulta_ajustes WHERE id;
  IF NOT FOUND OR NOT v_aj.activo OR coalesce(trim(v_aj.url), '') = '' OR coalesce(trim(v_aj.secreto), '') = '' THEN
    RETURN 'sin configurar (falta la dirección o la clave en bancos_consulta_ajustes)';
  END IF;
  -- ¿Hay algo que consultar? Operaciones del banco real sin terminar, u órdenes pendientes con el banco ya hecho
  IF NOT EXISTS (SELECT 1 FROM bancos_operaciones WHERE estado IN ('enviada_a_firma', 'en_proceso', 'error') AND creado_at > now() - interval '15 days')
     AND NOT EXISTS (SELECT 1 FROM bancos_operaciones b JOIN ordenes_pago o ON o.id = b.orden_pago_id
                      WHERE b.ambiente = 'produccion' AND b.estado IN ('firmada', 'acreditada') AND o.estado = 'pendiente') THEN
    RETURN 'nada esperando';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RETURN 'pg_net no está instalado: la base no puede llamar al sistema';
  END IF;
  EXECUTE 'SELECT net.http_get(url := $1, headers := $2, timeout_milliseconds := 60000)'
    USING trim(v_aj.url), jsonb_build_object('Authorization', 'Bearer ' || trim(v_aj.secreto));
  UPDATE bancos_consulta_ajustes SET ultima_at = now() WHERE id;
  RETURN 'consulta pedida';
END $$;
REVOKE ALL ON FUNCTION public.bancos_consulta_periodica() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bancos_consulta_periodica() TO service_role;

-- Programación: cada 15 minutos (la función misma se fija si es horario bancario).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'gm_bancos_consulta_periodica';
    PERFORM cron.schedule('gm_bancos_consulta_periodica', '*/15 * * * *', 'SELECT public.bancos_consulta_periodica()');
  ELSE
    RAISE NOTICE 'pg_cron no está instalado: el estado de las operaciones del banco se actualiza solo al tocar "Actualizar estado".';
  END IF;
END $$;

-- ─── Para ENCENDER la consulta periódica (una sola vez, a mano) ──────────────────────────────
--   UPDATE public.bancos_consulta_ajustes
--      SET url = 'https://<dominio del sistema>/api/cron/bancos-credicoop',
--          secreto = '<el valor de CRON_SECRET>', actualizado_at = now()
--    WHERE id;
-- Probar:      SELECT public.bancos_consulta_periodica();
-- Ver el job:  SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'gm_bancos_consulta_periodica';
-- Apagar:      UPDATE public.bancos_consulta_ajustes SET activo = false WHERE id;
