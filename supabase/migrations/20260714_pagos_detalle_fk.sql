-- Migration: FK faltante pagos_detalle → pagos_clientes
--
-- Los embeds de PostgREST (`pagos_clientes ... pagos_detalle(...)`) requieren
-- una foreign key para resolver la relación. Sin ella, TODAS las queries que
-- anidaban pagos_detalle fallaban en silencio: la billetera del vendedor daba
-- $0, "pagos sin rendir" siempre vacío y las rendiciones sin datos, aunque los
-- pagos existieran.
--
-- Primero se limpian los detalles huérfanos (5 filas de pagos borrados a mano)
-- porque impiden crear la FK.

DELETE FROM pagos_detalle d
WHERE NOT EXISTS (SELECT 1 FROM pagos_clientes p WHERE p.id = d.pago_id);

ALTER TABLE pagos_detalle
  ADD CONSTRAINT pagos_detalle_pago_id_fkey
  FOREIGN KEY (pago_id) REFERENCES pagos_clientes(id) ON DELETE CASCADE;

-- Refrescar el cache de esquema de PostgREST para que tome la relación nueva
NOTIFY pgrst, 'reload schema';
