-- Viajes: quién y cuándo modificó el viaje por última vez (arrastrar en el
-- calendario cambia la fecha; queda registrado). ADITIVA e IDEMPOTENTE.
ALTER TABLE public.viajes
  ADD COLUMN IF NOT EXISTS actualizado_por UUID,
  ADD COLUMN IF NOT EXISTS actualizado_at  TIMESTAMPTZ;
