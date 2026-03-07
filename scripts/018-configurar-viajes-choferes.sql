-- Agregar columna chofer_id a la tabla viajes para vincular con usuarios
ALTER TABLE viajes
ADD COLUMN IF NOT EXISTS chofer_id uuid REFERENCES profiles(id);

-- Crear tabla para registrar pagos/cobranzas por viaje
CREATE TABLE IF NOT EXISTS viajes_pagos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  viaje_id uuid REFERENCES viajes(id) ON DELETE CASCADE NOT NULL,
  pedido_id uuid REFERENCES pedidos(id) ON DELETE CASCADE,
  cliente_id uuid REFERENCES clientes(id) NOT NULL,
  fecha timestamp with time zone DEFAULT now(),
  forma_pago character varying NOT NULL, -- 'efectivo', 'cheque', 'transferencia'
  monto numeric(12,2) NOT NULL,
  -- Datos específicos para cheques
  banco character varying,
  numero_cheque character varying,
  fecha_cheque date,
  -- Datos específicos para transferencias
  referencia_transferencia character varying,
  -- Metadata
  registrado_por uuid REFERENCES profiles(id), -- chofer que registró el pago
  observaciones text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Crear índices para optimizar consultas
CREATE INDEX IF NOT EXISTS idx_viajes_chofer_id ON viajes(chofer_id);
CREATE INDEX IF NOT EXISTS idx_viajes_pagos_viaje_id ON viajes_pagos(viaje_id);
CREATE INDEX IF NOT EXISTS idx_viajes_pagos_pedido_id ON viajes_pagos(pedido_id);
CREATE INDEX IF NOT EXISTS idx_viajes_pagos_cliente_id ON viajes_pagos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_viajes_pagos_fecha ON viajes_pagos(fecha);

-- Comentarios para documentación
COMMENT ON COLUMN viajes.chofer_id IS 'Usuario (chofer) asignado al viaje';
COMMENT ON TABLE viajes_pagos IS 'Registro de pagos/cobranzas realizadas durante el viaje por el chofer';
COMMENT ON COLUMN viajes_pagos.forma_pago IS 'Tipo de pago: efectivo, cheque, transferencia';
COMMENT ON COLUMN viajes_pagos.registrado_por IS 'Chofer que registró la cobranza desde la app';
