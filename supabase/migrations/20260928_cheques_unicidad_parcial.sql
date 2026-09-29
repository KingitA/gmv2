-- ═══════════════════════════════════════════════════════════════════════════
-- CHEQUES: la unicidad deja de contar los ANULADOS ("cheque preso") — 28/09/2026
-- ═══════════════════════════════════════════════════════════════════════════
-- Problema (visto por el dueño en la preview de apk-chofer): un cheque cargado en un
-- cobro no se puede eliminar (correcto: nada de borrar cheques sin rastro) y, si el
-- cobro se anula, `cobranza_anular` deja el cheque con estado ANULADO pero la clave
-- UNIQUE (banco, numero, monto, fecha_vencimiento) lo seguía contando: el mismo cheque
-- no se podía volver a cargar nunca. Quedaba "preso".
--
-- Regla nueva:
--   · Un cheque se saca de un cobro SOLO anulando el cobro por el circuito de oficina
--     (`cobranza_anular`): reversa completa de imputaciones, billetera y cartera
--     (estado ANULADO), la foto queda en pago_comprobantes y el veredicto BCRA no se toca.
--   · La unicidad rige sobre los cheques VIVOS: índice UNIQUE parcial que excluye
--     estado = 'ANULADO'. Anular libera el número; re-cargarlo crea una fila nueva y la
--     anulada queda como historia.
--   · Se mantienen las 4 columnas de la clave (banco, numero, monto, fecha_vencimiento) y
--     NO solo (banco, numero): el número de cheque es único por CUENTA, no por banco (dos
--     clientes con cuenta en el mismo banco pueden traer cheques con el mismo número), y la
--     tabla no guarda el CUIT/cuenta del emisor. Monto + vencimiento distinguen esos casos
--     sin cambiar el criterio que ya regía; el caso que importa (mismo cheque dos veces)
--     choca igual porque comparte las 4.
--   · De paso: idx_cheques_proveedor duplicaba a idx_cheques_destino (misma columna).
--
-- ADITIVA e IDEMPOTENTE (IF EXISTS / IF NOT EXISTS). Reversa documentada al final.

-- 1. Sacar la clave vieja (creada fuera de migraciones; puede ser constraint o índice)
ALTER TABLE public.cheques DROP CONSTRAINT IF EXISTS cheques_banco_numero_monto_fecha_vencimiento_key;
DROP INDEX IF EXISTS public.cheques_banco_numero_monto_fecha_vencimiento_key;

-- 2. Unicidad solo entre cheques vivos
CREATE UNIQUE INDEX IF NOT EXISTS ux_cheques_vivos
  ON public.cheques (banco, numero, monto, fecha_vencimiento)
  WHERE estado <> 'ANULADO';

-- 3. Índice duplicado sobre proveedor_destino_id (queda idx_cheques_destino, el de las migraciones)
DROP INDEX IF EXISTS public.idx_cheques_proveedor;

-- ── Reversa (solo si hiciera falta volver atrás) ─────────────────────────────
-- DROP INDEX IF EXISTS public.ux_cheques_vivos;
-- ALTER TABLE public.cheques
--   ADD CONSTRAINT cheques_banco_numero_monto_fecha_vencimiento_key UNIQUE (banco, numero, monto, fecha_vencimiento);
-- CREATE INDEX IF NOT EXISTS idx_cheques_proveedor ON public.cheques (proveedor_destino_id);
