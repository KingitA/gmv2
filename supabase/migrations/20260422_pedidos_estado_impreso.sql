-- Agrega 'impreso' como valor válido en pedidos.estado
-- Si la columna tiene un CHECK constraint, lo reemplaza incluyendo 'impreso'

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  -- Buscar si existe un check constraint en pedidos.estado
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'pedidos'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%estado%'
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE pedidos DROP CONSTRAINT ' || quote_ident(constraint_name);
  END IF;
END $$;

-- Recrear el constraint incluyendo 'impreso'
ALTER TABLE pedidos ADD CONSTRAINT pedidos_estado_check CHECK (
  estado IN (
    'pendiente',
    'en_preparacion',
    'impreso',
    'pendiente_facturacion',
    'facturado',
    'listo_para_retirar',
    'listo_para_enviar',
    'en_viaje',
    'entregado',
    'rechazado',
    'eliminado'
  )
);
