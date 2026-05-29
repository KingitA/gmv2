-- Agrega creado_por a devoluciones para registrar quién generó la devolución
-- (vendedor o chofer), independiente del vendedor_id que tiene FK a vendedores.
ALTER TABLE devoluciones
  ADD COLUMN IF NOT EXISTS creado_por uuid REFERENCES usuarios(id);
