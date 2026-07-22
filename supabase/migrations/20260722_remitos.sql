-- ═══════════════════════════════════════════════════════════════════
-- REMITOS: columnas de inmutabilidad, numeración REMX, RPC atómica, RLS
-- Las tablas remitos/remitos_detalle existen desde scripts/025 (sin uso).
-- ═══════════════════════════════════════════════════════════════════

-- 1. Columnas nuevas en remitos
ALTER TABLE remitos
  ADD COLUMN IF NOT EXISTS tipo_remito          VARCHAR(4)  NOT NULL DEFAULT 'REM',  -- 'REM' (R fiscal) | 'REMX' (X presupuesto)
  ADD COLUMN IF NOT EXISTS condicion_entrega    VARCHAR(30),                          -- snapshot al emitir
  ADD COLUMN IF NOT EXISTS copias               SMALLINT    NOT NULL DEFAULT 2,       -- 2 = orig+dup, 3 = +triplicado
  ADD COLUMN IF NOT EXISTS viaje_id             UUID REFERENCES viajes(id),
  ADD COLUMN IF NOT EXISTS transporte_id        UUID REFERENCES transportes(id),
  ADD COLUMN IF NOT EXISTS pdf_url              TEXT,
  ADD COLUMN IF NOT EXISTS pdf_path             TEXT,
  ADD COLUMN IF NOT EXISTS pdf_hash             CHAR(64),
  ADD COLUMN IF NOT EXISTS pdf_snapshot         JSONB,
  ADD COLUMN IF NOT EXISTS estado_pdf           VARCHAR(20) NOT NULL DEFAULT 'pendiente', -- pendiente | generado | error
  ADD COLUMN IF NOT EXISTS fecha_generacion_pdf TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS creado_por           UUID;

-- 2. Unicidad: numero_remito era UNIQUE global; con dos series (REM/REMX)
--    el mismo '0001-00000001' puede existir en ambas → unicidad por (tipo, numero).
ALTER TABLE remitos DROP CONSTRAINT IF EXISTS remitos_numero_remito_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_remitos_tipo_numero
  ON remitos(tipo_remito, numero_remito);

-- Un solo remito ACTIVO por comprobante (los anulados no bloquean re-emisión)
CREATE UNIQUE INDEX IF NOT EXISTS uq_remitos_comprobante_activo
  ON remitos(comprobante_id) WHERE estado = 'activo';

CREATE INDEX IF NOT EXISTS idx_remitos_pedido ON remitos(pedido_id);
CREATE INDEX IF NOT EXISTS idx_remitos_viaje  ON remitos(viaje_id);

-- 3. Seed numeración REMX en PV interno 0001 (REM/0001 ya existe desde scripts/025)
INSERT INTO numeracion_comprobantes (tipo_comprobante, punto_venta, ultimo_numero)
VALUES ('REMX', '0001', 0)
ON CONFLICT (tipo_comprobante, punto_venta) DO NOTHING;

-- 4. RPC de numeración atómica: sin ARCA de respaldo, el UPDATE..RETURNING
--    garantiza que dos emisiones concurrentes jamás obtengan el mismo número.
CREATE OR REPLACE FUNCTION remito_siguiente_numero(p_tipo VARCHAR, p_punto_venta VARCHAR)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE numeracion_comprobantes
     SET ultimo_numero = ultimo_numero + 1,
         updated_at    = NOW()
   WHERE tipo_comprobante = p_tipo
     AND punto_venta      = p_punto_venta
  RETURNING ultimo_numero;
$$;
REVOKE ALL ON FUNCTION remito_siguiente_numero(VARCHAR, VARCHAR) FROM anon;

-- 5. RLS (patrón del proyecto: authenticated all)
ALTER TABLE remitos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE remitos_detalle ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "remitos_authenticated" ON remitos
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "remitos_detalle_authenticated" ON remitos_detalle
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
