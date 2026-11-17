-- ═════════════════════════════════════════════════════════════════════════════
-- Órdenes de pago en UN paso + datos de pago del proveedor a la vista
-- Prueba integral de ENTRADA, Tanda 1-D (17/11/2026): E-67.
--
-- Antes: había que crear la orden (quedaba pendiente) y después ir al listado a
-- confirmarla. Ahora la pantalla ofrece "Pagar ahora" (crea y confirma juntos) o
-- "Dejar pendiente" (como antes).
--
-- Piezas:
--   1. proveedores: CBU, alias, titular de la cuenta y si acepta cheques de
--      terceros / e-cheq. Columnas nuevas, vacías (NULL = todavía no se cargó).
--      No pisa nada: banco_nombre, banco_cuenta, banco_numero_cuenta y
--      banco_tipo_cuenta siguen como están.
--   2. op_crear_y_confirmar(): llama a op_crear y a op_confirmar en la MISMA
--      transacción. Si la confirmación falla (saldo, cheque que ya no está en
--      cartera, retención que cambió) no queda nada creado: ni la orden.
--
-- REQUIERE 20261116p y 20261116q (ya aplicadas). No cambia op_crear ni
-- op_confirmar. Seguro de re-ejecutar. No toca datos.
-- Sin esta migración la pantalla sigue pagando en un paso, pero con dos llamadas
-- (si la segunda falla, la orden queda pendiente y avisa).
-- ═════════════════════════════════════════════════════════════════════════════

-- ═══ Control previo ═══
DO $$
BEGIN
  IF to_regprocedure('public.op_crear(jsonb, text)') IS NULL
     OR to_regprocedure('public.op_confirmar(uuid, uuid, uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Faltan op_crear / op_confirmar (migraciones 20261116p y 20261116q). No se cambió nada.';
  END IF;
END $$;

-- ═══ 1. Datos de pago del proveedor ═══
ALTER TABLE public.proveedores
  ADD COLUMN IF NOT EXISTS banco_cbu varchar(30),
  ADD COLUMN IF NOT EXISTS banco_alias varchar(60),
  ADD COLUMN IF NOT EXISTS banco_titular varchar(150),
  ADD COLUMN IF NOT EXISTS acepta_cheques_terceros boolean,
  ADD COLUMN IF NOT EXISTS acepta_echeq boolean;

COMMENT ON COLUMN public.proveedores.banco_cbu IS 'CBU / CVU de la cuenta donde se le transfiere (22 dígitos).';
COMMENT ON COLUMN public.proveedores.banco_alias IS 'Alias de la cuenta donde se le transfiere.';
COMMENT ON COLUMN public.proveedores.banco_titular IS 'Titular de la cuenta (si no es la razón social del proveedor).';
COMMENT ON COLUMN public.proveedores.acepta_cheques_terceros IS 'true = se le puede pagar con cheques de terceros; false = no los acepta; NULL = no se sabe.';
COMMENT ON COLUMN public.proveedores.acepta_echeq IS 'true = acepta e-cheq; false = no; NULL = no se sabe.';

-- ═══ 2. Crear y confirmar en una sola transacción ═══
-- p_payload: el mismo de op_crear. p_usuario: mail de quien arma (queda en usuario_creador).
-- p_usuario_id: quién confirma (kardex, certificado).
-- El origen de la plata sale de cada medio (cuenta_origen_tipo / cuenta_origen_id);
-- como respaldo se pasa a op_confirmar la primera caja y el primer banco del pago,
-- igual que hace la ruta de confirmar.
-- Devuelve la fila de la orden (ya pagada) + { ya_existia, confirmacion: {...} }.
CREATE OR REPLACE FUNCTION public.op_crear_y_confirmar(
  p_payload    jsonb,
  p_usuario    text DEFAULT NULL,
  p_usuario_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_op     jsonb;
  v_op_id  uuid;
  v_caja   uuid;
  v_banco  uuid;
  v_conf   jsonb;
  v_fila   ordenes_pago%ROWTYPE;
BEGIN
  v_op := op_crear(p_payload, p_usuario);
  v_op_id := (v_op->>'id')::uuid;

  SELECT cuenta_origen_id INTO v_caja FROM ordenes_pago_detalle
   WHERE orden_pago_id = v_op_id AND cuenta_origen_tipo = 'CAJA' AND cuenta_origen_id IS NOT NULL
   ORDER BY created_at, id LIMIT 1;
  SELECT cuenta_origen_id INTO v_banco FROM ordenes_pago_detalle
   WHERE orden_pago_id = v_op_id AND cuenta_origen_tipo = 'BANCO' AND cuenta_origen_id IS NOT NULL
   ORDER BY created_at, id LIMIT 1;

  -- Si falla, la excepción deshace también lo que hizo op_crear (misma transacción)
  v_conf := op_confirmar(v_op_id, p_usuario_id, v_caja, v_banco);

  SELECT * INTO v_fila FROM ordenes_pago WHERE id = v_op_id;
  RETURN to_jsonb(v_fila)
      || jsonb_build_object('ya_existia', COALESCE((v_op->>'ya_existia')::boolean, false), 'confirmacion', v_conf);
END;
$function$;

REVOKE ALL ON FUNCTION public.op_crear_y_confirmar(jsonb, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.op_crear_y_confirmar(jsonb, text, uuid) TO service_role;

COMMENT ON FUNCTION public.op_crear_y_confirmar(jsonb, text, uuid) IS
  'Crea la orden de pago y la confirma en la misma transacción (E-67). Solo la llama el servidor.';
