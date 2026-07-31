-- ─────────────────────────────────────────────────────────────────────────────
-- FASE R1 — Base fiscal para retenciones de Ganancias a proveedores (RG 830)
--
-- Alcance definido con el usuario (31-07-2026): SOLO Ganancias. No somos
-- agentes de IIBB en ninguna jurisdicción ni de IVA/SUSS.
--
-- Piezas:
--   1. retencion_regimenes — regímenes RG 830 parametrizados CON VIGENCIAS
--      (nunca hardcodear alícuotas/mínimos). Códigos del TXT SICORE clonados
--      del sistema anterior (impuesto 0217, régimen 0021 — RET_OP_GAN_202606).
--   2. retenciones_emitidas — certificados que NOSOTROS emitimos a proveedores.
--      (La tabla `retenciones` existente queda intacta: es SOLO de las
--      retenciones que los clientes nos practican a nosotros.)
--   3. Ficha fiscal del proveedor: régimen asignado + condición Ganancias.
--   4. Numeración atómica: OP (formato 0001-XXXXXXXX, compatible SICORE) y
--      certificados (formato AAAA-XXXXXXXX, como el sistema anterior).
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. Regímenes RG 830 ═══
CREATE TABLE IF NOT EXISTS public.retencion_regimenes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave                 varchar(30) NOT NULL,          -- 'bienes' | 'transporte' | 'servicios'…
  descripcion           text NOT NULL,
  codigo_impuesto_txt   varchar(4) NOT NULL DEFAULT '0217',  -- SICORE: Ganancias
  codigo_regimen_txt    varchar(4) NOT NULL DEFAULT '0021',  -- clonado del TXT del sistema anterior
  alicuota_inscripto    numeric(6,3) NOT NULL,
  alicuota_no_inscripto numeric(6,3) NOT NULL,
  minimo_no_sujeto      numeric(14,2) NOT NULL DEFAULT 0,    -- sobre acumulado mensual
  retencion_minima      numeric(14,2) NOT NULL DEFAULT 0,    -- no se practica si da menos
  vigencia_desde        date NOT NULL,
  vigencia_hasta        date,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_retencion_regimen_vigente
  ON public.retencion_regimenes (clave, vigencia_desde);

ALTER TABLE public.retencion_regimenes ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  CREATE POLICY "ret_regimenes_auth_all" ON public.retencion_regimenes
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Seed: valores Anexo VIII RG 830 (s/RG 4525, vigentes s/fuentes 07-2026).
-- ⚠ Verificables/editables desde la tabla — si ARCA los actualiza, se cierra
-- la vigencia de la fila vieja y se inserta la nueva.
INSERT INTO public.retencion_regimenes
  (clave, descripcion, alicuota_inscripto, alicuota_no_inscripto, minimo_no_sujeto, retencion_minima, vigencia_desde)
SELECT * FROM (VALUES
  ('bienes',     'Enajenación de bienes muebles y bienes de cambio', 2.000, 10.000, 224000.00, 240.00, DATE '2019-08-01'),
  ('transporte', 'Transporte de carga',                              0.250, 28.000,   6700.00, 240.00, DATE '2019-08-01'),
  ('servicios',  'Locaciones de obra y/o servicios',                 2.000, 28.000,  67170.00, 240.00, DATE '2019-08-01')
) v(clave, descripcion, ai, ani, min, rmin, vd)
WHERE NOT EXISTS (SELECT 1 FROM retencion_regimenes r WHERE r.clave = v.clave);

-- ═══ 2. Certificados emitidos ═══
CREATE TABLE IF NOT EXISTS public.retenciones_emitidas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_pago_id       uuid NOT NULL REFERENCES ordenes_pago(id),
  proveedor_id        uuid NOT NULL REFERENCES proveedores(id),
  regimen_id          uuid REFERENCES retencion_regimenes(id),
  fecha               date NOT NULL,
  base_calculo        numeric(14,2) NOT NULL,
  acumulado_mes       numeric(14,2),                 -- base acumulada del mes (auditoría del cálculo)
  alicuota            numeric(6,3) NOT NULL,
  monto               numeric(14,2) NOT NULL,
  numero_certificado  varchar(20) NOT NULL UNIQUE,   -- AAAA-XXXXXXXX
  estado              varchar(12) NOT NULL DEFAULT 'emitida'
                      CHECK (estado IN ('emitida', 'anulada')),
  ajuste_manual       boolean NOT NULL DEFAULT false,
  motivo_ajuste       text,
  pdf_url             text,
  creado_por          uuid,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ret_emitidas_periodo ON public.retenciones_emitidas (fecha, estado);
CREATE INDEX IF NOT EXISTS idx_ret_emitidas_prov ON public.retenciones_emitidas (proveedor_id, fecha);

ALTER TABLE public.retenciones_emitidas ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  CREATE POLICY "ret_emitidas_auth_all" ON public.retenciones_emitidas
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ═══ 3. Ficha fiscal del proveedor ═══
ALTER TABLE public.proveedores
  ADD COLUMN IF NOT EXISTS regimen_ganancias varchar(30) NOT NULL DEFAULT 'bienes',
  ADD COLUMN IF NOT EXISTS condicion_ganancias varchar(15) NOT NULL DEFAULT 'inscripto';

DO $$
BEGIN
  ALTER TABLE public.proveedores
    ADD CONSTRAINT proveedores_condicion_ganancias_check
    CHECK (condicion_ganancias IN ('inscripto', 'no_inscripto'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ═══ 4. Numeración atómica ═══
-- OP: formato 0001-XXXXXXXX (numérico puro, compatible con el campo Nº de
-- comprobante del TXT SICORE). Si querés continuar la serie del sistema
-- anterior (última OP 0001-00020233 en jun-2026), corré después:
--   UPDATE numeracion_comprobantes SET ultimo_numero = 20332
--   WHERE tipo_comprobante = 'OP' AND punto_venta = '0001';
INSERT INTO public.numeracion_comprobantes (tipo_comprobante, punto_venta, ultimo_numero)
SELECT 'OP', '0001', 0
WHERE NOT EXISTS (
  SELECT 1 FROM numeracion_comprobantes WHERE tipo_comprobante = 'OP' AND punto_venta = '0001'
);

-- Certificados de retención: serie anual AAAA-XXXXXXXX. Para continuar la
-- serie del sistema anterior (último certificado 2026-00000120 en jun-2026):
--   UPDATE numeracion_comprobantes SET ultimo_numero = 120
--   WHERE tipo_comprobante = 'RETGAN' AND punto_venta = '2026';
INSERT INTO public.numeracion_comprobantes (tipo_comprobante, punto_venta, ultimo_numero)
SELECT 'RETGAN', '2026', 0
WHERE NOT EXISTS (
  SELECT 1 FROM numeracion_comprobantes WHERE tipo_comprobante = 'RETGAN' AND punto_venta = '2026'
);

-- UNIQUE en numero_op (hoy no lo tiene — la numeración JS tenía race condition)
CREATE UNIQUE INDEX IF NOT EXISTS uq_ordenes_pago_numero ON public.ordenes_pago (numero_op);

-- RPC de numeración atómica de OP (mismo patrón FOR UPDATE que recibos/remitos)
CREATE OR REPLACE FUNCTION public.op_siguiente_numero()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sig bigint;
BEGIN
  SELECT ultimo_numero + 1 INTO v_sig
  FROM numeracion_comprobantes
  WHERE tipo_comprobante = 'OP' AND punto_venta = '0001'
  FOR UPDATE;

  IF v_sig IS NULL THEN
    v_sig := 1;
    INSERT INTO numeracion_comprobantes (tipo_comprobante, punto_venta, ultimo_numero)
    VALUES ('OP', '0001', 1);
  ELSE
    UPDATE numeracion_comprobantes SET ultimo_numero = v_sig
    WHERE tipo_comprobante = 'OP' AND punto_venta = '0001';
  END IF;

  RETURN '0001-' || lpad(v_sig::text, 8, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.op_siguiente_numero() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.op_siguiente_numero() TO authenticated, service_role;

-- RPC de numeración de certificados (serie anual; crea la fila del año si falta)
CREATE OR REPLACE FUNCTION public.retencion_siguiente_numero()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_anio text := to_char(now() AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY');
  v_sig  bigint;
BEGIN
  SELECT ultimo_numero + 1 INTO v_sig
  FROM numeracion_comprobantes
  WHERE tipo_comprobante = 'RETGAN' AND punto_venta = v_anio
  FOR UPDATE;

  IF v_sig IS NULL THEN
    v_sig := 1;
    INSERT INTO numeracion_comprobantes (tipo_comprobante, punto_venta, ultimo_numero)
    VALUES ('RETGAN', v_anio, 1);
  ELSE
    UPDATE numeracion_comprobantes SET ultimo_numero = v_sig
    WHERE tipo_comprobante = 'RETGAN' AND punto_venta = v_anio;
  END IF;

  RETURN v_anio || '-' || lpad(v_sig::text, 8, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.retencion_siguiente_numero() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retencion_siguiente_numero() TO authenticated, service_role;
