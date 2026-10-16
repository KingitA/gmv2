-- ═══════════════════════════════════════════════════════════════════════
-- CUENTAS CORRIENTES · Entregas a cuenta: "imputar a lo más viejo" o
-- "dejar a cuenta" (16/10/2026)
--
-- Regla del dueño: un pago que entra sin comprobante indicado queda A CUENTA y
-- aparece en la bandeja de pendientes hasta que la oficina decide:
--   · Imputar a lo más viejo (el sistema propone y se puede corregir), o
--   · Dejar a cuenta (decisión explícita: sale de la bandeja y queda registrado
--     quién lo decidió y cuándo).
-- Este archivo solo agrega dónde guardar esa decisión. No toca ningún saldo.
--
-- IDEMPOTENTE.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.pagos_clientes ADD COLUMN IF NOT EXISTS a_cuenta_decidido_por uuid;
ALTER TABLE public.pagos_clientes ADD COLUMN IF NOT EXISTS a_cuenta_decidido_at timestamptz;

COMMENT ON COLUMN public.pagos_clientes.a_cuenta_decidido_por IS
  'Usuario que decidió dejar a cuenta lo no imputado de este pago (sale de la bandeja de pendientes).';
COMMENT ON COLUMN public.pagos_clientes.a_cuenta_decidido_at IS
  'Cuándo se decidió dejar a cuenta lo no imputado de este pago.';
