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
