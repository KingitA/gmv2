-- ═════════════════════════════════════════════════════════════════════════
-- CHEQUES EMITIDOS (PROPIOS) — 2026-07-14
--
-- Los cheques que emitimos a proveedores se registran en la tabla `cheques`
-- existente con tipo = PROPIO y estado = ENTREGADO_A_PROVEEDOR (ambos ya
-- estaban en los enums desde 20251220, sin UI hasta ahora).
--
-- Un cheque emitido con fecha de pago 14/7 puede debitarse de la cuenta
-- entre el 14/7 y el 14/8 (30 días). Mientras esté ENTREGADO_A_PROVEEDOR y
-- sin fecha_debito, esa plata se muestra como comprometida en /finanzas.
-- Al conciliarse el débito, pasa a COBRADO con fecha_debito.
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE public.cheques
  ADD COLUMN IF NOT EXISTS fecha_debito date;

COMMENT ON COLUMN public.cheques.fecha_debito IS
  'Cheques PROPIOS: fecha en que el banco debitó efectivamente el cheque (conciliación).';
