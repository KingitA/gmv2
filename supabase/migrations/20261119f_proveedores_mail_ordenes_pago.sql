-- =====================================================================
-- Mail propio del proveedor para las órdenes de pago.
-- Decisión de Juan (19/11/2026), a "¿mail propio para órdenes de pago?": «Sí, campo propio».
--
-- Cuando una orden queda pagada se le manda al proveedor a ESTE mail (admite varios, separados
-- por coma). Si está vacío, va al de la oficina, al general o al del vendedor, en ese orden, y
-- la pantalla dice a cuál fue. Idempotente.
-- =====================================================================

ALTER TABLE public.proveedores ADD COLUMN IF NOT EXISTS mail_ordenes_pago text;
COMMENT ON COLUMN public.proveedores.mail_ordenes_pago IS
  'A qué mail se le manda la orden de pago cuando queda pagada. Varios separados por coma. Vacío = oficina, general o vendedor (en ese orden).';

-- De cuál de los mails de la ficha salió cada envío (ordenes_pago / oficina / general / vendedor).
-- La tabla es de 20261119e_bancos_confirmar_y_enviar.sql: si todavía no está, no se hace nada.
DO $$
BEGIN
  IF to_regclass('public.ordenes_pago_envios') IS NOT NULL THEN
    ALTER TABLE public.ordenes_pago_envios ADD COLUMN IF NOT EXISTS mail_origen text;
    COMMENT ON COLUMN public.ordenes_pago_envios.mail_origen IS
      'De cuál mail de la ficha del proveedor salió el destinatario: ordenes_pago (el propio), oficina, general o vendedor.';
  ELSE
    RAISE NOTICE 'ordenes_pago_envios todavía no existe (falta 20261119e): la columna mail_origen se agrega al volver a correr esta migración.';
  END IF;
END $$;
