-- ============================================================================
-- comisiones: una fila 'vendida' Y una 'cobrada' por línea de kardex
-- ============================================================================
-- uq_comisiones_kardex (20260730) era único por kardex_id a secas: la comisión
-- 'cobrada' que post-confirmación inserta con el mismo kardex_id (trazabilidad
-- de la línea) chocaba y el insert fallaba en silencio → el vendedor nunca
-- veía su comisión cobrada (27/08, Fitterer PRES 10).
-- La unicidad correcta es por (kardex_id, tipo). El trigger de sincronización
-- kardex → comisiones sigue funcionando igual (actualiza por kardex_id, o sea
-- las dos filas, que es lo deseado).
-- ============================================================================
DROP INDEX IF EXISTS uq_comisiones_kardex;
CREATE UNIQUE INDEX IF NOT EXISTS uq_comisiones_kardex_tipo
  ON public.comisiones (kardex_id, tipo)
  WHERE kardex_id IS NOT NULL;

-- El trigger de alta (kardex venta → comisión 'vendida') hacía ON CONFLICT
-- sobre el índice viejo; se apunta al nuevo.
CREATE OR REPLACE FUNCTION public.sync_comision_desde_kardex()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
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
  ON CONFLICT (kardex_id, tipo) WHERE kardex_id IS NOT NULL DO NOTHING;
  RETURN NEW;
END;
$function$;
