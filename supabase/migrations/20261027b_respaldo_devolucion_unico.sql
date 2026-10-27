-- ═══════════════════════════════════════════════════════════════════════
-- DEVOLUCIONES · un solo PRES de respaldo 0002-00000001 por cliente (R9, 27/10/2026)
--
-- El respaldo del #28 (lo devuelto en negro sin comprobante con ese artículo)
-- se creaba "si no existe, lo creo": dos devoluciones del mismo cliente a la
-- vez podían crear dos. Con este índice la base no deja crear el segundo; la
-- aplicación (asegurarComprobanteRespaldo) en ese caso usa el que ya está.
--
-- Hoy no hay ningún respaldo creado (verificado en lectura el 27/10), así que
-- el índice se crea sin conflictos. No cambia datos. IDEMPOTENTE.
-- ═══════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS ux_comprobantes_venta_respaldo_devolucion
  ON public.comprobantes_venta (cliente_id)
  WHERE tipo_comprobante = 'PRES'
    AND numero_comprobante = '0002-00000001'
    AND anulado_en IS NULL;
