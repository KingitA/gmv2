-- Actualización de las apps (vendedor / chofer / depósito) con un botón (17/11/2026).
-- Ver MOBILE.md → "Actualización desde la app".
--
-- - mobile_versiones: cada APK publicada (npm run publicar:apk). La app compara su
--   versionCode con la última publicada de su app y, si hay una nueva, la baja con una
--   URL firmada del bucket privado "apks" (el APK nunca pasa por Vercel).
-- - mobile_dispositivos.app_version_code: el versionCode que vio el servidor por última
--   vez en cada equipo (la tabla de /admin/equipos).
--
-- Idempotente: se puede correr más de una vez.

CREATE TABLE IF NOT EXISTS public.mobile_versiones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app            TEXT NOT NULL CHECK (app IN ('vendedor', 'chofer', 'deposito')),
  version_name   TEXT NOT NULL,
  version_code   INTEGER NOT NULL CHECK (version_code > 0),
  archivo        TEXT NOT NULL,          -- path dentro del bucket "apks"
  tamano_bytes   BIGINT NOT NULL CHECK (tamano_bytes > 0),
  sha256         TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  notas          TEXT,
  obligatoria    BOOLEAN NOT NULL DEFAULT false,
  publicada_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  publicada_por  TEXT,
  UNIQUE (app, version_code)
);

CREATE INDEX IF NOT EXISTS mobile_versiones_app_code_idx
  ON public.mobile_versiones (app, version_code DESC);

-- Solo el servidor (service role) la lee y escribe
ALTER TABLE public.mobile_versiones ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.mobile_dispositivos
  ADD COLUMN IF NOT EXISTS app_version_code INTEGER;

-- Bucket PRIVADO para los APK (se bajan solo con URL firmada de ~15 min)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('apks', 'apks', false, 104857600, ARRAY['application/vnd.android.package-archive', 'application/octet-stream'])
ON CONFLICT (id) DO UPDATE SET public = false;
