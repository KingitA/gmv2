-- ─────────────────────────────────────────────────────────────────────────────
-- FASE B Compras: recepciones multi-tanda + trazabilidad documento→comprobante
-- (29/07/2026)
--
-- 1. recepciones.numero_tanda: una OC puede recibirse en varias tandas; cada
--    tanda es una fila de recepciones sobre la misma OC con los saldos
--    pendientes. La OC pasa a recibida_completa solo cuando el acumulado
--    cubre lo pedido (o se cierra con faltantes desde verificación).
-- 2. recepciones_documentos.comprobante_id: vincula la foto/PDF con el
--    comprobante que el OCR creó — necesario para revertir correctamente al
--    eliminar un documento (borrar detalle y restar cantidades documentadas).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE recepciones
  ADD COLUMN IF NOT EXISTS numero_tanda int DEFAULT 1;

ALTER TABLE recepciones_documentos
  ADD COLUMN IF NOT EXISTS comprobante_id uuid REFERENCES comprobantes_compra(id) ON DELETE SET NULL;

-- Control
SELECT count(*) AS recepciones, count(DISTINCT orden_compra_id) AS ocs FROM recepciones;
