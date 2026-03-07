-- Agregar campos necesarios para DJ GESTION en proveedores
ALTER TABLE proveedores
ADD COLUMN IF NOT EXISTS tipo_iva INTEGER, -- 1-9 según tabla TIPO IVA
ADD COLUMN IF NOT EXISTS condicion_pago VARCHAR(2) DEFAULT 'CC', -- CC o E
ADD COLUMN IF NOT EXISTS dias_vencimiento INTEGER DEFAULT 30; -- días para calcular FECHAVTO

-- Agregar campos necesarios para DJ GESTION en artículos
ALTER TABLE articulos
ADD COLUMN IF NOT EXISTS sigla VARCHAR(2); -- Sigla de 2 dígitos para DJ GESTION

-- Comentarios explicativos
COMMENT ON COLUMN proveedores.tipo_iva IS 'Código de tipo IVA: 1=Sujeto Excento, 2=Responsable Inscripto, 3=N/A, 4=Consumidor Final, 5=Excento Ley, 6=Monotributo, 7=Responsable Monotributo, 8=No Categorizado, 9=Responsable Inscripto RG4520';
COMMENT ON COLUMN proveedores.condicion_pago IS 'Condición de pago: CC=Cuenta Corriente, E=Contado';
COMMENT ON COLUMN proveedores.dias_vencimiento IS 'Días para calcular fecha de vencimiento desde fecha de factura o recepción';
COMMENT ON COLUMN articulos.sigla IS 'Sigla de 2 dígitos usada en DJ GESTION';
