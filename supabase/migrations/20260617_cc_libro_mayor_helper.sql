-- ─────────────────────────────────────────────────────────────────────────────
-- Cuenta Corriente de Clientes — Libro mayor como ÚNICA fuente de verdad del saldo
--
-- Contexto: hasta ahora el saldo del cliente se calculaba "al vuelo" sumando
-- comprobantes_venta.saldo_pendiente, de formas distintas en distintos endpoints,
-- mientras la tabla cuenta_corriente_clientes (libro mayor doble entrada) +
-- la vista v_saldo_clientes (saldo = Σdebe - Σhaber) existían pero estaban sin usar.
--
-- A partir de acá: TODO hecho económico del cliente postea exactamente UN
-- movimiento (debe o haber) en cuenta_corriente_clientes vía la función cc_postear.
-- El saldo del cliente se lee SIEMPRE de v_saldo_clientes. comprobantes_venta.
-- saldo_pendiente queda solo como dato de imputación por comprobante.
--
-- No crea tablas nuevas: cuenta_corriente_clientes y v_saldo_clientes ya existen.
-- ─────────────────────────────────────────────────────────────────────────────

-- Helper centralizado de posteo al libro mayor.
-- tipo_movimiento (evento de negocio): 'factura' | 'nota_credito' | 'nota_debito'
--   | 'pago' | 'devolucion' | 'ajuste'.
-- Dirección real del movimiento: columnas debe/haber (una de las dos > 0).
-- saldo por fila se deja en 0: el saldo corriente lo recalcula v_saldo_clientes.
CREATE OR REPLACE FUNCTION cc_postear(
  p_cliente_id        uuid,
  p_tipo_movimiento   text,
  p_debe              numeric,
  p_haber             numeric,
  p_referencia_tipo   text,
  p_referencia_id     uuid,
  p_numero_comprobante text DEFAULT NULL,
  p_observaciones     text DEFAULT NULL,
  p_usuario_id        uuid DEFAULT NULL,
  p_fecha             timestamptz DEFAULT now()
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_cliente_id IS NULL THEN
    RAISE EXCEPTION 'cc_postear: p_cliente_id es obligatorio';
  END IF;

  INSERT INTO cuenta_corriente_clientes (
    cliente_id, fecha, tipo_movimiento, debe, haber, saldo,
    referencia_tipo, referencia_id, numero_comprobante, observaciones, usuario_id
  ) VALUES (
    p_cliente_id,
    COALESCE(p_fecha, now()),
    p_tipo_movimiento,
    COALESCE(p_debe, 0),
    COALESCE(p_haber, 0),
    0,
    p_referencia_tipo,
    p_referencia_id,
    p_numero_comprobante,
    p_observaciones,
    p_usuario_id
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Idempotencia para reversas/anulaciones: NO se fuerza unicidad en DB porque un
-- mismo comprobante puede tener su posteo + su contrapartida de anulación.
-- La consistencia se valida con el script de reconciliación (v_saldo_clientes vs
-- saldo esperado) que corre en cada deploy de esta etapa.
