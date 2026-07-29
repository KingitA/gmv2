-- ============================================================================
-- COMISIONES ↔ KARDEX: sincronización y backfill
-- 2026-07-30
--
-- Contexto: la tabla `comisiones` dejó de poblarse el 2026-05-18 (era pre-kardex,
-- 9.852 filas de mar-may SIN kardex_id y NINGUNA pagada). Desde entonces las
-- comisiones viven solo en kardex.comision_viajante_monto, y el circuito de
-- pago (viajantes/[id]/retiro marca comisiones.pagado=true) quedó operando
-- sobre datos muertos. El flag "pagado" daba siempre $0 en Playroom y /vendedor.
--
-- Este script:
--   1. Crea el vínculo 1:1 comisiones.kardex_id → kardex.id (índice único)
--   2. Backfillea comisiones desde kardex (15.964 ventas con comisión sin fila)
--   3. Triggers en kardex para mantener el sync hacia adelante:
--      - INSERT de venta con comisión → crea fila en comisiones
--      - UPDATE de cobrado/monto → sincroniza la fila (si no está pagada)
--      - pedido_eliminado=true → borra la fila no pagada
--
-- Los triggers solo INSERTAN/ACTUALIZAN en comisiones; no modifican kardex ni
-- afectan la lógica de pedidos/facturación. Idempotente.
-- ============================================================================

-- 1. Vínculo único (necesario para ON CONFLICT)
CREATE UNIQUE INDEX IF NOT EXISTS uq_comisiones_kardex
  ON public.comisiones (kardex_id) WHERE kardex_id IS NOT NULL;

-- 2. Backfill desde kardex
INSERT INTO public.comisiones (
  viajante_id, pedido_id, monto, porcentaje,
  comprobante_venta_id, comprobante_cobrado, fecha_comprobante_cobrado,
  tipo, articulo_id, segmento, cantidad, precio_neto_unitario,
  kardex_id, created_at, motivo
)
SELECT
  k.vendedor_id,
  k.pedido_id,
  k.comision_viajante_monto,
  COALESCE(k.comision_viajante_pct, 0),
  k.comprobante_venta_id,
  COALESCE(k.comprobante_cobrado, false),
  k.fecha_comprobante_cobrado,
  'vendida',
  k.articulo_id,
  k.articulo_categoria,
  k.cantidad,
  CASE WHEN COALESCE(k.cantidad, 0) <> 0 THEN COALESCE(k.subtotal_neto, 0) / k.cantidad END,
  k.id,
  k.fecha,
  'backfill kardex 2026-07-30'
FROM public.kardex k
WHERE k.tipo_movimiento = 'venta'
  AND k.comision_viajante_monto IS NOT NULL
  AND k.comision_viajante_monto <> 0
  AND k.pedido_eliminado = false
  AND NOT EXISTS (SELECT 1 FROM public.comisiones co WHERE co.kardex_id = k.id);

-- 3a. Trigger: nueva venta con comisión → fila en comisiones
CREATE OR REPLACE FUNCTION public.sync_comision_desde_kardex()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.comisiones (
    viajante_id, pedido_id, monto, porcentaje,
    comprobante_venta_id, comprobante_cobrado, fecha_comprobante_cobrado,
    tipo, articulo_id, segmento, cantidad, precio_neto_unitario,
    kardex_id, created_at
  ) VALUES (
    NEW.vendedor_id,
    NEW.pedido_id,
    NEW.comision_viajante_monto,
    COALESCE(NEW.comision_viajante_pct, 0),
    NEW.comprobante_venta_id,
    COALESCE(NEW.comprobante_cobrado, false),
    NEW.fecha_comprobante_cobrado,
    'vendida',
    NEW.articulo_id,
    NEW.articulo_categoria,
    NEW.cantidad,
    CASE WHEN COALESCE(NEW.cantidad, 0) <> 0 THEN COALESCE(NEW.subtotal_neto, 0) / NEW.cantidad END,
    NEW.id,
    COALESCE(NEW.fecha, now())
  )
  ON CONFLICT (kardex_id) WHERE kardex_id IS NOT NULL DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_comision_insert ON public.kardex;
CREATE TRIGGER trg_sync_comision_insert
  AFTER INSERT ON public.kardex
  FOR EACH ROW
  WHEN (NEW.tipo_movimiento = 'venta'
        AND NEW.comision_viajante_monto IS NOT NULL
        AND NEW.comision_viajante_monto <> 0
        AND NEW.pedido_eliminado = false)
  EXECUTE FUNCTION public.sync_comision_desde_kardex();

-- 3b. Trigger: cambios en el kardex → sincronizar la fila de comisiones
CREATE OR REPLACE FUNCTION public.sync_comision_update_kardex()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Pedido eliminado: borrar la comisión si aún no se pagó
  IF NEW.pedido_eliminado = true AND COALESCE(OLD.pedido_eliminado, false) = false THEN
    DELETE FROM public.comisiones WHERE kardex_id = NEW.id AND pagado = false;
    RETURN NEW;
  END IF;

  -- Venta que recién ahora tiene comisión (monto seteado post-insert)
  IF NEW.tipo_movimiento = 'venta'
     AND NEW.pedido_eliminado = false
     AND COALESCE(NEW.comision_viajante_monto, 0) <> 0
     AND COALESCE(OLD.comision_viajante_monto, 0) = 0 THEN
    PERFORM public.sync_comision_desde_kardex_manual(NEW.id);
  END IF;

  -- Sincronizar estado de cobro y monto (solo si no está pagada)
  UPDATE public.comisiones co SET
    comprobante_cobrado = COALESCE(NEW.comprobante_cobrado, false),
    fecha_comprobante_cobrado = NEW.fecha_comprobante_cobrado,
    monto = COALESCE(NEW.comision_viajante_monto, co.monto),
    porcentaje = COALESCE(NEW.comision_viajante_pct, co.porcentaje)
  WHERE co.kardex_id = NEW.id
    AND co.pagado = false
    AND (co.comprobante_cobrado IS DISTINCT FROM COALESCE(NEW.comprobante_cobrado, false)
         OR co.fecha_comprobante_cobrado IS DISTINCT FROM NEW.fecha_comprobante_cobrado
         OR co.monto IS DISTINCT FROM NEW.comision_viajante_monto);

  RETURN NEW;
END;
$$;

-- Inserta la fila de comisiones para un kardex puntual (usada por el trigger de update)
CREATE OR REPLACE FUNCTION public.sync_comision_desde_kardex_manual(p_kardex_id uuid)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.comisiones (
    viajante_id, pedido_id, monto, porcentaje,
    comprobante_venta_id, comprobante_cobrado, fecha_comprobante_cobrado,
    tipo, articulo_id, segmento, cantidad, precio_neto_unitario,
    kardex_id, created_at
  )
  SELECT
    k.vendedor_id, k.pedido_id, k.comision_viajante_monto, COALESCE(k.comision_viajante_pct, 0),
    k.comprobante_venta_id, COALESCE(k.comprobante_cobrado, false), k.fecha_comprobante_cobrado,
    'vendida', k.articulo_id, k.articulo_categoria, k.cantidad,
    CASE WHEN COALESCE(k.cantidad, 0) <> 0 THEN COALESCE(k.subtotal_neto, 0) / k.cantidad END,
    k.id, COALESCE(k.fecha, now())
  FROM public.kardex k
  WHERE k.id = p_kardex_id
  ON CONFLICT (kardex_id) WHERE kardex_id IS NOT NULL DO NOTHING;
$$;

DROP TRIGGER IF EXISTS trg_sync_comision_update ON public.kardex;
CREATE TRIGGER trg_sync_comision_update
  AFTER UPDATE ON public.kardex
  FOR EACH ROW
  WHEN (NEW.tipo_movimiento = 'venta')
  EXECUTE FUNCTION public.sync_comision_update_kardex();

-- ============================================================================
-- 4. OPCIONAL — DECISIÓN DE NEGOCIO (descomentar solo si corresponde):
-- Las 9.852 comisiones legacy (ventas mar-may, era pre-kardex) figuran como
-- pendientes de pago. Si esas comisiones ya se liquidaron fuera del sistema,
-- descomentá esto para que no aparezcan como pagables:
--
-- UPDATE public.comisiones
-- SET pagado = true,
--     fecha_pago = now(),
--     motivo = COALESCE(motivo || ' | ', '') || 'cierre era pre-kardex 2026-07-30 (liquidadas fuera del sistema)'
-- WHERE kardex_id IS NULL AND pagado = false;
-- ============================================================================
