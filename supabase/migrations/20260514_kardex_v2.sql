-- ============================================================
-- Kardex V2: fuente de verdad única
-- Agrega columnas para: descuentos proveedor, comisión embebida,
-- percepciones con %, actores responsables del proceso.
-- Agrega kardex_id en comisiones para vincular ambas tablas.
-- ============================================================

ALTER TABLE kardex
  -- Grupo A: Descuentos de proveedor (tipo_movimiento = 'compra')
  ADD COLUMN IF NOT EXISTS descuento_proveedor_pct              NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS descuento_proveedor_monto            NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS descuento_proveedor_financiero_pct   NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS descuento_proveedor_financiero_monto NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS descuento_proveedor_comercial_pct    NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS descuento_proveedor_comercial_monto  NUMERIC(14,4),

  -- Grupo B: Comisión del viajante embebida (tipo_movimiento = 'venta')
  ADD COLUMN IF NOT EXISTS comision_viajante_pct                NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS comision_viajante_monto              NUMERIC(14,4),

  -- Grupo C: Percepciones con porcentaje (ya existen los _monto)
  ADD COLUMN IF NOT EXISTS percepcion_iva_pct                   NUMERIC(8,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS percepcion_iibb_pct                  NUMERIC(8,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS percepcion_ganancias_pct             NUMERIC(8,4) DEFAULT 0,

  -- Grupo D: Actores responsables del proceso (todos UUID → auth.users)
  ADD COLUMN IF NOT EXISTS comprador_id             UUID,  -- creó la OC
  ADD COLUMN IF NOT EXISTS receptor_id              UUID,  -- recibió en depósito
  ADD COLUMN IF NOT EXISTS controlador_id           UUID,  -- controló la recepción
  ADD COLUMN IF NOT EXISTS pagador_id               UUID,  -- pagó la OC
  ADD COLUMN IF NOT EXISTS preparadores_ids         UUID[], -- array: puede haber múltiples preparadores
  ADD COLUMN IF NOT EXISTS facturador_id            UUID,  -- generó el comprobante de venta
  ADD COLUMN IF NOT EXISTS entregador_id            UUID,  -- entregó al cliente
  ADD COLUMN IF NOT EXISTS cobrador_id              UUID,  -- cobró del cliente
  ADD COLUMN IF NOT EXISTS modificador_deposito_id  UUID;  -- hizo ajuste de stock en depósito

-- Vincular comisiones → kardex (kardex es la fuente de datos, comisiones solo trackea pagado/pendiente)
ALTER TABLE comisiones
  ADD COLUMN IF NOT EXISTS kardex_id UUID REFERENCES kardex(id) ON DELETE SET NULL;

-- Índice para reportes de stock histórico y valorización FIFO
CREATE INDEX IF NOT EXISTS idx_kardex_articulo_fecha_desc
  ON kardex(articulo_id, fecha DESC, created_at DESC);

-- Índice para reportes de comisiones desde kardex
CREATE INDEX IF NOT EXISTS idx_kardex_comision_viajante
  ON kardex(vendedor_id, fecha)
  WHERE comision_viajante_monto IS NOT NULL AND comision_viajante_monto > 0;

-- Índice para buscar comisiones por kardex_id
CREATE INDEX IF NOT EXISTS idx_comisiones_kardex
  ON comisiones(kardex_id)
  WHERE kardex_id IS NOT NULL;
