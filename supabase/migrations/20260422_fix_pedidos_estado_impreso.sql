-- Elimina TODOS los check constraints de pedidos (por si el anterior quedó con otro nombre)
-- y recrea uno limpio que incluye 'impreso'

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'pedidos'::regclass
      AND contype = 'c'
  LOOP
    EXECUTE 'ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
  END LOOP;
END $$;

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
