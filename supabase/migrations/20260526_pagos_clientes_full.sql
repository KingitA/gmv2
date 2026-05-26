-- ============================================================
-- MIGRACIÓN: Sistema completo de pagos de clientes
-- Fecha: 2026-05-26
-- ============================================================

-- ─── 1. Extender pagos_detalle ───────────────────────────────
ALTER TABLE pagos_detalle
  ADD COLUMN IF NOT EXISTS caja_id UUID,
  ADD COLUMN IF NOT EXISTS cuenta_bancaria_id UUID,
  ADD COLUMN IF NOT EXISTS fecha_transferencia DATE,
  ADD COLUMN IF NOT EXISTS numero_comprobante_pago VARCHAR(100),
  ADD COLUMN IF NOT EXISTS localidad VARCHAR(100),
  ADD COLUMN IF NOT EXISTS cuit_emisor VARCHAR(20),
  ADD COLUMN IF NOT EXISTS color_cheque VARCHAR(10),
  ADD COLUMN IF NOT EXISTS cheque_id UUID,
  ADD COLUMN IF NOT EXISTS fecha_deposito DATE;

-- ─── 2. Extender cuentas_bancarias con CVU y cuenta ──────────
ALTER TABLE cuentas_bancarias
  ADD COLUMN IF NOT EXISTS cvu TEXT,
  ADD COLUMN IF NOT EXISTS cuenta TEXT;

-- ─── 3. Tabla pago_deposito_items ────────────────────────────
-- Ítems dentro de un depósito (puede tener efectivo + N cheques)
CREATE TABLE IF NOT EXISTS pago_deposito_items (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pago_detalle_id              UUID NOT NULL,
  tipo_item                    VARCHAR(20) NOT NULL CHECK (tipo_item IN ('efectivo', 'cheque')),
  monto                        NUMERIC(12,2) NOT NULL,
  -- campos cheque
  numero_cheque                VARCHAR(50),
  banco_emisor                 VARCHAR(100),
  fecha_pago_cheque            DATE,
  numero_comprobante_deposito  VARCHAR(100),
  cheque_id                    UUID,
  -- campos efectivo
  fecha_deposito_efectivo      DATE,
  nro_comprobante_deposito_ef  VARCHAR(100),
  created_at                   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 4. Tabla retenciones ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS retenciones (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pago_id                UUID NOT NULL,
  tipo                   VARCHAR(20) NOT NULL CHECK (tipo IN ('IIBB', 'IVA', 'GANANCIAS', 'SUSS')),
  fecha                  DATE NOT NULL,
  numero_comprobante     VARCHAR(100),
  monto                  NUMERIC(12,2) NOT NULL,
  comprobantes_afectados UUID[],
  origen                 VARCHAR(20) DEFAULT 'manual' CHECK (origen IN ('manual', 'ocr')),
  archivo_url            TEXT,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 5. Tabla recibos ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recibos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_recibo VARCHAR(50) UNIQUE NOT NULL,
  pago_id       UUID NOT NULL UNIQUE,
  cliente_id    UUID NOT NULL,
  fecha         DATE NOT NULL,
  monto_total   NUMERIC(12,2) NOT NULL,
  pdf_url       TEXT,
  generado_at   TIMESTAMPTZ DEFAULT NOW(),
  generado_por  UUID
);

-- ─── 6. Tabla kardex_contable ─────────────────────────────────
CREATE TABLE IF NOT EXISTS kardex_contable (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tipo_movimiento   VARCHAR(30) NOT NULL,
  -- COBRO_CLIENTE | PAGO_PROVEEDOR | EGRESO_GENERAL | TRANSFERENCIA_INTERNA | DEBITO_CHEQUE_RECHAZADO | AJUSTE
  concepto          TEXT NOT NULL,
  monto             NUMERIC(12,2) NOT NULL,
  color             VARCHAR(10) CHECK (color IN ('BLANCO', 'NEGRO')),
  -- origen y destino
  origen_tipo       VARCHAR(20),   -- CLIENTE | CAJA | BANCO
  origen_id         UUID,
  destino_tipo      VARCHAR(20),   -- CAJA | BANCO | EN_CARTERA | PROVEEDOR
  destino_id        UUID,
  -- método de ingreso
  metodo            VARCHAR(30),
  -- EFECTIVO | TRANSFERENCIA | CHEQUE_TERCERO | DEPOSITO | RETENCION
  -- referencias
  referencia_tipo   VARCHAR(50),
  referencia_id     UUID,
  pago_id           UUID,
  recibo_id         UUID,
  cheque_id         UUID,
  -- actores
  cliente_id        UUID,
  vendedor_id       UUID,
  cobrador_id       UUID,
  -- snapshots de saldo al momento del movimiento
  saldo_caja_after  NUMERIC(12,2),
  saldo_banco_after NUMERIC(12,2),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 7. Seed: cajas_financieras ──────────────────────────────
INSERT INTO cajas_financieras (id, nombre, activo)
SELECT gen_random_uuid(), 'Caja Grande', true
WHERE NOT EXISTS (SELECT 1 FROM cajas_financieras WHERE nombre = 'Caja Grande');

INSERT INTO cajas_financieras (id, nombre, activo)
SELECT gen_random_uuid(), 'Caja Chica', true
WHERE NOT EXISTS (SELECT 1 FROM cajas_financieras WHERE nombre = 'Caja Chica');

-- ─── 8. Seed: cuentas_bancarias ──────────────────────────────
-- El admin completa CBU/CVU desde /tablas/bancos
INSERT INTO cuentas_bancarias (id, banco, nombre, activo)
SELECT gen_random_uuid(), 'Banco Credicoop', 'Credicoop', true
WHERE NOT EXISTS (SELECT 1 FROM cuentas_bancarias WHERE nombre = 'Credicoop');

INSERT INTO cuentas_bancarias (id, banco, nombre, activo)
SELECT gen_random_uuid(), 'Banco Nación', 'Nación', true
WHERE NOT EXISTS (SELECT 1 FROM cuentas_bancarias WHERE nombre = 'Nación');

INSERT INTO cuentas_bancarias (id, banco, nombre, activo)
SELECT gen_random_uuid(), 'Banco Provincia', 'Provincia', true
WHERE NOT EXISTS (SELECT 1 FROM cuentas_bancarias WHERE nombre = 'Provincia');

INSERT INTO cuentas_bancarias (id, banco, nombre, activo)
SELECT gen_random_uuid(), 'MercadoPago', 'MercadoPago', true
WHERE NOT EXISTS (SELECT 1 FROM cuentas_bancarias WHERE nombre = 'MercadoPago');

-- ─── 9. Seed: numeracion_comprobantes para recibos ───────────
INSERT INTO numeracion_comprobantes (tipo_comprobante, punto_venta, ultimo_numero)
SELECT 'RECIBO', '0001', 0
WHERE NOT EXISTS (SELECT 1 FROM numeracion_comprobantes WHERE tipo_comprobante = 'RECIBO');
