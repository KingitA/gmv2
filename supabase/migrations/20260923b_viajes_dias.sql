-- Viajes de varios días: fecha = día de salida, dias = duración (1..N).
-- El calendario lo muestra del día de salida al último. ADITIVA e IDEMPOTENTE.
ALTER TABLE public.viajes
  ADD COLUMN IF NOT EXISTS dias SMALLINT NOT NULL DEFAULT 1 CHECK (dias BETWEEN 1 AND 15);
