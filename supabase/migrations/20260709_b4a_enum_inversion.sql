-- ─────────────────────────────────────────────────────────────────────────────
-- FASE B4a — Preparación de enum (APLICAR SOLA, ANTES QUE B4b)
--
-- INVERSION: cuarta clase de cuenta de fondos — la "caja Bolsa" del dueño:
-- obligaciones negociables, acciones, cedears y FCI. Cada instrumento es una
-- cuenta propia (tabla cuentas_inversion, creada en B4b) con su saldo en
-- saldos_financieros como cualquier caja/banco.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TYPE fund_account_type ADD VALUE IF NOT EXISTS 'INVERSION';
