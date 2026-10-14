-- ═══════════════════════════════════════════════════════════════════════
-- JARVIS · Etapa 4: acciones conectadas + recordatorios por persona.
--
-- 1. Recordatorios por persona (decisión de Juan, 14/10/2026):
--    para_usuario = a quién le aparece. NULL = para todos.
--    Propuestas: siempre para todos (son decisiones de la empresa).
-- 2. "Retener entregas" a nivel CLIENTE: hasta hoy el bloqueo existía solo
--    por parada de un viaje (viajes_paradas.bloquear_entrega). Con esto, la
--    parada de un cliente retenido nace bloqueada ("NO ENTREGAR SIN COBRAR" +
--    cobrar lo anterior) cada vez que se arma un viaje. Lo activa/desactiva
--    una persona (con un Sí en la agenda de Jarvis o desde Ajustes de Jarvis);
--    quién y cuándo queda en las columnas y en la bitácora (ai_registro).
--
-- ADITIVA e IDEMPOTENTE.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.ai_agenda_events ADD COLUMN IF NOT EXISTS para_usuario UUID;
-- Los recordatorios que ya existen quedan para quien los pidió.
UPDATE public.ai_agenda_events SET para_usuario = creado_por
  WHERE event_type = 'recordatorio' AND para_usuario IS NULL AND creado_por IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_agenda_para ON public.ai_agenda_events (para_usuario) WHERE status = 'pendiente';

ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS retener_entregas BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retener_motivo   TEXT,
  ADD COLUMN IF NOT EXISTS retener_desde    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retener_por      UUID;
CREATE INDEX IF NOT EXISTS idx_clientes_retenidos ON public.clientes (id) WHERE retener_entregas;
