-- ─────────────────────────────────────────────────────────────────────────────
-- FASE B0 — Preparación de enum (APLICAR SOLA, ANTES QUE B1)
--
-- ALTER TYPE ... ADD VALUE no puede ejecutarse en la misma transacción en la
-- que el valor nuevo se usa: por eso esta migración va separada.
--
-- BILLETERA: tercera clase de cuenta de fondos (además de CAJA y BANCO).
-- Una billetera es el dinero en la calle de un cobrador: cuenta_id en
-- saldos_financieros = id del chofer/viajante (vendedores.id, la misma
-- identidad que usa billetera_movimientos.viajante_id).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TYPE fund_account_type ADD VALUE IF NOT EXISTS 'BILLETERA';
