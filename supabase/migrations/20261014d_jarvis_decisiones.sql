-- ═══════════════════════════════════════════════════════════════════════
-- JARVIS · Etapa 3: decisiones, recordatorios y reglas.
--
-- La bandeja de Jarvis (ai_agenda_events) suma:
--   'propuesta'    → Jarvis propone algo; una persona aprieta Sí / No / Recordámelo.
--   'recordatorio' → algo para mirar en una fecha (lo pide una persona o sale de un "Recordámelo").
-- Cada decisión guarda QUIÉN, CUÁNDO y POR QUÉ, y además queda en la bitácora
-- inborrable (ai_registro) por trigger: aunque alguien tocara la bandeja, la
-- historia de decisiones no se pierde.
--
-- Reglas de Jarvis (umbrales de los vigías y notas del negocio) van en
-- ai_ajustes, que ya registra quién cambió qué.
--
-- ADITIVA e IDEMPOTENTE.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.ai_agenda_events
  ADD COLUMN IF NOT EXISTS accion            JSONB,        -- qué se haría con un Sí: {tipo, parametros, descripcion}
  ADD COLUMN IF NOT EXISTS decision          TEXT,         -- si | no | posponer
  ADD COLUMN IF NOT EXISTS decidido_por      UUID,
  ADD COLUMN IF NOT EXISTS decidido_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decision_nota     TEXT,
  ADD COLUMN IF NOT EXISTS ejecucion         JSONB,        -- {estado: ok|error|no_aplica, detalle, at}
  ADD COLUMN IF NOT EXISTS impacto_estimado  NUMERIC,      -- $ que se estima ganar/ahorrar/cobrar
  ADD COLUMN IF NOT EXISTS impacto_real      NUMERIC,      -- $ que pasó de verdad (se completa después)
  ADD COLUMN IF NOT EXISTS origen_id         UUID,         -- aviso o propuesta de la que salió
  ADD COLUMN IF NOT EXISTS conversacion_id   UUID;         -- charla del chat donde se pidió

ALTER TABLE public.ai_agenda_events DROP CONSTRAINT IF EXISTS ai_agenda_events_decision_check;
ALTER TABLE public.ai_agenda_events ADD CONSTRAINT ai_agenda_events_decision_check
  CHECK (decision IS NULL OR decision IN ('si', 'no', 'posponer'));

CREATE INDEX IF NOT EXISTS idx_ai_agenda_pendientes ON public.ai_agenda_events (status, due_date) WHERE status = 'pendiente';
CREATE INDEX IF NOT EXISTS idx_ai_agenda_entidad ON public.ai_agenda_events (related_entity_type, related_entity_id);

-- Bitácora de decisiones: cada vez que se decide algo, queda escrito para siempre.
CREATE OR REPLACE FUNCTION public.ai_agenda_registrar_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.decision IS NOT NULL AND (OLD.decision IS DISTINCT FROM NEW.decision OR OLD.decidido_at IS DISTINCT FROM NEW.decidido_at) THEN
    INSERT INTO ai_registro (usuario_id, accion, entidad_tipo, entidad_id, detalle)
    VALUES (NEW.decidido_por, 'decision_' || NEW.decision, NEW.event_type, NEW.id::text,
            jsonb_build_object('titulo', NEW.title, 'accion', NEW.accion, 'nota', NEW.decision_nota,
                               'nueva_fecha', CASE WHEN NEW.decision = 'posponer' THEN NEW.due_date END,
                               'entidad', jsonb_build_object('tipo', NEW.related_entity_type, 'id', NEW.related_entity_id),
                               'impacto_estimado', NEW.impacto_estimado));
  END IF;
  IF NEW.ejecucion IS DISTINCT FROM OLD.ejecucion AND NEW.ejecucion IS NOT NULL THEN
    INSERT INTO ai_registro (usuario_id, accion, entidad_tipo, entidad_id, detalle)
    VALUES (NEW.decidido_por, 'ejecucion_' || COALESCE(NEW.ejecucion->>'estado', '?'), NEW.event_type, NEW.id::text,
            jsonb_build_object('titulo', NEW.title, 'accion', NEW.accion, 'ejecucion', NEW.ejecucion));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ai_agenda_registrar_decision ON public.ai_agenda_events;
CREATE TRIGGER trg_ai_agenda_registrar_decision
  AFTER UPDATE ON public.ai_agenda_events
  FOR EACH ROW EXECUTE FUNCTION public.ai_agenda_registrar_decision();

-- Lo que se agenda (recordatorios y propuestas) también queda registrado al crearse.
CREATE OR REPLACE FUNCTION public.ai_agenda_registrar_alta() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.event_type IN ('propuesta', 'recordatorio') THEN
    INSERT INTO ai_registro (usuario_id, accion, entidad_tipo, entidad_id, detalle)
    VALUES (NEW.creado_por, NEW.event_type || '_creado', NEW.event_type, NEW.id::text,
            jsonb_build_object('titulo', NEW.title, 'fecha', NEW.due_date, 'accion', NEW.accion, 'origen', NEW.source));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ai_agenda_registrar_alta ON public.ai_agenda_events;
CREATE TRIGGER trg_ai_agenda_registrar_alta
  AFTER INSERT ON public.ai_agenda_events
  FOR EACH ROW EXECUTE FUNCTION public.ai_agenda_registrar_alta();

-- ─── Reglas de Jarvis (valores iniciales; se cambian desde la pantalla) ──
INSERT INTO public.ai_ajustes (clave, valor, descripcion) VALUES
  ('regla_deuda_vencida_minima', '100000', 'Deuda con más de 30 días ($) a partir de la cual Jarvis avisa si el cliente vuelve a pedir.'),
  ('regla_dias_compra_reciente', '3',      '"Volvió a pedir" = pedido en los últimos N días.'),
  ('regla_atraso_habitual',      '1.5',    'Cliente habitual atrasado: días sin comprar dividido días entre compras mayor a este número.'),
  ('regla_cobertura_max_dias',   '7',      'Avisar artículos con stock para menos de N días.'),
  ('regla_venta_diaria_minima',  '2',      'Solo artículos que venden al menos N unidades por día.'),
  ('regla_dias_cobro_sin_verificar', '2',  'Cobros sin verificar en Caja hace más de N días.'),
  ('regla_avisos', '"todo"',               'Qué avisos mostrar: "todo" o "urgentes" (solo los rojos).')
ON CONFLICT (clave) DO NOTHING;
