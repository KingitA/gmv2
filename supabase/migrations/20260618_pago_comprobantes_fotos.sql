-- Fotos/archivos de comprobantes de pago (transferencias, cheques) cargados por
-- choferes/vendedores/ERP. Se ven en el Historial de pagos ("ver comprobantes").
-- Las imágenes viven en el bucket de Storage 'comprobantes-pago'; acá guardamos la URL.
CREATE TABLE IF NOT EXISTS pago_comprobantes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pago_id     uuid REFERENCES pagos_clientes(id) ON DELETE CASCADE,
  url         text NOT NULL,
  nombre      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pago_comprobantes_pago ON pago_comprobantes (pago_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON pago_comprobantes TO anon, authenticated, service_role;
