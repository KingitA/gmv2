-- ─────────────────────────────────────────────────────────────────────────────
-- Proveedores: datos que hacen falta para comprar y pagar (Tanda 1-A, 17/11/2026).
-- Prueba integral de entrada: E-03 (mail de la orden de compra), E-06 (acuerdo de
-- pago como única fuente del plazo), E-10 (días de entrega) y el Excel
-- "proveedores-para-completar" que está llenando Juan (decisión 6 del 16/11).
--
-- Qué agrega (solo columnas nuevas, todas vacías; NO modifica ningún dato):
--   · mail_ordenes_compra        a qué casilla se manda la orden de compra
--   · cbu, cbu_alias, banco_titular   para transferirle (hoy había un solo campo
--                                     de texto "CBU o alias": banco_cuenta)
--   · acepta_cheques_terceros, acepta_echeq
--   · dias_entrega               cuántos días tarda en entregar (para la fecha
--                                estimada de la OC cuando todavía no hay historia)
--   · transporte_habitual        texto libre (con qué transporte manda)
--   · observaciones_compra       texto libre
--   · pago_blanco_cuotas / pago_negro_cuotas   plazo en varias cuotas ("30/60/90").
--       pago_*_dias sigue siendo el plazo (o la primera cuota). Vacío = un solo pago.
--   · medio de pago 'echeq' (se suma a transferencia / cheques / efectivo /
--     cheques_y_efectivo).
--
-- Se puede correr más de una vez. El código nuevo funciona sin esta migración
-- salvo dos cosas, que avisan en pantalla: guardar el "mail para órdenes de compra"
-- en la ficha y el importador del Excel de proveedores.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.proveedores
  ADD COLUMN IF NOT EXISTS mail_ordenes_compra     text,
  ADD COLUMN IF NOT EXISTS cbu                     varchar(22),
  ADD COLUMN IF NOT EXISTS cbu_alias               varchar(60),
  ADD COLUMN IF NOT EXISTS banco_titular           text,
  ADD COLUMN IF NOT EXISTS acepta_cheques_terceros boolean,
  ADD COLUMN IF NOT EXISTS acepta_echeq            boolean,
  ADD COLUMN IF NOT EXISTS dias_entrega            int,
  ADD COLUMN IF NOT EXISTS transporte_habitual     text,
  ADD COLUMN IF NOT EXISTS observaciones_compra    text,
  ADD COLUMN IF NOT EXISTS pago_blanco_cuotas      varchar(60),
  ADD COLUMN IF NOT EXISTS pago_negro_cuotas       varchar(60);

COMMENT ON COLUMN public.proveedores.mail_ordenes_compra IS
  'Casilla a la que se envía la orden de compra (se pueden poner varias separadas por coma). Si está vacía, la pantalla propone mail_vendedor / mail_oficina / email y deja elegir.';
COMMENT ON COLUMN public.proveedores.cbu IS 'CBU o CVU: 22 dígitos, sin espacios.';
COMMENT ON COLUMN public.proveedores.cbu_alias IS 'Alias de la cuenta.';
COMMENT ON COLUMN public.proveedores.banco_titular IS 'Titular de la cuenta bancaria (para controlar la transferencia).';
COMMENT ON COLUMN public.proveedores.acepta_cheques_terceros IS 'true / false / NULL = no se sabe.';
COMMENT ON COLUMN public.proveedores.acepta_echeq IS 'true / false / NULL = no se sabe.';
COMMENT ON COLUMN public.proveedores.dias_entrega IS
  'Días que suele tardar en entregar. Se usa para la fecha estimada de entrega de la orden de compra cuando no hay recepciones anteriores de las que sacar el promedio.';
COMMENT ON COLUMN public.proveedores.pago_blanco_cuotas IS
  'Plazo en cuotas, días separados por barra: "30/60/90". Vacío = un solo pago a pago_blanco_dias.';
COMMENT ON COLUMN public.proveedores.pago_negro_cuotas IS
  'Igual que pago_blanco_cuotas, para el canal negro.';

DO $$
BEGIN
  ALTER TABLE public.proveedores ADD CONSTRAINT proveedores_cbu_check
    CHECK (cbu IS NULL OR cbu ~ '^[0-9]{22}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.proveedores ADD CONSTRAINT proveedores_dias_entrega_check
    CHECK (dias_entrega IS NULL OR (dias_entrega >= 0 AND dias_entrega <= 365));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.proveedores ADD CONSTRAINT proveedores_pago_cuotas_check
    CHECK ((pago_blanco_cuotas IS NULL OR pago_blanco_cuotas ~ '^[0-9]{1,3}(/[0-9]{1,3})*$')
       AND (pago_negro_cuotas  IS NULL OR pago_negro_cuotas  ~ '^[0-9]{1,3}(/[0-9]{1,3})*$'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Medio de pago: se agrega 'echeq'
ALTER TABLE public.proveedores DROP CONSTRAINT IF EXISTS prov_pago_blanco_medio_check;
ALTER TABLE public.proveedores ADD CONSTRAINT prov_pago_blanco_medio_check
  CHECK (pago_blanco_medio IS NULL OR pago_blanco_medio IN ('transferencia','cheques','efectivo','cheques_y_efectivo','echeq'));
ALTER TABLE public.proveedores DROP CONSTRAINT IF EXISTS prov_pago_negro_medio_check;
ALTER TABLE public.proveedores ADD CONSTRAINT prov_pago_negro_medio_check
  CHECK (pago_negro_medio IS NULL OR pago_negro_medio IN ('transferencia','cheques','efectivo','cheques_y_efectivo','echeq'));

NOTIFY pgrst, 'reload schema';
