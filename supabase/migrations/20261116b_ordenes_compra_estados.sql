-- ─────────────────────────────────────────────────────────────────────────────
-- Órdenes de compra: ampliar los estados que acepta la base.
-- Prueba integral de entrada, E-09 (16/11/2026) — solo la regla (CHECK).
--
-- La regla original (scripts/001-create-tables.sql) solo acepta
--   'pendiente', 'recibida_parcial', 'recibida_completa', 'cancelada'.
-- El código ya escribe 'finalizada' (botón "Finalizar OC" de la verificación) y la
-- base lo RECHAZA (error 23514): la orden nunca queda finalizada aunque la pantalla
-- vuelva al listado como si nada. 'enviada', 'confirmada' y 'en_camino' los va a
-- usar la Tanda 1 (envío de la OC al proveedor).
--
-- Es un SUPERCONJUNTO de los valores anteriores: ninguna fila existente puede
-- violar la regla nueva. No toca datos. Se puede correr más de una vez.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_con record;
BEGIN
  -- La regla vieja puede tener el nombre automático (ordenes_compra_estado_check) u otro:
  -- se quita cualquier CHECK de ordenes_compra que hable de la columna estado.
  FOR v_con IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = 'public.ordenes_compra'::regclass
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) ILIKE '%estado%'
       AND pg_get_constraintdef(c.oid) ILIKE '%recibida_parcial%'
  LOOP
    EXECUTE format('ALTER TABLE public.ordenes_compra DROP CONSTRAINT %I', v_con.conname);
  END LOOP;
END $$;

ALTER TABLE public.ordenes_compra
  ADD CONSTRAINT ordenes_compra_estado_check
  CHECK (estado IN (
    'pendiente',          -- creada, todavía no se le mandó al proveedor
    'enviada',            -- se le mandó al proveedor
    'confirmada',         -- el proveedor la confirmó
    'en_camino',          -- despachada
    'recibida_parcial',   -- el depósito empezó a recibirla
    'recibida_completa',  -- el depósito terminó de recibirla
    'finalizada',         -- la oficina verificó y validó los comprobantes
    'cancelada'
  ));

NOTIFY pgrst, 'reload schema';
