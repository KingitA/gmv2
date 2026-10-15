-- ═══════════════════════════════════════════════════════════════════════
-- Calendario laboral, ausencias del personal y frecuencia de las zonas.
-- (Jarvis ayuda a armar el calendario de viajes — docs/playroom-cerebro/)
--
-- 1. calendario_dias: feriados (los trae Jarvis de la fuente oficial) y días
--    especiales. "trabajamos" lo decide una PERSONA (NULL = sin decidir; nunca
--    se asume que un feriado no se trabaja). Se puede cambiar cuando haga falta
--    (ej. un feriado que se está debatiendo). Cada cambio → bitácora.
-- 2. personal_ausencias: vacaciones / licencias de cada usuario (todos los
--    empleados son usuarios). No se borran: se anulan (queda quién y cuándo).
-- 3. zonas.frecuencia_dias: cada cuánto se visita la zona.
--      1    = todos los días hábiles (ej. BAHIA)
--      N    = cada N días (30 = 1 mes, 45 = 1,5 meses, 60 = 2 meses…)
--      NULL = cuando haga falta (no se reclama; ej. BUENOS AIRES)
--    en_calendario (de la pantalla "Armar mes") queda sincronizado solo.
--
-- ADITIVA e IDEMPOTENTE.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Calendario laboral ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.calendario_dias (
  fecha          DATE PRIMARY KEY,
  nombre         TEXT NOT NULL,
  tipo           TEXT NOT NULL DEFAULT 'feriado' CHECK (tipo IN ('feriado', 'puente', 'local', 'empresa')),
  origen         TEXT NOT NULL DEFAULT 'persona' CHECK (origen IN ('api', 'persona')),
  en_fuente      BOOLEAN NOT NULL DEFAULT true,   -- false = la fuente oficial ya no lo lista
  trabajamos     BOOLEAN,                         -- NULL = sin decidir
  decidido_por   UUID,
  decidido_at    TIMESTAMPTZ,
  nota           TEXT,
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.calendario_dias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.calendario_dias FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.calendario_dias_registrar() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.trabajamos IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.trabajamos IS DISTINCT FROM OLD.trabajamos) THEN
    INSERT INTO ai_registro (usuario_id, accion, entidad_tipo, entidad_id, detalle)
    VALUES (
      CASE WHEN TG_OP = 'INSERT' OR NEW.decidido_at IS DISTINCT FROM OLD.decidido_at THEN NEW.decidido_por END,
      'dia_laboral_decidido', 'dia', NEW.fecha::text,
      jsonb_build_object(
        'titulo', NEW.nombre || ' (' || to_char(NEW.fecha, 'DD/MM/YYYY') || ')',
        'de', CASE WHEN TG_OP = 'UPDATE' THEN OLD.trabajamos END, 'a', NEW.trabajamos,
        'nota', COALESCE(NEW.nota, CASE WHEN NEW.trabajamos THEN 'Trabajamos' WHEN NOT NEW.trabajamos THEN 'No trabajamos' ELSE 'Sin decidir' END)));
  END IF;
  RETURN NEW;
END;
$f$;
DROP TRIGGER IF EXISTS trg_calendario_dias_registrar ON public.calendario_dias;
CREATE TRIGGER trg_calendario_dias_registrar AFTER INSERT OR UPDATE ON public.calendario_dias
  FOR EACH ROW EXECUTE FUNCTION public.calendario_dias_registrar();

-- ─── 2. Ausencias del personal ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.personal_ausencias (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  UUID NOT NULL,
  desde       DATE NOT NULL,
  hasta       DATE NOT NULL,
  tipo        TEXT NOT NULL DEFAULT 'vacaciones' CHECK (tipo IN ('vacaciones', 'licencia', 'otro')),
  nota        TEXT,
  creado_por  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  anulado_por UUID,
  anulado_at  TIMESTAMPTZ,
  CHECK (hasta >= desde)
);
CREATE INDEX IF NOT EXISTS idx_personal_ausencias_rango ON public.personal_ausencias (desde, hasta) WHERE anulado_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_personal_ausencias_usuario ON public.personal_ausencias (usuario_id, desde);
ALTER TABLE public.personal_ausencias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.personal_ausencias FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.personal_ausencias_registrar() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE quien_falta text;
BEGIN
  SELECT COALESCE(nombre, email) INTO quien_falta FROM usuarios WHERE id = NEW.usuario_id;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO ai_registro (usuario_id, accion, entidad_tipo, entidad_id, detalle)
    VALUES (NEW.creado_por, 'ausencia_cargada', 'usuario', NEW.usuario_id::text,
      jsonb_build_object('titulo', initcap(NEW.tipo) || ' de ' || COALESCE(quien_falta, '?') || ': ' || to_char(NEW.desde, 'DD/MM') || ' al ' || to_char(NEW.hasta, 'DD/MM/YYYY'), 'nota', NEW.nota));
  ELSIF NEW.anulado_at IS NOT NULL AND OLD.anulado_at IS NULL THEN
    INSERT INTO ai_registro (usuario_id, accion, entidad_tipo, entidad_id, detalle)
    VALUES (NEW.anulado_por, 'ausencia_anulada', 'usuario', NEW.usuario_id::text,
      jsonb_build_object('titulo', 'Anuló ' || NEW.tipo || ' de ' || COALESCE(quien_falta, '?') || ': ' || to_char(NEW.desde, 'DD/MM') || ' al ' || to_char(NEW.hasta, 'DD/MM/YYYY'), 'nota', NEW.nota));
  END IF;
  RETURN NEW;
END;
$f$;
DROP TRIGGER IF EXISTS trg_personal_ausencias_registrar ON public.personal_ausencias;
CREATE TRIGGER trg_personal_ausencias_registrar AFTER INSERT OR UPDATE ON public.personal_ausencias
  FOR EACH ROW EXECUTE FUNCTION public.personal_ausencias_registrar();

-- ─── 3. Frecuencia de las zonas ────────────────────────────────────────
ALTER TABLE public.zonas ADD COLUMN IF NOT EXISTS frecuencia_dias SMALLINT DEFAULT 30;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zonas_frecuencia_dias_check') THEN
    ALTER TABLE public.zonas ADD CONSTRAINT zonas_frecuencia_dias_check CHECK (frecuencia_dias IS NULL OR frecuencia_dias BETWEEN 1 AND 365);
  END IF;
END $$;
-- Valores iniciales: lo que ya estaba fuera del calendario = "cuando haga falta"; BAHIA = todos los días hábiles
UPDATE public.zonas SET frecuencia_dias = NULL WHERE en_calendario = false AND frecuencia_dias = 30;
UPDATE public.zonas SET frecuencia_dias = 1 WHERE upper(nombre) = 'BAHIA' AND frecuencia_dias = 30;

-- en_calendario sigue a la frecuencia (y al revés, si se usa el "ojito" de la pantalla vieja)
CREATE OR REPLACE FUNCTION public.zonas_sincronizar_frecuencia() RETURNS trigger
LANGUAGE plpgsql AS $f$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.en_calendario IS DISTINCT FROM OLD.en_calendario AND NEW.frecuencia_dias IS NOT DISTINCT FROM OLD.frecuencia_dias THEN
    NEW.frecuencia_dias := CASE WHEN NEW.en_calendario THEN COALESCE(OLD.frecuencia_dias, 30) ELSE NULL END;
  ELSE
    NEW.en_calendario := NEW.frecuencia_dias IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$f$;
DROP TRIGGER IF EXISTS trg_zonas_sincronizar_frecuencia ON public.zonas;
CREATE TRIGGER trg_zonas_sincronizar_frecuencia BEFORE INSERT OR UPDATE OF frecuencia_dias, en_calendario ON public.zonas
  FOR EACH ROW EXECUTE FUNCTION public.zonas_sincronizar_frecuencia();

-- Regla: desde qué día del mes Jarvis recuerda armar el calendario siguiente
INSERT INTO public.ai_ajustes (clave, valor, descripcion) VALUES
  ('regla_dia_aviso_calendario', '20', 'Desde qué día del mes Jarvis recuerda armar el calendario de viajes del mes siguiente.')
ON CONFLICT (clave) DO NOTHING;
