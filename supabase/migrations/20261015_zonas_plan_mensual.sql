-- =====================================================================
-- Plan mensual de viajes: cada zona sabe cuántos días ocupa su viaje y si
-- entra en el calendario. Con eso se arma el mes siguiente arrastrando zonas
-- (o trayendo el mes anterior) y el sistema avisa qué zona quedó afuera.
--   dias_viaje    → duración habitual (Necochea 2, Tres Arroyos 1…). Es la
--                   que se propone; en cada viaje se puede cambiar.
--   en_calendario → false = zona que no se visita con viaje propio programado
--                   (no cuenta como "faltante").
-- ADITIVA e IDEMPOTENTE.
-- =====================================================================
ALTER TABLE public.zonas
  ADD COLUMN IF NOT EXISTS dias_viaje    SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS en_calendario BOOLEAN  NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zonas_dias_viaje_check') THEN
    ALTER TABLE public.zonas ADD CONSTRAINT zonas_dias_viaje_check CHECK (dias_viaje BETWEEN 1 AND 15);
  END IF;
END $$;
