-- ═══════════════════════════════════════════════════════════════════════
-- DEVOLUCIONES · tope de cantidad en la BASE (R8, revisión del 27/10/2026)
--
-- El tope "no devolver más de lo vendido en el comprobante de origen" (#25)
-- estaba solo en la aplicación (lib/cobranzas/tope-devolucion.ts): se miraba y
-- después se grababa, así que dos devoluciones cargadas a la vez por el mismo
-- artículo pasaban las dos. Además la revisión de la oficina
-- (PUT /api/devoluciones/[id]) dejaba SUBIR cantidades sin tope.
--
-- Este disparador hace el control al grabar, con un candado por
-- (comprobante, artículo): la segunda devolución espera a la primera y ve lo
-- que ya se devolvió. Mismas reglas que la aplicación:
--  - se compara contra lo vendido en ESE comprobante (comprobantes_venta_detalle);
--  - cuentan las devoluciones pendientes, confirmadas o facturadas; los
--    renglones rechazados no;
--  - un comprobante sin ese artículo en el detalle (apertura del sistema viejo,
--    origen de respaldo del #28) no se puede controlar: pasa.
-- Solo controla cuando la cantidad SUBE (o el renglón deja de estar
-- rechazado): bajar una cantidad o editar otros campos nunca se frena.
--
-- Error: código P0001, mensaje que empieza con "TOPE_DEVOLUCION:" (las rutas lo
-- devuelven como 409 con codigo TOPE_DEVOLUCION).
-- No cambia datos. IDEMPOTENTE.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.devoluciones_detalle_tope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vendido numeric;
  v_devuelto numeric;
  v_hay_detalle boolean;
BEGIN
  IF NEW.comprobante_venta_id IS NULL OR NEW.articulo_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.estado_renglon, '') = 'rechazado' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.cantidad <= OLD.cantidad
     AND NEW.comprobante_venta_id IS NOT DISTINCT FROM OLD.comprobante_venta_id
     AND NEW.articulo_id IS NOT DISTINCT FROM OLD.articulo_id
     AND COALESCE(OLD.estado_renglon, '') <> 'rechazado' THEN
    RETURN NEW;
  END IF;

  -- Candado por (comprobante, artículo) hasta el fin de la transacción
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.comprobante_venta_id::text || '|' || NEW.articulo_id::text, 27102026));

  SELECT COUNT(*) > 0, COALESCE(SUM(d.cantidad), 0)
    INTO v_hay_detalle, v_vendido
    FROM comprobantes_venta_detalle d
   WHERE d.comprobante_id = NEW.comprobante_venta_id
     AND d.articulo_id = NEW.articulo_id;
  IF NOT v_hay_detalle THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(dd.cantidad), 0)
    INTO v_devuelto
    FROM devoluciones_detalle dd
    JOIN devoluciones dv ON dv.id = dd.devolucion_id
   WHERE dd.comprobante_venta_id = NEW.comprobante_venta_id
     AND dd.articulo_id = NEW.articulo_id
     AND dd.id IS DISTINCT FROM NEW.id
     AND COALESCE(dd.estado_renglon, '') <> 'rechazado'
     AND dv.estado IN ('pendiente', 'confirmado', 'facturado');

  IF NEW.cantidad > v_vendido - v_devuelto + 0.000001 THEN
    RAISE EXCEPTION 'TOPE_DEVOLUCION: se vendieron % y ya se devolvieron %; máximo para devolver: %',
      v_vendido, v_devuelto, GREATEST(0, v_vendido - v_devuelto)
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_devoluciones_detalle_tope ON public.devoluciones_detalle;
CREATE TRIGGER trg_devoluciones_detalle_tope
  BEFORE INSERT OR UPDATE OF cantidad, comprobante_venta_id, articulo_id, estado_renglon
  ON public.devoluciones_detalle
  FOR EACH ROW
  EXECUTE FUNCTION public.devoluciones_detalle_tope();

COMMENT ON FUNCTION public.devoluciones_detalle_tope() IS
  'R8 (27/10/2026): no devolver más de lo vendido en el comprobante de origen, con candado por comprobante y artículo';
