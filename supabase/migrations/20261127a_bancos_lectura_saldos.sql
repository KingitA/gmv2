-- ════════════════════════════════════════════════════════════════════════════════════════
-- Bancos — Tanda 1: lectura de movimientos y saldo del banco (27/11/2026)
-- Plan: docs/bancos/PLAN-BANCOS.md
-- ════════════════════════════════════════════════════════════════════════════════════════
-- 1. banco_extractos_movimientos: hora, contraparte (nombre / CUIT / CBU), concepto del banco,
--    saldo del banco en ese renglón y de dónde salió (captura / archivo / pdf / api).
--    Todo opcional: lo que ya estaba sigue igual (extracto_matchear no cambia).
-- 2. banco_extractos.fuente acepta 'captura' (capturas de pantalla del homebanking leídas con IA).
-- 3. banco_saldos: saldo del BANCO por cuenta, con cuándo vale y de dónde salió (captura, extracto,
--    API de MercadoPago / Credicoop). NO toca el saldo interno (saldos_financieros / kardex).
-- 4. Lectura periódica: la base llama cada 30 minutos a /api/cron/bancos-lectura (MercadoPago
--    siempre que haya token; Credicoop solo en producción). Usa la misma dirección y clave que
--    la consulta periódica de Credicoop (bancos_consulta_ajustes, migración 20261119e).
--
-- No mueve plata ni cuentas corrientes. Idempotente: se puede correr más de una vez.
-- ════════════════════════════════════════════════════════════════════════════════════════

-- ─── 1. Columnas nuevas del movimiento ──────────────────────────────────────────────────
ALTER TABLE public.banco_extractos_movimientos
  ADD COLUMN IF NOT EXISTS hora               time,
  ADD COLUMN IF NOT EXISTS contraparte_nombre text,
  ADD COLUMN IF NOT EXISTS contraparte_cuit   varchar(13),
  ADD COLUMN IF NOT EXISTS contraparte_cbu    varchar(22),
  ADD COLUMN IF NOT EXISTS concepto_banco     text,
  ADD COLUMN IF NOT EXISTS saldo_banco        numeric(14,2),
  ADD COLUMN IF NOT EXISTS fuente_detalle     varchar(10);

ALTER TABLE public.banco_extractos_movimientos
  DROP CONSTRAINT IF EXISTS banco_extractos_movimientos_fuente_detalle_check;
ALTER TABLE public.banco_extractos_movimientos
  ADD CONSTRAINT banco_extractos_movimientos_fuente_detalle_check
  CHECK (fuente_detalle IS NULL OR fuente_detalle IN ('captura', 'archivo', 'pdf', 'api'));

COMMENT ON COLUMN public.banco_extractos_movimientos.hora IS 'Hora del movimiento si el banco la muestra (captura de Nación). Hora argentina.';
COMMENT ON COLUMN public.banco_extractos_movimientos.contraparte_cuit IS 'CUIT de quien transfirió / a quien se transfirió (xx-xxxxxxxx-x, solo si el dígito verificador da).';
COMMENT ON COLUMN public.banco_extractos_movimientos.concepto_banco IS 'Concepto tal cual lo pone el banco (GRAVAMEN LEY 25413 S/DEB, CR DEBIN RED LINK…). Para clasificar impuestos en la tanda 2.';
COMMENT ON COLUMN public.banco_extractos_movimientos.saldo_banco IS 'Saldo de la cuenta en el banco después de este movimiento, si el banco lo muestra.';
COMMENT ON COLUMN public.banco_extractos_movimientos.fuente_detalle IS 'captura (pantalla del homebanking leída con IA) · archivo (Excel/CSV) · pdf (extracto) · api (MercadoPago / Credicoop).';

-- Lo que ya estaba: la fuente sale del extracto
UPDATE public.banco_extractos_movimientos m
   SET fuente_detalle = CASE e.fuente
         WHEN 'pdf' THEN 'pdf'
         WHEN 'api_mp' THEN 'api'
         WHEN 'api_banco' THEN 'api'
         ELSE 'archivo' END
  FROM public.banco_extractos e
 WHERE e.id = m.extracto_id AND m.fuente_detalle IS NULL;

-- CUIT siempre con guiones (docs/FORMATOS.md): el mismo trigger que el resto de las tablas
DO $$
BEGIN
  IF to_regproc('public.trg_normalizar_cuit') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_normalizar_cuit ON public.banco_extractos_movimientos;
    CREATE TRIGGER trg_normalizar_cuit
      BEFORE INSERT OR UPDATE OF contraparte_cuit ON public.banco_extractos_movimientos
      FOR EACH ROW EXECUTE FUNCTION public.trg_normalizar_cuit('contraparte_cuit');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bem_cuenta_fecha ON public.banco_extractos_movimientos (cuenta_bancaria_id, fecha);
CREATE INDEX IF NOT EXISTS idx_bem_contraparte_cuit ON public.banco_extractos_movimientos (contraparte_cuit) WHERE contraparte_cuit IS NOT NULL;

-- ─── 2. Fuente 'captura' en el extracto ─────────────────────────────────────────────────
ALTER TABLE public.banco_extractos
  DROP CONSTRAINT IF EXISTS banco_extractos_fuente_check;
ALTER TABLE public.banco_extractos
  ADD CONSTRAINT banco_extractos_fuente_check
  CHECK (fuente IN ('csv', 'excel', 'pdf', 'captura', 'api_mp', 'api_banco'));

-- ─── 3. Saldo del banco ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.banco_saldos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_bancaria_id uuid NOT NULL REFERENCES public.cuentas_bancarias(id),
  saldo              numeric(14,2) NOT NULL,
  -- Momento en que vale ese saldo (captura: cuando se subió; extracto: fin del último día)
  al                 timestamptz NOT NULL,
  fuente             varchar(40) NOT NULL,
  detalle            text,
  registrado_por     uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.banco_saldos IS
  'Saldo de cada cuenta según el BANCO (capturas, extractos, API). El saldo del sistema sigue siendo saldos_financieros; acá solo se compara.';
CREATE INDEX IF NOT EXISTS idx_banco_saldos_cuenta_al ON public.banco_saldos (cuenta_bancaria_id, al DESC);

ALTER TABLE public.banco_saldos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.banco_saldos FROM anon;
GRANT SELECT ON TABLE public.banco_saldos TO authenticated;
GRANT ALL ON TABLE public.banco_saldos TO service_role;
DO $$
BEGIN
  CREATE POLICY "banco_saldos_leer" ON public.banco_saldos FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- El último saldo de cada cuenta
CREATE OR REPLACE VIEW public.banco_saldo_actual WITH (security_invoker = true) AS
SELECT DISTINCT ON (cuenta_bancaria_id)
       cuenta_bancaria_id, saldo, al, fuente, detalle, created_at
  FROM public.banco_saldos
 ORDER BY cuenta_bancaria_id, al DESC, created_at DESC;
REVOKE ALL ON public.banco_saldo_actual FROM anon;
GRANT SELECT ON public.banco_saldo_actual TO authenticated, service_role;

-- ─── 4. Lectura periódica (MercadoPago siempre; Credicoop solo en producción) ───────────
-- Llama a /api/cron/bancos-lectura con la dirección y la clave ya cargadas para la consulta
-- de Credicoop (bancos_consulta_ajustes.url termina en /api/cron/bancos-credicoop).
CREATE OR REPLACE FUNCTION public.bancos_lectura_periodica() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_aj record;
  v_url text;
  v_hora int := extract(hour FROM (now() AT TIME ZONE 'America/Argentina/Buenos_Aires'));
BEGIN
  IF v_hora < 7 OR v_hora >= 22 THEN
    RETURN 'fuera de horario (7 a 22)';
  END IF;
  IF to_regclass('public.bancos_consulta_ajustes') IS NULL THEN
    RETURN 'falta la migración 20261119e (bancos_consulta_ajustes)';
  END IF;
  SELECT * INTO v_aj FROM bancos_consulta_ajustes WHERE id;
  IF NOT FOUND OR NOT v_aj.activo OR coalesce(trim(v_aj.url), '') = '' OR coalesce(trim(v_aj.secreto), '') = '' THEN
    RETURN 'sin configurar (falta la dirección o la clave en bancos_consulta_ajustes)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RETURN 'pg_net no está instalado: la base no puede llamar al sistema';
  END IF;
  v_url := regexp_replace(trim(v_aj.url), '/api/cron/.*$', '') || '/api/cron/bancos-lectura';
  EXECUTE 'SELECT net.http_get(url := $1, headers := $2, timeout_milliseconds := 120000)'
    USING v_url, jsonb_build_object('Authorization', 'Bearer ' || trim(v_aj.secreto));
  RETURN 'lectura pedida';
END $$;
REVOKE ALL ON FUNCTION public.bancos_lectura_periodica() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bancos_lectura_periodica() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'gm_bancos_lectura_periodica';
    PERFORM cron.schedule('gm_bancos_lectura_periodica', '7,37 * * * *', 'SELECT public.bancos_lectura_periodica()');
  ELSE
    RAISE NOTICE 'pg_cron no está instalado: MercadoPago se lee solo con el botón "Actualizar".';
  END IF;
END $$;

-- Probar:      SELECT public.bancos_lectura_periodica();
-- Ver el job:  SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'gm_bancos_lectura_periodica';
-- Apagar:      SELECT cron.unschedule('gm_bancos_lectura_periodica');
