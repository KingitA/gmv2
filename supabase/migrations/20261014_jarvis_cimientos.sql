-- ═══════════════════════════════════════════════════════════════════════
-- JARVIS · Etapa 0: cimientos (docs/playroom-cerebro/PLAN.md)
--
-- 1. ai_registro: bitácora INBORRABLE de quién hizo qué y cuándo (decisiones,
--    cambios de reglas y de modelo). Un trigger impide UPDATE y DELETE.
-- 2. ai_ajustes: ajustes de Jarvis (modelo pensador / rápido / respaldo, tope
--    mensual). Se cambian sin tocar código; cada cambio queda en ai_registro.
-- 3. ai_uso: cuánto costó cada llamada a la IA (para el tope y para medir si
--    paga lo que cuesta).
-- 4. ai_conversations / ai_messages (del chat viejo): se reciclan para guardar
--    quién preguntó qué. Se agrega usuario_id.
-- 5. Seguridad: las tablas ai_conversations, ai_messages y ai_agenda_events
--    tenían una política "USING (true)" para TODOS los roles (incluso anónimo):
--    cualquiera con la clave pública podía leerlas o borrarlas. Se quita; el
--    servidor usa la service key, que no pasa por RLS.
-- 6. Limpieza aprobada por Juan (14/10/2026): se borran los avisos viejos del
--    lector de mails en ai_agenda_events (spam de marzo/abril).
--
-- ADITIVA e IDEMPOTENTE salvo el punto 6 (borrado aprobado).
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Bitácora inborrable ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_registro (
  id           BIGSERIAL    PRIMARY KEY,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  usuario_id   UUID,                       -- NULL = lo hizo Jarvis solo (proceso automático)
  accion       TEXT         NOT NULL,      -- ej. 'ajuste_modificado', 'decision_confirmada'
  entidad_tipo TEXT,                       -- ej. 'ajuste', 'decision', 'cliente'
  entidad_id   TEXT,
  detalle      JSONB        NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_ai_registro_entidad ON public.ai_registro (entidad_tipo, entidad_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_registro_usuario ON public.ai_registro (usuario_id, created_at);
ALTER TABLE public.ai_registro ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.ai_registro_inborrable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ai_registro no se modifica ni se borra (bitácora de decisiones)';
END;
$$;
DROP TRIGGER IF EXISTS trg_ai_registro_inborrable ON public.ai_registro;
CREATE TRIGGER trg_ai_registro_inborrable
  BEFORE UPDATE OR DELETE ON public.ai_registro
  FOR EACH ROW EXECUTE FUNCTION public.ai_registro_inborrable();
-- TRUNCATE no dispara triggers por fila: se bloquea aparte.
DROP TRIGGER IF EXISTS trg_ai_registro_sin_truncate ON public.ai_registro;
CREATE TRIGGER trg_ai_registro_sin_truncate
  BEFORE TRUNCATE ON public.ai_registro
  FOR EACH STATEMENT EXECUTE FUNCTION public.ai_registro_inborrable();

-- ─── 2. Ajustes de Jarvis ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_ajustes (
  clave           TEXT         PRIMARY KEY,
  valor           JSONB        NOT NULL,
  descripcion     TEXT,
  actualizado_por UUID,
  actualizado_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_ajustes ENABLE ROW LEVEL SECURITY;

INSERT INTO public.ai_ajustes (clave, valor, descripcion) VALUES
  ('modelo_pensador', '"claude-opus-5-5"',  'Modelo que piensa: chat, resumen del día, análisis.'),
  ('modelo_rapido',   '"claude-haiku-5-5"', 'Modelo barato para tareas chicas (clasificar, redactar avisos). También se usa si se pasa el tope.'),
  ('modelo_respaldo', '"claude-sonnet-5-5"','Si el pensador falla o no está disponible, se reintenta con este.'),
  ('tope_mensual_usd', '150',               'Gasto máximo de IA por mes (USD). Al pasarlo, Jarvis avisa y usa el modelo rápido.')
ON CONFLICT (clave) DO NOTHING;

-- Cada cambio de ajuste queda en la bitácora (quién, cuándo, de qué a qué).
CREATE OR REPLACE FUNCTION public.ai_ajustes_registrar() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.valor IS NOT DISTINCT FROM OLD.valor THEN
    RETURN NEW;
  END IF;
  INSERT INTO ai_registro (usuario_id, accion, entidad_tipo, entidad_id, detalle)
  VALUES (NEW.actualizado_por,
          CASE WHEN TG_OP = 'INSERT' THEN 'ajuste_creado' ELSE 'ajuste_modificado' END,
          'ajuste', NEW.clave,
          jsonb_build_object('de', CASE WHEN TG_OP = 'UPDATE' THEN OLD.valor END, 'a', NEW.valor));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ai_ajustes_registrar ON public.ai_ajustes;
CREATE TRIGGER trg_ai_ajustes_registrar
  AFTER INSERT OR UPDATE ON public.ai_ajustes
  FOR EACH ROW EXECUTE FUNCTION public.ai_ajustes_registrar();

-- ─── 3. Uso y costo de la IA ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_uso (
  id                     BIGSERIAL    PRIMARY KEY,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  usuario_id             UUID,                 -- NULL = proceso automático
  origen                 TEXT         NOT NULL, -- 'chat' | 'vigias' | 'resumen' | 'clasificador' | 'examen' | ...
  conversacion_id        UUID,
  modelo                 TEXT         NOT NULL,
  tokens_entrada         INTEGER      NOT NULL DEFAULT 0,
  tokens_cache_escritura INTEGER      NOT NULL DEFAULT 0,
  tokens_cache_lectura   INTEGER      NOT NULL DEFAULT 0,
  tokens_salida          INTEGER      NOT NULL DEFAULT 0,
  busquedas_web          INTEGER      NOT NULL DEFAULT 0,
  costo_usd              NUMERIC(10,5) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ai_uso_fecha ON public.ai_uso (created_at);
ALTER TABLE public.ai_uso ENABLE ROW LEVEL SECURITY;

-- ─── 4. Conversaciones: quién preguntó ──────────────────────────────────
ALTER TABLE public.ai_conversations ADD COLUMN IF NOT EXISTS usuario_id UUID;
ALTER TABLE public.ai_messages      ADD COLUMN IF NOT EXISTS usuario_id UUID;
CREATE INDEX IF NOT EXISTS idx_ai_conversations_usuario ON public.ai_conversations (usuario_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversacion ON public.ai_messages (conversation_id, created_at);
-- 'source' tenía CHECK de valores del lector de mails; Jarvis usa 'playroom'.
ALTER TABLE public.ai_conversations DROP CONSTRAINT IF EXISTS ai_conversations_source_check;

-- ─── 5. Seguridad: quitar acceso público ────────────────────────────────
DROP POLICY IF EXISTS "Service role full access" ON public.ai_conversations;
DROP POLICY IF EXISTS "Service role full access" ON public.ai_messages;
DROP POLICY IF EXISTS "Service role full access" ON public.ai_agenda_events;

-- ─── 6. Limpieza aprobada: avisos viejos del lector de mails ────────────
DELETE FROM public.ai_agenda_events WHERE source = 'gmail';
