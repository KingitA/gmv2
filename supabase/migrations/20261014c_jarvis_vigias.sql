-- ═══════════════════════════════════════════════════════════════════════
-- JARVIS · Etapa 2: vigías ("Lo que Jarvis notó") y resumen del día.
--
-- NO se crean tablas nuevas: se recicla ai_agenda_events (la agenda vieja de
-- la IA) como LA bandeja de Jarvis. Ahí va todo lo que Jarvis pone delante de
-- una persona: avisos (esta etapa), propuestas y recordatorios (etapa 3).
--   event_type 'aviso'   = algo que un vigía notó
--   status 'pendiente'   = a la vista
--          'completada'  = se resolvió solo (el vigía dejó de verlo)
--          'cancelada'   = una persona lo descartó (vuelve solo si empeora)
-- El resumen del día y la "foto" diaria de números se guardan en ai_registro
-- (bitácora inborrable): queda la historia de lo que Jarvis dijo cada día.
--
-- ADITIVA e IDEMPOTENTE.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.ai_agenda_events
  ADD COLUMN IF NOT EXISTS clave       TEXT,                       -- identifica "el mismo aviso" entre corridas
  ADD COLUMN IF NOT EXISTS vigia       TEXT,                       -- qué vigía lo generó
  ADD COLUMN IF NOT EXISTS tono        TEXT,                       -- alerta | atencion | oportunidad
  ADD COLUMN IF NOT EXISTS acciones    JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{texto, pregunta}]
  ADD COLUMN IF NOT EXISTS severidad   NUMERIC NOT NULL DEFAULT 0, -- para ordenar (casi siempre: plata en juego)
  ADD COLUMN IF NOT EXISTS creado_por  UUID,                       -- NULL = lo creó Jarvis solo
  ADD COLUMN IF NOT EXISTS cerrado_por UUID,                       -- quién lo descartó / resolvió (NULL = Jarvis)
  ADD COLUMN IF NOT EXISTS cerrado_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cierre_nota TEXT;

ALTER TABLE public.ai_agenda_events DROP CONSTRAINT IF EXISTS ai_agenda_events_event_type_check;
ALTER TABLE public.ai_agenda_events ADD CONSTRAINT ai_agenda_events_event_type_check CHECK (event_type IN (
  'aviso', 'propuesta', 'recordatorio',
  'vencimiento_proveedor', 'pedido_preparar', 'mercaderia_recibir', 'cambio_precio',
  'pago_imputar', 'reclamo_resolver', 'tarea_general'));

ALTER TABLE public.ai_agenda_events DROP CONSTRAINT IF EXISTS ai_agenda_events_source_check;
ALTER TABLE public.ai_agenda_events ADD CONSTRAINT ai_agenda_events_source_check CHECK (source IN ('gmail', 'whatsapp', 'chat', 'sistema', 'jarvis'));

ALTER TABLE public.ai_agenda_events DROP CONSTRAINT IF EXISTS ai_agenda_events_tono_check;
ALTER TABLE public.ai_agenda_events ADD CONSTRAINT ai_agenda_events_tono_check CHECK (tono IS NULL OR tono IN ('alerta', 'atencion', 'oportunidad'));

CREATE INDEX IF NOT EXISTS idx_ai_agenda_clave ON public.ai_agenda_events (clave, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_agenda_bandeja ON public.ai_agenda_events (event_type, status, severidad DESC);

-- Cada cierre hecho por una persona queda en la bitácora inborrable.
CREATE OR REPLACE FUNCTION public.ai_agenda_registrar_cierre() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.cerrado_por IS NOT NULL THEN
    INSERT INTO ai_registro (usuario_id, accion, entidad_tipo, entidad_id, detalle)
    VALUES (NEW.cerrado_por, 'agenda_' || NEW.status, NEW.event_type, NEW.id::text,
            jsonb_build_object('titulo', NEW.title, 'de', OLD.status, 'a', NEW.status, 'nota', NEW.cierre_nota));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ai_agenda_registrar_cierre ON public.ai_agenda_events;
CREATE TRIGGER trg_ai_agenda_registrar_cierre
  AFTER UPDATE ON public.ai_agenda_events
  FOR EACH ROW EXECUTE FUNCTION public.ai_agenda_registrar_cierre();
