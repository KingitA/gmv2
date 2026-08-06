-- ordenes_pago: admitir el estado 'anulada' — lo escribe op_anular (y por lo
-- tanto op_eliminar al revertir una OP pagada antes de borrarla). El check
-- original solo permitía borrador/pendiente/pagada/parcial/cancelada.

ALTER TABLE ordenes_pago DROP CONSTRAINT ordenes_pago_estado_check;
ALTER TABLE ordenes_pago ADD CONSTRAINT ordenes_pago_estado_check
  CHECK (estado::text = ANY (ARRAY['borrador','pendiente','pagada','parcial','cancelada','anulada']::text[]));
