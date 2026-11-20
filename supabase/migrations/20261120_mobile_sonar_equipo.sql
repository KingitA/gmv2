-- Hacer sonar un equipo perdido (20/11/2026). Ver MOBILE.md → "Hacer sonar un equipo".
--
-- - mobile_dispositivos.fcm_token: token de Firebase Cloud Messaging del equipo (lo manda
--   la app al iniciar sesión y cuando cambia). Con él el servidor le manda el mensaje
--   "sonar" aunque la app esté cerrada.
-- - mobile_sonar_log: quién hizo sonar (o detuvo) qué equipo, cuándo, desde dónde y qué
--   contestó Firebase.
--
-- Idempotente: se puede correr más de una vez.

ALTER TABLE public.mobile_dispositivos
  ADD COLUMN IF NOT EXISTS fcm_token TEXT,
  ADD COLUMN IF NOT EXISTS fcm_token_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.mobile_sonar_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id    TEXT NOT NULL,
  app          TEXT NOT NULL,
  accion       TEXT NOT NULL CHECK (accion IN ('sonar', 'detener')),
  pedido_por   UUID,                      -- usuario que tocó el botón
  origen       TEXT NOT NULL CHECK (origen IN ('erp', 'app')),
  resultado    TEXT NOT NULL,             -- 'enviado' | 'sin_token' | 'sin_firebase' | 'error: …'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mobile_sonar_log_device_idx ON public.mobile_sonar_log (device_id, app, created_at DESC);

-- Solo el servidor (service role) lee y escribe
ALTER TABLE public.mobile_sonar_log ENABLE ROW LEVEL SECURITY;
