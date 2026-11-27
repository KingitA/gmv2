-- Bancos: tandas 1 a 5 (27/11/2026). Correr TODO de una vez en el SQL Editor de Supabase.
-- Se puede correr más de una vez. Orden: 20261127a, b, c, d, e.

-- ════════ supabase/migrations/20261127a_bancos_lectura_saldos.sql ════════
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

-- ════════ supabase/migrations/20261127b_bancos_clasificacion.sql ════════
-- ════════════════════════════════════════════════════════════════════════════════════════
-- Bancos — Tanda 2: impuestos y gastos bancarios (27/11/2026)
-- Plan: docs/bancos/PLAN-BANCOS.md
-- ════════════════════════════════════════════════════════════════════════════════════════
-- 1. bancos_conceptos: catálogo de lo que cobra / debita el banco (Ley 25.413, SIRCREB,
--    percepciones, IVA sobre comisiones, comisiones, débitos automáticos, ARCA, préstamos,
--    rendimientos…), con el signo esperado y si es impuesto / gasto / pago / financiero.
--    Es el mismo que lib/bancos/clasificacion/conceptos.ts (la prueba controla que coincidan).
-- 2. banco_extractos_movimientos.concepto_id + clasificacion_version: SOLO la clasificación.
--    La pone el sistema (lib/bancos/clasificacion, reglas fijas por banco, sin IA) al importar y,
--    para lo que ya estaba, sola la primera vez que se abre "Gastos bancarios" o se le pregunta a
--    Jarvis. NO crea asientos en el kardex ni toca saldos (eso es la conciliación, más adelante).
-- 3. bancos_gastos(desde, hasta, cuenta, concepto): totales por mes × banco × concepto.
-- 4. bancos_resumen(desde, hasta): por banco, créditos, débitos, impuestos, gastos y saldos.
--
-- No mueve plata ni cuentas corrientes. Idempotente: se puede correr más de una vez.
-- ════════════════════════════════════════════════════════════════════════════════════════

-- ─── 1. Catálogo ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bancos_conceptos (
  id      text PRIMARY KEY,
  nombre  text NOT NULL,
  tipo    text NOT NULL CHECK (tipo IN ('impuesto', 'gasto', 'pago', 'financiero', 'operativo', 'otro')),
  signo   text NOT NULL CHECK (signo IN ('debito', 'credito', 'ambos')),
  orden   int  NOT NULL DEFAULT 0
);
COMMENT ON TABLE public.bancos_conceptos IS
  'Conceptos del banco (impuestos, comisiones, pagos, financieros). Lo usa la clasificación de banco_extractos_movimientos. Igual a lib/bancos/clasificacion/conceptos.ts.';

INSERT INTO public.bancos_conceptos (id, nombre, tipo, signo, orden) VALUES
  ('ley25413_debitos',        'Impuesto Ley 25.413 s/débitos',               'impuesto',   'debito',  10),
  ('ley25413_creditos',       'Impuesto Ley 25.413 s/créditos',              'impuesto',   'debito',  11),
  ('ley25413_reverso',        'Reversa impuesto Ley 25.413',                 'impuesto',   'credito', 12),
  ('sircreb',                 'SIRCREB (recaudación IIBB)',                  'impuesto',   'debito',  20),
  ('sircreb_reverso',         'Reversa SIRCREB',                             'impuesto',   'credito', 21),
  ('percepcion_iibb',         'Percepción IIBB',                             'impuesto',   'debito',  30),
  ('percepcion_iva',          'Percepción IVA RG 2408',                      'impuesto',   'debito',  31),
  ('percepcion_reverso',      'Reversa de percepción',                       'impuesto',   'credito', 32),
  ('iva_comisiones',          'IVA sobre comisiones',                        'impuesto',   'debito',  40),
  ('comision_transferencias', 'Comisión transferencias',                     'gasto',      'debito',  50),
  ('comision_cheques',        'Comisión cheques',                            'gasto',      'debito',  51),
  ('comision_mantenimiento',  'Mantenimiento / paquete',                     'gasto',      'debito',  52),
  ('honorarios_informes',     'Honorarios e informes',                       'gasto',      'debito',  53),
  ('comision_otros',          'Otras comisiones y cargos',                   'gasto',      'debito',  59),
  ('debito_automatico',       'Débito automático (servicios / seguros)',     'pago',       'debito',  60),
  ('pago_servicios',          'Pago de servicios',                           'pago',       'debito',  61),
  ('pago_arca',               'Pago ARCA / VEP',                             'pago',       'debito',  62),
  ('prestamo',                'Préstamos',                                   'financiero', 'ambos',   70),
  ('rendimientos',            'Rendimientos',                                'financiero', 'credito', 71),
  ('intereses',               'Intereses',                                   'financiero', 'ambos',   72),
  ('movimiento',              'Transferencias, DEBIN, cheques y depósitos',  'operativo',  'ambos',   90),
  ('otro',                    'Otros (sin reconocer)',                       'otro',       'ambos',   99)
ON CONFLICT (id) DO UPDATE
  SET nombre = EXCLUDED.nombre, tipo = EXCLUDED.tipo, signo = EXCLUDED.signo, orden = EXCLUDED.orden;

ALTER TABLE public.bancos_conceptos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bancos_conceptos FROM anon;
GRANT SELECT ON TABLE public.bancos_conceptos TO authenticated;
GRANT ALL ON TABLE public.bancos_conceptos TO service_role;
DO $$
BEGIN
  CREATE POLICY "bancos_conceptos_leer" ON public.bancos_conceptos FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 2. Clasificación del movimiento ────────────────────────────────────────────────────
ALTER TABLE public.banco_extractos_movimientos
  ADD COLUMN IF NOT EXISTS concepto_id           text REFERENCES public.bancos_conceptos(id),
  ADD COLUMN IF NOT EXISTS clasificacion_version smallint;

COMMENT ON COLUMN public.banco_extractos_movimientos.concepto_id IS
  'Qué es el movimiento según el banco (bancos_conceptos). Solo clasificación: no genera asientos ni toca saldos.';
COMMENT ON COLUMN public.banco_extractos_movimientos.clasificacion_version IS
  'Versión de las reglas con que se clasificó (lib/bancos/clasificacion VERSION_CLASIFICACION). Menor o vacía ⇒ se vuelve a clasificar.';

CREATE INDEX IF NOT EXISTS idx_bem_concepto_fecha ON public.banco_extractos_movimientos (concepto_id, fecha);
CREATE INDEX IF NOT EXISTS idx_bem_sin_clasificar ON public.banco_extractos_movimientos (created_at) WHERE concepto_id IS NULL;

-- ─── 3. Totales por mes × banco × concepto ──────────────────────────────────────────────
-- neto = suma con signo del banco (débito −, crédito +). Un impuesto da negativo; su reversa, positivo.
CREATE OR REPLACE FUNCTION public.bancos_gastos(
  p_desde date, p_hasta date, p_cuenta_id uuid DEFAULT NULL, p_concepto_id text DEFAULT NULL
) RETURNS TABLE (
  mes text, cuenta_bancaria_id uuid, cuenta text, concepto_id text, concepto text, tipo text,
  orden int, cantidad int, neto numeric
)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT to_char(m.fecha, 'YYYY-MM') AS mes, m.cuenta_bancaria_id, cb.nombre::text AS cuenta,
         c.id AS concepto_id, c.nombre AS concepto, c.tipo, c.orden,
         count(*)::int AS cantidad, round(sum(m.monto), 2) AS neto
    FROM banco_extractos_movimientos m
    JOIN bancos_conceptos c ON c.id = m.concepto_id
    JOIN cuentas_bancarias cb ON cb.id = m.cuenta_bancaria_id
   WHERE m.fecha BETWEEN p_desde AND p_hasta
     AND c.tipo <> 'operativo'
     AND (p_cuenta_id IS NULL OR m.cuenta_bancaria_id = p_cuenta_id)
     AND (p_concepto_id IS NULL OR c.id = p_concepto_id)
   GROUP BY 1, 2, 3, 4, 5, 6, 7
   ORDER BY 1, 3, 7
$$;
REVOKE ALL ON FUNCTION public.bancos_gastos(date, date, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bancos_gastos(date, date, uuid, text) TO authenticated, service_role;

-- ─── 4. Resumen por banco ───────────────────────────────────────────────────────────────
-- Saldo final: el último saldo informado por el banco hasta ese día (banco_saldos, o el saldo del
-- último renglón que lo trae) más los movimientos cargados después de ese día y hasta p_hasta.
-- Saldo inicial = saldo final − (créditos − débitos) del período. Los dos valen si los movimientos
-- del período están todos cargados (extracto o capturas completas).
CREATE OR REPLACE FUNCTION public.bancos_resumen(p_desde date, p_hasta date)
RETURNS TABLE (
  cuenta_bancaria_id uuid, cuenta text, banco text, movimientos int,
  creditos numeric, debitos numeric, impuestos numeric, gastos numeric, pagos numeric, financieros numeric,
  sin_clasificar int, desde_mov date, hasta_mov date,
  saldo_inicial numeric, saldo_final numeric, saldo_referencia numeric, saldo_referencia_al text, saldo_fuente text
)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH m AS (
    SELECT x.cuenta_bancaria_id, x.monto, x.fecha, x.concepto_id, c.tipo
      FROM banco_extractos_movimientos x
      LEFT JOIN bancos_conceptos c ON c.id = x.concepto_id
     WHERE x.fecha BETWEEN p_desde AND p_hasta
  ), agg AS (
    SELECT cuenta_bancaria_id,
           count(*)::int AS movimientos,
           coalesce(sum(monto) FILTER (WHERE monto > 0), 0) AS creditos,
           coalesce(-sum(monto) FILTER (WHERE monto < 0), 0) AS debitos,
           coalesce(-sum(monto) FILTER (WHERE tipo = 'impuesto'), 0) AS impuestos,
           coalesce(-sum(monto) FILTER (WHERE tipo = 'gasto'), 0) AS gastos,
           coalesce(-sum(monto) FILTER (WHERE tipo = 'pago'), 0) AS pagos,
           coalesce(sum(monto) FILTER (WHERE tipo = 'financiero'), 0) AS financieros,
           count(*) FILTER (WHERE concepto_id IS NULL)::int AS sin_clasificar,
           min(fecha) AS desde_mov, max(fecha) AS hasta_mov,
           coalesce(sum(monto), 0) AS neto
      FROM m GROUP BY 1
  ), ref_saldo AS (
    SELECT DISTINCT ON (s.cuenta_bancaria_id)
           s.cuenta_bancaria_id, s.saldo,
           (s.al AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS dia,
           to_char(s.al AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI') AS al_txt,
           s.fuente
      FROM banco_saldos s
     WHERE (s.al AT TIME ZONE 'America/Argentina/Buenos_Aires')::date <= p_hasta
     ORDER BY s.cuenta_bancaria_id, s.al DESC, s.created_at DESC
  ), ref_mov AS (
    SELECT DISTINCT ON (x.cuenta_bancaria_id)
           x.cuenta_bancaria_id, x.saldo_banco AS saldo, x.fecha AS dia,
           to_char(x.fecha, 'DD/MM/YYYY') AS al_txt, 'renglón del banco'::text AS fuente
      FROM banco_extractos_movimientos x
     WHERE x.saldo_banco IS NOT NULL AND x.fecha <= p_hasta
     ORDER BY x.cuenta_bancaria_id, x.fecha DESC, x.hora DESC NULLS LAST, x.created_at DESC
  ), ref AS (
    -- El más nuevo de los dos (a igual día, el saldo informado)
    SELECT DISTINCT ON (cuenta_bancaria_id) * FROM (
      SELECT *, 1 AS pri FROM ref_saldo UNION ALL SELECT *, 2 AS pri FROM ref_mov
    ) r ORDER BY cuenta_bancaria_id, dia DESC, pri
  ), fin AS (
    SELECT r.cuenta_bancaria_id, r.saldo AS saldo_referencia, r.al_txt, r.fuente,
           r.saldo + coalesce((SELECT sum(x.monto) FROM banco_extractos_movimientos x
                                WHERE x.cuenta_bancaria_id = r.cuenta_bancaria_id
                                  AND x.fecha > r.dia AND x.fecha <= p_hasta), 0) AS saldo_final
      FROM ref r
  )
  SELECT cb.id, cb.nombre::text, cb.banco::text,
         coalesce(a.movimientos, 0),
         round(coalesce(a.creditos, 0), 2), round(coalesce(a.debitos, 0), 2),
         round(coalesce(a.impuestos, 0), 2), round(coalesce(a.gastos, 0), 2),
         round(coalesce(a.pagos, 0), 2), round(coalesce(a.financieros, 0), 2),
         coalesce(a.sin_clasificar, 0), a.desde_mov, a.hasta_mov,
         round(f.saldo_final - coalesce(a.neto, 0), 2), round(f.saldo_final, 2),
         f.saldo_referencia, f.al_txt, f.fuente
    FROM cuentas_bancarias cb
    LEFT JOIN agg a ON a.cuenta_bancaria_id = cb.id
    LEFT JOIN fin f ON f.cuenta_bancaria_id = cb.id
   WHERE cb.activo
   ORDER BY cb.nombre
$$;
REVOKE ALL ON FUNCTION public.bancos_resumen(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bancos_resumen(date, date) TO authenticated, service_role;

-- Los movimientos que ya estaban se clasifican solos (lib/bancos/clasificacion-servidor.ts) la
-- primera vez que se abre Finanzas → Gastos bancarios o se le pregunta a Jarvis por los bancos.
--
-- Probar:
--   SELECT * FROM public.bancos_gastos('2026-10-01', '2026-10-31');
--   SELECT * FROM public.bancos_resumen('2026-10-01', '2026-10-31');
--   SELECT concepto_id, count(*) FROM banco_extractos_movimientos GROUP BY 1 ORDER BY 2 DESC;

-- ════════ supabase/migrations/20261127c_bancos_transferencias_clientes.sql ════════
-- ════════════════════════════════════════════════════════════════════════════════════════
-- Bancos — Tanda 3: transferencias de clientes (27/11/2026)
-- Plan: docs/bancos/PLAN-BANCOS.md · Lógica: lib/bancos/transferencias/
-- ════════════════════════════════════════════════════════════════════════════════════════
-- 1. clientes_pagadores: quién paga por quién (MUCHOS A MUCHOS). Una persona puede pagar por
--    varios clientes y un cliente puede tener varios pagadores. Por CUIT cuando hay.
-- 2. banco_transferencias_vinculos: qué movimiento del banco confirmó qué transferencia. UNIQUE
--    por movimiento y por renglón del cobro: nunca se usa dos veces lo mismo.
-- 3. banco_transferencias_ajustes: modo propuesta (por defecto ENCENDIDO: el sistema solo dice
--    "se confirmaría con…" y no confirma nada) y en nombre de quién confirma cuando se apaga.
-- 4. banco_transferencia_conciliar(): vincula el crédito del banco con la transferencia informada
--    y confirma el cobro por el MISMO camino que /caja (cobranza_confirmar); el resto de la
--    confirmación (comisiones, 10 % contado, billetera) lo hace el servidor como /caja.
--
-- NO cambia extracto_matchear ni cobranza_confirmar. Hasta que alguien vincule un crédito sin
-- identificar, no se toca ninguna cuenta corriente. Idempotente: se puede correr más de una vez.
-- ════════════════════════════════════════════════════════════════════════════════════════

-- ─── 1. Pagadores ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clientes_pagadores (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id                  uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  pagador_cuit                varchar(13),
  pagador_nombre              text,
  pagador_nombre_normalizado  text,
  banco                       text,
  cbu                         varchar(22),
  veces                       integer NOT NULL DEFAULT 0,
  ultimo_uso                  timestamptz,
  origen                      varchar(10) NOT NULL DEFAULT 'aprendido' CHECK (origen IN ('manual', 'aprendido')),
  creado_por                  uuid,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  CHECK (pagador_cuit IS NOT NULL OR pagador_nombre_normalizado IS NOT NULL)
);
COMMENT ON TABLE public.clientes_pagadores IS
  'Quién paga por quién (muchos a muchos). Aprendido al confirmar una transferencia con el banco o cargado a mano. El CUIT del propio cliente cuenta como pagador sin estar acá.';

CREATE UNIQUE INDEX IF NOT EXISTS ux_clientes_pagadores
  ON public.clientes_pagadores (cliente_id, coalesce(pagador_cuit, ''), coalesce(pagador_nombre_normalizado, ''));
CREATE INDEX IF NOT EXISTS idx_clientes_pagadores_cuit ON public.clientes_pagadores (pagador_cuit) WHERE pagador_cuit IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clientes_pagadores_nombre ON public.clientes_pagadores (pagador_nombre_normalizado) WHERE pagador_nombre_normalizado IS NOT NULL;

DO $$
BEGIN
  IF to_regproc('public.trg_normalizar_cuit') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_normalizar_cuit ON public.clientes_pagadores;
    CREATE TRIGGER trg_normalizar_cuit
      BEFORE INSERT OR UPDATE OF pagador_cuit ON public.clientes_pagadores
      FOR EACH ROW EXECUTE FUNCTION public.trg_normalizar_cuit('pagador_cuit');
  END IF;
END $$;

ALTER TABLE public.clientes_pagadores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.clientes_pagadores FROM anon;
GRANT SELECT ON TABLE public.clientes_pagadores TO authenticated;
GRANT ALL ON TABLE public.clientes_pagadores TO service_role;
DO $$
BEGIN
  CREATE POLICY "clientes_pagadores_leer" ON public.clientes_pagadores FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 2. Vínculos movimiento del banco ↔ transferencia del cobro ─────────────────────────
CREATE TABLE IF NOT EXISTS public.banco_transferencias_vinculos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movimiento_id    uuid NOT NULL UNIQUE REFERENCES public.banco_extractos_movimientos(id) ON DELETE CASCADE,
  pago_id          uuid NOT NULL REFERENCES public.pagos_clientes(id),
  pago_detalle_id  uuid UNIQUE REFERENCES public.pagos_detalle(id) ON DELETE SET NULL,
  cliente_id       uuid,
  -- auto = la confirmó el sistema · existente = una persona la vinculó a una transferencia informada
  -- · nuevo = crédito sin identificar: una persona eligió el cliente y se creó el cobro
  origen           varchar(10) NOT NULL CHECK (origen IN ('auto', 'existente', 'nuevo')),
  fuente           varchar(10),
  creado_por       uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_btv_pago ON public.banco_transferencias_vinculos (pago_id);
COMMENT ON TABLE public.banco_transferencias_vinculos IS
  'Qué crédito del banco confirmó qué transferencia de cliente. Único por movimiento y por renglón: no se usa dos veces.';

ALTER TABLE public.banco_transferencias_vinculos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.banco_transferencias_vinculos FROM anon;
GRANT SELECT ON TABLE public.banco_transferencias_vinculos TO authenticated;
GRANT ALL ON TABLE public.banco_transferencias_vinculos TO service_role;
DO $$
BEGIN
  CREATE POLICY "btv_leer" ON public.banco_transferencias_vinculos FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 3. Ajustes: modo propuesta ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.banco_transferencias_ajustes (
  id                   boolean PRIMARY KEY DEFAULT true CHECK (id),
  modo_propuesta       boolean NOT NULL DEFAULT true,
  -- En nombre de quién confirma el sistema: el admin que apagó el modo propuesta
  confirma_usuario_id  uuid,
  cambiado_por         uuid,
  cambiado_at          timestamptz
);
INSERT INTO public.banco_transferencias_ajustes (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
COMMENT ON TABLE public.banco_transferencias_ajustes IS
  'modo_propuesta = true: el sistema solo propone ("se confirmaría con…"). En false confirma solo, en nombre de confirma_usuario_id. Se cambia desde /caja (solo admin).';

ALTER TABLE public.banco_transferencias_ajustes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.banco_transferencias_ajustes FROM anon, authenticated;
GRANT ALL ON TABLE public.banco_transferencias_ajustes TO service_role;

-- ─── 4. Vincular y confirmar ────────────────────────────────────────────────────────────
-- Todo en una transacción: si cobranza_confirmar falla, no queda ni el vínculo ni el movimiento
-- conciliado. El UNIQUE de los vínculos + el FOR UPDATE del movimiento impiden usarlo dos veces.
CREATE OR REPLACE FUNCTION public.banco_transferencia_conciliar(
  p_mov_id      uuid,
  p_pago_id     uuid,
  p_detalle_id  uuid,
  p_usuario_id  uuid,
  p_origen      text      -- auto | existente | nuevo
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mov     banco_extractos_movimientos%ROWTYPE;
  v_pago    pagos_clientes%ROWTYPE;
  v_det     pagos_detalle%ROWTYPE;
  v_otros   int;
  v_res     jsonb;
  v_kardex  uuid;
BEGIN
  IF p_usuario_id IS NULL THEN
    RAISE EXCEPTION 'banco_transferencia_conciliar: falta quién confirma';
  END IF;
  IF p_origen NOT IN ('auto', 'existente', 'nuevo') THEN
    RAISE EXCEPTION 'banco_transferencia_conciliar: origen % inválido', p_origen;
  END IF;

  SELECT * INTO v_mov FROM banco_extractos_movimientos WHERE id = p_mov_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movimiento del banco no encontrado.';
  END IF;
  IF v_mov.monto <= 0 THEN
    RAISE EXCEPTION 'Ese movimiento del banco no es un crédito.';
  END IF;
  IF v_mov.estado_matching <> 'PENDIENTE' OR EXISTS (SELECT 1 FROM banco_transferencias_vinculos WHERE movimiento_id = p_mov_id) THEN
    RAISE EXCEPTION 'Ese movimiento del banco ya está vinculado o conciliado: no se usó de nuevo.';
  END IF;

  SELECT * INTO v_pago FROM pagos_clientes WHERE id = p_pago_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cobro no encontrado.';
  END IF;
  IF v_pago.estado NOT IN ('pendiente', 'pendiente_rendicion') THEN
    RAISE EXCEPTION 'El cobro está % : solo se vinculan cobros pendientes.', v_pago.estado;
  END IF;

  SELECT * INTO v_det FROM pagos_detalle WHERE id = p_detalle_id AND pago_id = p_pago_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La transferencia no es de ese cobro.';
  END IF;
  IF v_det.tipo_pago NOT IN ('transferencia', 'deposito') THEN
    RAISE EXCEPTION 'Ese renglón del cobro no es una transferencia ni un depósito.';
  END IF;
  IF abs(round(v_det.monto, 2) - round(v_mov.monto, 2)) >= 1 THEN
    RAISE EXCEPTION 'El monto no coincide: el banco dice % y el cobro %.', v_mov.monto, v_det.monto;
  END IF;
  SELECT count(*) INTO v_otros FROM pagos_detalle WHERE pago_id = p_pago_id AND id <> p_detalle_id;
  IF v_otros > 0 THEN
    RAISE EXCEPTION 'El cobro tiene otros medios de pago: confirmalo a mano desde su fila en Caja.';
  END IF;
  IF EXISTS (SELECT 1 FROM banco_transferencias_vinculos WHERE pago_detalle_id = p_detalle_id) THEN
    RAISE EXCEPTION 'Esa transferencia ya está vinculada a otro movimiento del banco.';
  END IF;

  -- El banco manda: la plata entró a ESA cuenta, ese día
  UPDATE pagos_detalle
     SET cuenta_bancaria_id = v_mov.cuenta_bancaria_id,
         fecha_transferencia = coalesce(fecha_transferencia, v_mov.fecha)
   WHERE id = p_detalle_id;

  INSERT INTO banco_transferencias_vinculos (movimiento_id, pago_id, pago_detalle_id, cliente_id, origen, fuente, creado_por)
  VALUES (p_mov_id, p_pago_id, p_detalle_id, v_pago.cliente_id, p_origen, v_mov.fuente_detalle, p_usuario_id);

  -- La misma confirmación que /caja
  v_res := cobranza_confirmar(p_pago_id, p_usuario_id);

  SELECT k.id INTO v_kardex
    FROM kardex_contable k
   WHERE k.pago_id = p_pago_id AND k.referencia_tipo = 'pago_cliente'
     AND k.kardex_reversa_de IS NULL
   ORDER BY (k.destino_tipo = 'BANCO' AND k.destino_id = v_mov.cuenta_bancaria_id) DESC, k.created_at
   LIMIT 1;

  UPDATE banco_extractos_movimientos
     SET estado_matching = 'CONCILIADO', pago_id = p_pago_id, kardex_id = v_kardex,
         matcheado_por = p_usuario_id, matcheado_at = now()
   WHERE id = p_mov_id;

  -- El banco es la segunda firma: verificado por conciliación, con la fuente del movimiento
  UPDATE pagos_clientes
     SET verificado_por = coalesce(verificado_por, p_usuario_id),
         verificado_at = coalesce(verificado_at, now()),
         verificacion_metodo = 'conciliacion',
         verificacion_fuente = coalesce(v_mov.fuente_detalle, 'extracto')
   WHERE id = p_pago_id;
  UPDATE kardex_contable
     SET verificado = true, verificado_por = coalesce(verificado_por, p_usuario_id), verificado_at = coalesce(verificado_at, now())
   WHERE pago_id = p_pago_id AND verificado = false;

  RETURN v_res || jsonb_build_object('kardex_id', v_kardex, 'movimiento_id', p_mov_id);
END;
$$;

REVOKE ALL ON FUNCTION public.banco_transferencia_conciliar(uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.banco_transferencia_conciliar(uuid, uuid, uuid, uuid, text) TO service_role;

-- Probar (sin tocar nada):
--   SELECT * FROM public.banco_transferencias_ajustes;          -- modo_propuesta = true
--   SELECT count(*) FROM public.clientes_pagadores;

-- ════════ supabase/migrations/20261127d_bancos_cheques.sql ════════
-- ════════════════════════════════════════════════════════════════════════════════════════
-- Bancos — Tanda 4: cheques trazables contra el banco (27/11/2026)
-- Plan: docs/bancos/PLAN-BANCOS.md
-- ════════════════════════════════════════════════════════════════════════════════════════
-- 1. cheques: columnas que el código ya usa y pueden faltar (fecha_deposito, fecha_rechazo,
--    motivo_rechazo, fecha_debito) + fecha_acreditacion_esperada (depósito + N días hábiles).
--    cuentas_bancarias.cheque_dias_acreditacion: días hábiles de cada banco (vacío = 2, "48 h").
-- 2. dias_habiles_sumar: salta sábados, domingos y feriados/puentes de calendario_dias.
--    Trigger: al pasar a DEPOSITADO se calcula la fecha esperada de acreditación.
-- 3. cheques_banco_ajustes (una fila): modo propuesta (por defecto PRENDIDO: solo propone),
--    días de alerta (4 hábiles = 96 h).
-- 4. cheques_banco_vinculos: qué movimiento del banco se usó para qué cheque (nada se usa dos veces).
--    cheques_banco_avisos: rechazos para confirmar y propuestas (modo propuesta).
-- 5. cheque_banco_aplicar: acredita (caja_acreditar_cheque) o debita un propio
--    (cheque_propio_debitar) con el renglón del banco, revalidando todo y marcando el renglón
--    CONCILIADO, en una sola transacción.
--    cheque_banco_confirmar_rechazo: el dueño confirma → cheque_rechazar (ND al cliente).
--    NUNCA corre sola: solo desde el botón "Confirmar rechazo" (service_role).
-- 6. Vista cheques_banco_demorados (para el vigía de Jarvis): depositados sin acreditar a las 96 h.
--
-- No mueve plata al aplicarse. Idempotente: se puede correr más de una vez.
-- ════════════════════════════════════════════════════════════════════════════════════════

-- ─── 1. Columnas ────────────────────────────────────────────────────────────────────────
ALTER TABLE public.cheques
  ADD COLUMN IF NOT EXISTS fecha_deposito              date,
  ADD COLUMN IF NOT EXISTS fecha_rechazo               date,
  ADD COLUMN IF NOT EXISTS motivo_rechazo              text,
  ADD COLUMN IF NOT EXISTS fecha_debito                date,
  ADD COLUMN IF NOT EXISTS fecha_acreditacion_esperada date;
COMMENT ON COLUMN public.cheques.fecha_acreditacion_esperada IS
  'Depositado: cuándo se espera que el banco lo acredite (depósito + días hábiles del banco). Bancos tanda 4.';

ALTER TABLE public.cuentas_bancarias
  ADD COLUMN IF NOT EXISTS cheque_dias_acreditacion smallint;
COMMENT ON COLUMN public.cuentas_bancarias.cheque_dias_acreditacion IS
  'Días hábiles que tarda el banco en acreditar un cheque depositado. Vacío = 2 (48 h).';

-- ─── 2. Días hábiles bancarios ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dias_habiles_sumar(p_desde date, p_dias int)
RETURNS date
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d date := p_desde;
  v_n int := 0;
  v_hay_cal boolean := to_regclass('public.calendario_dias') IS NOT NULL;
  v_feriado boolean;
BEGIN
  IF p_desde IS NULL THEN RETURN NULL; END IF;
  WHILE v_n < GREATEST(COALESCE(p_dias, 0), 0) LOOP
    v_d := v_d + 1;
    CONTINUE WHEN extract(isodow FROM v_d) IN (6, 7);
    v_feriado := false;
    IF v_hay_cal THEN
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.calendario_dias WHERE fecha = $1 AND tipo IN (''feriado'', ''puente''))'
        INTO v_feriado USING v_d;
    END IF;
    CONTINUE WHEN v_feriado;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_d;
END;
$$;

-- ─── 3. Ajustes ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cheques_banco_ajustes (
  id              boolean PRIMARY KEY DEFAULT true CHECK (id),
  modo_propuesta  boolean NOT NULL DEFAULT true,
  dias_alerta     smallint NOT NULL DEFAULT 4,
  actualizado_por uuid,
  actualizado_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.cheques_banco_ajustes IS
  'Cheques contra el banco. modo_propuesta = solo propone acreditaciones/débitos (no los hace). dias_alerta = días hábiles sin acreditar para avisar (4 = 96 h).';
INSERT INTO public.cheques_banco_ajustes (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.cheques_banco_ajustes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cheques_banco_ajustes FROM anon;
GRANT SELECT ON TABLE public.cheques_banco_ajustes TO authenticated;
GRANT ALL ON TABLE public.cheques_banco_ajustes TO service_role;
DO $$
BEGIN
  CREATE POLICY "cheques_banco_ajustes_leer" ON public.cheques_banco_ajustes FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Fecha esperada de acreditación al pasar a DEPOSITADO
CREATE OR REPLACE FUNCTION public.cheque_fecha_esperada_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dias  int;
  v_calc  boolean := false;
BEGIN
  IF NEW.estado::text = 'DEPOSITADO' THEN
    IF TG_OP = 'INSERT' OR NEW.fecha_acreditacion_esperada IS NULL THEN
      v_calc := true;
    ELSIF OLD.estado::text IS DISTINCT FROM 'DEPOSITADO'
       OR OLD.fecha_deposito IS DISTINCT FROM NEW.fecha_deposito
       OR OLD.cuenta_banco_id IS DISTINCT FROM NEW.cuenta_banco_id THEN
      v_calc := true;
    END IF;
  END IF;
  IF v_calc THEN
    SELECT cb.cheque_dias_acreditacion INTO v_dias FROM cuentas_bancarias cb WHERE cb.id = NEW.cuenta_banco_id;
    NEW.fecha_acreditacion_esperada := dias_habiles_sumar(COALESCE(NEW.fecha_deposito, hoy_ar()), COALESCE(v_dias, 2));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_cheque_fecha_esperada ON public.cheques;
CREATE TRIGGER trg_cheque_fecha_esperada
  BEFORE INSERT OR UPDATE OF estado, fecha_deposito, cuenta_banco_id ON public.cheques
  FOR EACH ROW EXECUTE FUNCTION public.cheque_fecha_esperada_trg();

-- Los que ya estaban depositados
UPDATE public.cheques c
   SET fecha_acreditacion_esperada = public.dias_habiles_sumar(
         COALESCE(c.fecha_deposito, public.hoy_ar()),
         COALESCE((SELECT cb.cheque_dias_acreditacion FROM public.cuentas_bancarias cb WHERE cb.id = c.cuenta_banco_id), 2))
 WHERE c.estado::text = 'DEPOSITADO' AND c.fecha_acreditacion_esperada IS NULL;

-- ─── 4. Vínculos y avisos ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cheques_banco_vinculos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movimiento_id  uuid NOT NULL REFERENCES public.banco_extractos_movimientos(id) ON DELETE CASCADE,
  cheque_id      uuid NOT NULL REFERENCES public.cheques(id) ON DELETE CASCADE,
  rol            varchar(20) NOT NULL CHECK (rol IN ('acreditacion', 'comision', 'debito_propio', 'rechazo')),
  kardex_id      uuid,
  automatico     boolean NOT NULL DEFAULT false,
  creado_por     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (movimiento_id, cheque_id, rol)
);
CREATE INDEX IF NOT EXISTS idx_cbv_cheque ON public.cheques_banco_vinculos (cheque_id);
COMMENT ON TABLE public.cheques_banco_vinculos IS 'Qué renglón del banco acreditó / debitó / rechazó qué cheque (bancos tanda 4).';

CREATE TABLE IF NOT EXISTS public.cheques_banco_avisos (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo                   varchar(12) NOT NULL CHECK (tipo IN ('rechazo', 'acreditar', 'debitar')),
  movimiento_id          uuid NOT NULL REFERENCES public.banco_extractos_movimientos(id) ON DELETE CASCADE,
  cuenta_bancaria_id     uuid REFERENCES public.cuentas_bancarias(id),
  fecha                  date,
  monto                  numeric(14,2),
  descripcion            text,
  -- rechazo: cheques posibles (el dueño elige); acreditar/debitar: los que se aplicarían
  cheque_ids             uuid[] NOT NULL DEFAULT '{}',
  comision_movimiento_id uuid REFERENCES public.banco_extractos_movimientos(id) ON DELETE SET NULL,
  estado                 varchar(12) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aplicado', 'descartado')),
  resultado              jsonb,
  creado_at              timestamptz NOT NULL DEFAULT now(),
  resuelto_por           uuid,
  resuelto_at            timestamptz,
  UNIQUE (movimiento_id, tipo)
);
CREATE INDEX IF NOT EXISTS idx_cba_pendientes ON public.cheques_banco_avisos (estado, tipo) WHERE estado = 'pendiente';
COMMENT ON TABLE public.cheques_banco_avisos IS
  'Cheques contra el banco: rechazos que el dueño confirma (ND al cliente) y propuestas del modo propuesta.';

ALTER TABLE public.cheques_banco_vinculos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cheques_banco_avisos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cheques_banco_vinculos FROM anon;
REVOKE ALL ON TABLE public.cheques_banco_avisos FROM anon;
GRANT SELECT ON TABLE public.cheques_banco_vinculos TO authenticated;
GRANT SELECT, INSERT ON TABLE public.cheques_banco_avisos TO authenticated;
GRANT ALL ON TABLE public.cheques_banco_vinculos TO service_role;
GRANT ALL ON TABLE public.cheques_banco_avisos TO service_role;
DO $$
BEGIN
  CREATE POLICY "cbv_leer" ON public.cheques_banco_vinculos FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE POLICY "cba_leer" ON public.cheques_banco_avisos FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- El import (sesión del usuario) anota avisos nuevos; resolverlos es solo por las funciones de abajo
DO $$
BEGIN
  CREATE POLICY "cba_anotar" ON public.cheques_banco_avisos FOR INSERT TO authenticated WITH CHECK (estado = 'pendiente');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 5. Aplicar con el renglón del banco ────────────────────────────────────────────────
-- p_accion: 'acreditar' (uno o varios cheques de terceros DEPOSITADOS que suman el crédito) o
-- 'debitar' (un cheque propio ENTREGADO_A_PROVEEDOR). Todo se vuelve a controlar acá adentro:
-- renglón PENDIENTE y sin usar, misma cuenta, importes exactos al centavo.
CREATE OR REPLACE FUNCTION public.cheque_banco_aplicar(
  p_movimiento_id          uuid,
  p_accion                 text,
  p_cheque_ids             uuid[],
  p_comision_movimiento_id uuid DEFAULT NULL,
  p_usuario_id             uuid DEFAULT NULL,
  p_automatico             boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mov    banco_extractos_movimientos%ROWTYPE;
  v_com    banco_extractos_movimientos%ROWTYPE;
  v_ch     cheques%ROWTYPE;
  v_suma   numeric := 0;
  v_n      int := COALESCE(array_length(p_cheque_ids, 1), 0);
  v_gastos numeric := 0;
  v_res    jsonb;
  v_kardex uuid;
  v_primer uuid;
  v_id     uuid;
BEGIN
  SELECT * INTO v_mov FROM banco_extractos_movimientos WHERE id = p_movimiento_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'motivo', 'El renglón del banco no existe.'); END IF;
  IF v_mov.estado_matching <> 'PENDIENTE' OR EXISTS (SELECT 1 FROM cheques_banco_vinculos WHERE movimiento_id = p_movimiento_id AND rol <> 'rechazo') THEN
    RETURN jsonb_build_object('success', false, 'motivo', 'El renglón del banco ya está usado.');
  END IF;
  IF v_n = 0 THEN RETURN jsonb_build_object('success', false, 'motivo', 'Sin cheques.'); END IF;

  IF p_accion = 'acreditar' THEN
    IF v_mov.monto <= 0 THEN RETURN jsonb_build_object('success', false, 'motivo', 'El renglón no es un crédito.'); END IF;
    FOR v_id IN SELECT unnest(p_cheque_ids) ORDER BY 1 LOOP
      SELECT * INTO v_ch FROM cheques WHERE id = v_id FOR UPDATE;
      IF NOT FOUND OR v_ch.estado::text <> 'DEPOSITADO' OR v_ch.cuenta_banco_id IS DISTINCT FROM v_mov.cuenta_bancaria_id THEN
        RETURN jsonb_build_object('success', false, 'motivo', 'Un cheque ya no está depositado en esa cuenta.');
      END IF;
      v_suma := v_suma + abs(v_ch.monto);
    END LOOP;
    IF abs(v_suma - v_mov.monto) >= 0.005 THEN
      RETURN jsonb_build_object('success', false, 'motivo', 'Los importes no coinciden.');
    END IF;

    -- Comisión del banco por ese cheque (solo con un cheque y si el renglón sigue sin usar)
    IF p_comision_movimiento_id IS NOT NULL AND v_n = 1 THEN
      SELECT * INTO v_com FROM banco_extractos_movimientos WHERE id = p_comision_movimiento_id FOR UPDATE;
      IF FOUND AND v_com.estado_matching = 'PENDIENTE' AND v_com.monto < 0
         AND v_com.cuenta_bancaria_id = v_mov.cuenta_bancaria_id AND v_com.fecha = v_mov.fecha
         AND NOT EXISTS (SELECT 1 FROM cheques_banco_vinculos WHERE movimiento_id = v_com.id) THEN
        v_gastos := abs(v_com.monto);
      ELSE
        p_comision_movimiento_id := NULL;
      END IF;
    ELSE
      p_comision_movimiento_id := NULL;
    END IF;

    FOR v_id IN SELECT unnest(p_cheque_ids) ORDER BY 1 LOOP
      v_res := caja_acreditar_cheque(v_id, CASE WHEN p_comision_movimiento_id IS NOT NULL THEN v_gastos ELSE 0 END, p_usuario_id);
      v_kardex := NULLIF(v_res->>'kardex_id', '')::uuid;
      v_primer := COALESCE(v_primer, v_kardex);
      INSERT INTO cheques_banco_vinculos (movimiento_id, cheque_id, rol, kardex_id, automatico, creado_por)
      VALUES (p_movimiento_id, v_id, 'acreditacion', v_kardex, p_automatico, p_usuario_id)
      ON CONFLICT DO NOTHING;
      IF p_comision_movimiento_id IS NOT NULL THEN
        INSERT INTO cheques_banco_vinculos (movimiento_id, cheque_id, rol, kardex_id, automatico, creado_por)
        VALUES (p_comision_movimiento_id, v_id, 'comision', v_kardex, p_automatico, p_usuario_id)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;

    IF p_comision_movimiento_id IS NOT NULL THEN
      UPDATE banco_extractos_movimientos
         SET estado_matching = 'CONCILIADO', matcheado_por = p_usuario_id, matcheado_at = now()
       WHERE id = p_comision_movimiento_id;
    END IF;

  ELSIF p_accion = 'debitar' THEN
    IF v_mov.monto >= 0 OR v_n <> 1 THEN RETURN jsonb_build_object('success', false, 'motivo', 'El renglón no es un débito de un cheque.'); END IF;
    SELECT * INTO v_ch FROM cheques WHERE id = p_cheque_ids[1] FOR UPDATE;
    IF NOT FOUND OR v_ch.tipo::text <> 'PROPIO' OR v_ch.estado::text <> 'ENTREGADO_A_PROVEEDOR'
       OR (v_ch.cuenta_banco_id IS NOT NULL AND v_ch.cuenta_banco_id <> v_mov.cuenta_bancaria_id) THEN
      RETURN jsonb_build_object('success', false, 'motivo', 'El cheque propio ya no está entregado o es de otra cuenta.');
    END IF;
    IF abs(abs(v_ch.monto) - abs(v_mov.monto)) >= 0.005 THEN
      RETURN jsonb_build_object('success', false, 'motivo', 'Los importes no coinciden.');
    END IF;
    v_res := cheque_propio_debitar(v_ch.id, v_mov.fecha, v_mov.cuenta_bancaria_id, p_usuario_id);
    v_primer := NULLIF(v_res->>'kardex_id', '')::uuid;
    INSERT INTO cheques_banco_vinculos (movimiento_id, cheque_id, rol, kardex_id, automatico, creado_por)
    VALUES (p_movimiento_id, v_ch.id, 'debito_propio', v_primer, p_automatico, p_usuario_id)
    ON CONFLICT DO NOTHING;
  ELSE
    RETURN jsonb_build_object('success', false, 'motivo', 'Acción desconocida.');
  END IF;

  UPDATE banco_extractos_movimientos
     SET estado_matching = 'CONCILIADO', kardex_id = COALESCE(v_primer, kardex_id),
         matcheado_por = p_usuario_id, matcheado_at = now()
   WHERE id = p_movimiento_id;

  UPDATE cheques_banco_avisos
     SET estado = 'aplicado', resuelto_por = p_usuario_id, resuelto_at = now(),
         resultado = jsonb_build_object('gastos', v_gastos, 'kardex_id', v_primer)
   WHERE movimiento_id = p_movimiento_id AND tipo = p_accion AND estado = 'pendiente';

  RETURN jsonb_build_object('success', true, 'cheques', v_n, 'gastos', v_gastos, 'kardex_id', v_primer);
END;
$$;
REVOKE ALL ON FUNCTION public.cheque_banco_aplicar(uuid, text, uuid[], uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cheque_banco_aplicar(uuid, text, uuid[], uuid, uuid, boolean) TO authenticated, service_role;

-- Rechazo: SOLO con el botón del dueño. Corre el cheque_rechazar de siempre (ND al cliente si
-- el cobro estaba confirmado). El débito del banco queda en Conciliación para registrarlo.
CREATE OR REPLACE FUNCTION public.cheque_banco_confirmar_rechazo(
  p_aviso_id   uuid,
  p_cheque_id  uuid,
  p_usuario_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_av  cheques_banco_avisos%ROWTYPE;
  v_res jsonb;
BEGIN
  IF p_usuario_id IS NULL THEN RAISE EXCEPTION 'Falta quién confirma el rechazo.'; END IF;
  SELECT * INTO v_av FROM cheques_banco_avisos WHERE id = p_aviso_id FOR UPDATE;
  IF NOT FOUND OR v_av.tipo <> 'rechazo' THEN RAISE EXCEPTION 'El aviso de rechazo no existe.'; END IF;
  IF v_av.estado <> 'pendiente' THEN RETURN jsonb_build_object('success', false, 'motivo', 'El aviso ya se resolvió.'); END IF;
  IF NOT (p_cheque_id = ANY (v_av.cheque_ids)) THEN RAISE EXCEPTION 'Ese cheque no es uno de los posibles de este rechazo.'; END IF;

  v_res := cheque_rechazar(p_cheque_id, p_usuario_id,
             'Rechazo informado por el banco el ' || to_char(v_av.fecha, 'DD/MM/YYYY') || COALESCE(' (' || left(v_av.descripcion, 80) || ')', ''), 0);

  INSERT INTO cheques_banco_vinculos (movimiento_id, cheque_id, rol, automatico, creado_por)
  VALUES (v_av.movimiento_id, p_cheque_id, 'rechazo', false, p_usuario_id)
  ON CONFLICT DO NOTHING;

  UPDATE cheques_banco_avisos
     SET estado = 'aplicado', resuelto_por = p_usuario_id, resuelto_at = now(),
         resultado = v_res || jsonb_build_object('cheque_id', p_cheque_id)
   WHERE id = p_aviso_id;
  RETURN v_res;
END;
$$;
REVOKE ALL ON FUNCTION public.cheque_banco_confirmar_rechazo(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cheque_banco_confirmar_rechazo(uuid, uuid, uuid) TO service_role;

-- ─── 6. Demorados (para el vigía de Jarvis) ─────────────────────────────────────────────
CREATE OR REPLACE VIEW public.cheques_banco_demorados WITH (security_invoker = true) AS
SELECT c.id, c.numero, c.banco, c.monto, c.es_echeq, c.cuenta_banco_id, cb.nombre AS cuenta_nombre,
       c.fecha_deposito, c.fecha_acreditacion_esperada,
       public.dias_habiles_sumar(c.fecha_deposito, COALESCE(a.dias_alerta, 4)) AS fecha_alerta
  FROM public.cheques c
  LEFT JOIN public.cuentas_bancarias cb ON cb.id = c.cuenta_banco_id
  LEFT JOIN public.cheques_banco_ajustes a ON a.id
 WHERE c.estado::text = 'DEPOSITADO'
   AND c.fecha_deposito IS NOT NULL
   AND public.hoy_ar() >= public.dias_habiles_sumar(c.fecha_deposito, COALESCE(a.dias_alerta, 4));
REVOKE ALL ON public.cheques_banco_demorados FROM anon;
GRANT SELECT ON public.cheques_banco_demorados TO authenticated, service_role;

-- ════════ supabase/migrations/20261127e_bancos_control_diario.sql ════════
-- ════════════════════════════════════════════════════════════════════════════════════════
-- Bancos — Tanda 5: control diario (27/11/2026)
-- Plan: docs/bancos/PLAN-BANCOS.md · Lógica: lib/bancos/control/
-- ════════════════════════════════════════════════════════════════════════════════════════
-- 1. bancos_cargos_ajustes (una fila): modo propuesta para los cargos del banco (impuestos,
--    comisiones, débitos automáticos, servicios, ARCA, rendimientos). Por defecto ENCENDIDO: el
--    sistema solo lista lo que registraría y una persona aprieta "Registrar todo". `desde`: no se
--    registra nada anterior a ese día (lo viejo pudo haberse cargado a mano como gasto).
-- 2. bancos_cargos_registrados: qué renglón del banco se registró como gasto / ingreso por esta
--    tanda (UNIQUE por movimiento: nunca dos veces).
-- 3. bancos_registrar_cargo(): vuelve a controlar todo adentro (renglón PENDIENTE, sin vínculo de
--    las tandas 3/4, no reservado como comisión de un cheque) y registra por el MISMO camino de
--    siempre: extracto_registrar_egreso (caja_egreso: egreso + kardex + saldo) o
--    extracto_registrar_ingreso (kardex INGRESO_BANCARIO). El renglón queda REGISTRADO_EGRESO /
--    REGISTRADO_INGRESO.
--
-- No toca cuentas corrientes. Idempotente: se puede correr más de una vez.
-- ════════════════════════════════════════════════════════════════════════════════════════

-- ─── 1. Ajustes ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bancos_cargos_ajustes (
  id                   boolean PRIMARY KEY DEFAULT true CHECK (id),
  modo_propuesta       boolean NOT NULL DEFAULT true,
  -- Primer día que se registra (lo anterior queda para mirar a mano). Vacío = últimos 60 días.
  desde                date,
  -- En nombre de quién registra el sistema: el admin que apagó el modo propuesta
  confirma_usuario_id  uuid,
  cambiado_por         uuid,
  cambiado_at          timestamptz
);
INSERT INTO public.bancos_cargos_ajustes (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
COMMENT ON TABLE public.bancos_cargos_ajustes IS
  'Cargos del banco al libro de fondos (bancos tanda 5). modo_propuesta = solo lista; en false registra solo, en nombre de confirma_usuario_id. Se cambia desde Finanzas → Control de bancos (solo admin).';

ALTER TABLE public.bancos_cargos_ajustes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bancos_cargos_ajustes FROM anon;
GRANT SELECT ON TABLE public.bancos_cargos_ajustes TO authenticated;
GRANT ALL ON TABLE public.bancos_cargos_ajustes TO service_role;
DO $$
BEGIN
  CREATE POLICY "bancos_cargos_ajustes_leer" ON public.bancos_cargos_ajustes FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 2. Registro ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bancos_cargos_registrados (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movimiento_id  uuid NOT NULL UNIQUE REFERENCES public.banco_extractos_movimientos(id) ON DELETE CASCADE,
  tipo           varchar(7) NOT NULL CHECK (tipo IN ('egreso', 'ingreso')),
  categoria      text,
  concepto_id    text,
  kardex_id      uuid,
  automatico     boolean NOT NULL DEFAULT false,
  creado_por     uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.bancos_cargos_registrados IS
  'Renglones del banco (impuestos, comisiones, débitos automáticos, rendimientos) registrados en el libro de fondos por la tanda 5. Único por movimiento.';

ALTER TABLE public.bancos_cargos_registrados ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bancos_cargos_registrados FROM anon;
GRANT SELECT ON TABLE public.bancos_cargos_registrados TO authenticated;
GRANT ALL ON TABLE public.bancos_cargos_registrados TO service_role;
DO $$
BEGIN
  CREATE POLICY "bancos_cargos_registrados_leer" ON public.bancos_cargos_registrados FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 3. Registrar un cargo ──────────────────────────────────────────────────────────────
-- Devuelve {success:false, motivo} si el renglón ya no se puede registrar (lo tomó otra tanda,
-- ya está registrado, etc.). Si caja_egreso falla (p. ej. saldo insuficiente en el sistema),
-- la excepción sube y no queda nada a medias.
CREATE OR REPLACE FUNCTION public.bancos_registrar_cargo(
  p_mov_id      uuid,
  p_categoria   text,          -- OPERATIVO | IMPUESTOS | CREDITO | OTROS (solo débitos)
  p_concepto    text,
  p_concepto_id text DEFAULT NULL,
  p_usuario_id  uuid DEFAULT NULL,
  p_automatico  boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mov   banco_extractos_movimientos%ROWTYPE;
  v_res   jsonb;
  v_tipo  text;
  v_otro  boolean;
BEGIN
  SELECT * INTO v_mov FROM banco_extractos_movimientos WHERE id = p_mov_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'motivo', 'Movimiento no encontrado');
  END IF;
  IF v_mov.estado_matching <> 'PENDIENTE' OR v_mov.kardex_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'motivo', 'El movimiento ya está ' || v_mov.estado_matching);
  END IF;
  IF EXISTS (SELECT 1 FROM bancos_cargos_registrados WHERE movimiento_id = p_mov_id) THEN
    RETURN jsonb_build_object('success', false, 'motivo', 'Ya estaba registrado');
  END IF;

  -- Tomado por las tandas 3 / 4 (las tablas pueden no existir si esas migraciones no se aplicaron)
  IF to_regclass('public.banco_transferencias_vinculos') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.banco_transferencias_vinculos WHERE movimiento_id = $1)' INTO v_otro USING p_mov_id;
    IF v_otro THEN RETURN jsonb_build_object('success', false, 'motivo', 'Vinculado a una transferencia'); END IF;
  END IF;
  IF to_regclass('public.cheques_banco_vinculos') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.cheques_banco_vinculos WHERE movimiento_id = $1)' INTO v_otro USING p_mov_id;
    IF v_otro THEN RETURN jsonb_build_object('success', false, 'motivo', 'Vinculado a un cheque'); END IF;
  END IF;
  IF to_regclass('public.cheques_banco_avisos') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.cheques_banco_avisos WHERE estado = ''pendiente'' AND (movimiento_id = $1 OR comision_movimiento_id = $1))' INTO v_otro USING p_mov_id;
    IF v_otro THEN RETURN jsonb_build_object('success', false, 'motivo', 'Reservado por una propuesta de cheques'); END IF;
  END IF;

  IF v_mov.monto < 0 THEN
    IF coalesce(p_categoria, '') NOT IN ('OPERATIVO', 'IMPUESTOS', 'CREDITO', 'OTROS') THEN
      RETURN jsonb_build_object('success', false, 'motivo', 'Categoría inválida');
    END IF;
    v_tipo := 'egreso';
    v_res := extracto_registrar_egreso(p_mov_id, p_categoria, p_usuario_id, p_concepto);
  ELSIF v_mov.monto > 0 THEN
    v_tipo := 'ingreso';
    v_res := extracto_registrar_ingreso(p_mov_id, p_usuario_id, p_concepto);
  ELSE
    RETURN jsonb_build_object('success', false, 'motivo', 'Importe en cero');
  END IF;

  INSERT INTO bancos_cargos_registrados (movimiento_id, tipo, categoria, concepto_id, kardex_id, automatico, creado_por)
  VALUES (p_mov_id, v_tipo, CASE WHEN v_tipo = 'egreso' THEN p_categoria END, p_concepto_id,
          (v_res->>'kardex_id')::uuid, coalesce(p_automatico, false), p_usuario_id);

  RETURN jsonb_build_object('success', true, 'tipo', v_tipo, 'kardex_id', v_res->>'kardex_id');
END;
$$;
REVOKE ALL ON FUNCTION public.bancos_registrar_cargo(uuid, text, text, text, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bancos_registrar_cargo(uuid, text, text, text, uuid, boolean) TO service_role;

-- Probar (sin registrar nada):
--   SELECT * FROM public.bancos_cargos_ajustes;                 -- modo_propuesta = true
--   SELECT m.concepto_id, count(*), sum(m.monto) FROM banco_extractos_movimientos m
--    JOIN bancos_conceptos c ON c.id = m.concepto_id
--   WHERE m.estado_matching = 'PENDIENTE' AND c.tipo IN ('impuesto', 'gasto', 'pago') GROUP BY 1;
