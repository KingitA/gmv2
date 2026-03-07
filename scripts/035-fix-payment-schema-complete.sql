-- 1. Ajustes en pagos_clientes
-- Agregar relaciones con viajes y pedidos
ALTER TABLE pagos_clientes 
ADD COLUMN IF NOT EXISTS viaje_id UUID REFERENCES viajes(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS pedido_id UUID REFERENCES pedidos(id) ON DELETE SET NULL;

-- Permitir nulos en forma_pago ya que ahora el detalle está en pagos_detalle
ALTER TABLE pagos_clientes
ALTER COLUMN forma_pago DROP NOT NULL;

-- 2. Ajustes en pagos_detalle
-- Agregar campo referencia para transferencias
ALTER TABLE pagos_detalle
ADD COLUMN IF NOT EXISTS referencia VARCHAR(100);

-- 3. Ajustes en imputaciones
-- Agregar estado para control de aprobación
ALTER TABLE imputaciones
ADD COLUMN IF NOT EXISTS estado VARCHAR(20) DEFAULT 'pendiente';

-- Asegurar que las restricciones de clave foránea estén eliminadas (por si no se corrieron los scripts anteriores)
DO $$ 
BEGIN
  -- Intentar eliminar FK de imputaciones si existen
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'imputaciones_pago_id_fkey') THEN
    ALTER TABLE imputaciones DROP CONSTRAINT imputaciones_pago_id_fkey;
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'imputaciones_comprobante_id_fkey') THEN
    ALTER TABLE imputaciones DROP CONSTRAINT imputaciones_comprobante_id_fkey;
  END IF;

  -- Intentar eliminar FK de pagos_detalle si existe
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'pagos_detalle_pago_id_fkey') THEN
    ALTER TABLE pagos_detalle DROP CONSTRAINT pagos_detalle_pago_id_fkey;
  END IF;
END $$;
