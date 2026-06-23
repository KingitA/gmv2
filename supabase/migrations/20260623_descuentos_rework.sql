-- =====================================================================
-- Rework de los 5 descuentos (cascada escalonada) + comisión unificada
-- =====================================================================
-- Cambios de comportamiento (ver plan recursive-dreaming-narwhal):
--   • General y Viajante pasan a aplicarse en el NETO por línea al crear el
--     pedido (no más líneas negativas al pie del comprobante).
--   • Mercadería: el producto bonificado se emite como línea a $0 (P.Lista
--     real, 100% Of.), no como full-price + línea negativa.
--   • Comisión: una sola fórmula (base = neto final × (1−merc%) × (1−fin%),
--     tasa = comisión% − viajante%, restada una sola vez), efectiva al cobrar.
--   • Se elimina clientes.descuento_especial.
--
-- Aplicar copiando/pegando en el SQL Editor de Supabase.
-- =====================================================================

-- ── 1. kardex: columna propia para la OFERTA (descuento_propio) ──────────────
-- Hoy la oferta se guardaba (mal) en descuento_mercaderia_*. A partir de ahora:
--   descuento_oferta_*     → oferta (descuento_propio del artículo)
--   descuento_general_*    → bonificación GENERAL (antes ocupado por descuento_especial)
--   descuento_mercaderia_* → bonificación MERCADERÍA (producto regalado)
ALTER TABLE kardex
  ADD COLUMN IF NOT EXISTS descuento_oferta_pct   NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS descuento_oferta_monto NUMERIC(14,4);

COMMENT ON COLUMN kardex.descuento_oferta_pct   IS 'Oferta (descuento_propio del artículo). %';
COMMENT ON COLUMN kardex.descuento_oferta_monto IS 'Oferta — monto unitario.';
COMMENT ON COLUMN kardex.descuento_mercaderia_pct IS 'Bonificación MERCADERÍA (producto regalado al 100%). %';
COMMENT ON COLUMN kardex.descuento_general_pct    IS 'Bonificación GENERAL del cliente (por segmento). %';

-- ── 2. pedidos_detalle: desglose por línea (display + auditoría) ─────────────
-- precio_base/precio_final ya traen general+viajante aplicados (neto final).
-- Estas columnas guardan el desglose para mostrarlo en el comprobante y reconstruirlo.
ALTER TABLE pedidos_detalle
  ADD COLUMN IF NOT EXISTS precio_lista          NUMERIC(14,4),  -- P.Lista bruto (post-oferta) — informativo
  ADD COLUMN IF NOT EXISTS descuento_propio_pct  NUMERIC(8,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonif_general_pct     NUMERIC(8,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonif_viajante_pct    NUMERIC(8,4) DEFAULT 0;

-- ── 3. comprobantes_venta_detalle: desglose por línea (PDF + auditoría AFIP) ─
ALTER TABLE comprobantes_venta_detalle
  ADD COLUMN IF NOT EXISTS precio_lista          NUMERIC(14,4),  -- P.Lista bruto pre-cascada (display)
  ADD COLUMN IF NOT EXISTS descuento_propio_pct  NUMERIC(8,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonif_general_pct     NUMERIC(8,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonif_viajante_pct    NUMERIC(8,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS es_bonificado         BOOLEAN DEFAULT FALSE;

-- ── 4. comisiones: soportar el débito por descuento financiero post-cobro ────
-- monto ya es numérico (admite negativos). Agregamos motivo para trazar ajustes.
ALTER TABLE comisiones
  ADD COLUMN IF NOT EXISTS motivo TEXT;
COMMENT ON COLUMN comisiones.motivo IS 'Detalle del ajuste, ej: "Débito por NC financiera 10% post-cobro".';

-- tipo: hoy 'vendida' | 'cobrada'. Agregamos 'ajuste_financiero' para el débito.
-- (Si tipo es un enum, descomentar la línea de abajo; si es text/varchar no hace falta.)
-- ALTER TYPE comision_tipo ADD VALUE IF NOT EXISTS 'ajuste_financiero';

-- ── 5. Backfill kardex histórico ─────────────────────────────────────────────
-- Antes del rework, descuento_mercaderia_* guardaba DOS cosas distintas:
--   • Líneas normales con oferta  → era la OFERTA            → mover a descuento_oferta_*
--   • Ítems bonificados (net 0, pct 100) → era MERCADERÍA real → dejar como está
UPDATE kardex
SET descuento_oferta_pct   = descuento_mercaderia_pct,
    descuento_oferta_monto = descuento_mercaderia_monto,
    descuento_mercaderia_pct   = NULL,
    descuento_mercaderia_monto = NULL
WHERE descuento_mercaderia_pct IS NOT NULL
  AND NOT (descuento_mercaderia_pct = 100 AND COALESCE(precio_unitario_final, 0) = 0);

-- ── 6. Eliminar descuento_especial del cliente ───────────────────────────────
-- Se reemplaza por la bonificación GENERAL (tabla bonificaciones). Ya no se usa.
ALTER TABLE clientes DROP COLUMN IF EXISTS descuento_especial;
