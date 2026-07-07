-- Migration: viaje de levantamiento de pedidos del vendedor
-- Reutiliza la tabla viajes (mismo viaje se trabaja luego desde ERP, depósito
-- y choferes). Los viajes existentes quedan como tipo 'reparto'.

ALTER TABLE viajes
  ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) NOT NULL DEFAULT 'reparto',
  ADD COLUMN IF NOT EXISTS vendedor_id UUID REFERENCES vendedores(id),
  ADD COLUMN IF NOT EXISTS fecha_inicio DATE,
  ADD COLUMN IF NOT EXISTS fecha_fin_estimada DATE;

-- Varias zonas por viaje de levantamiento (viajes.zona_id queda como principal)
CREATE TABLE IF NOT EXISTS viaje_zonas (
  viaje_id UUID NOT NULL REFERENCES viajes(id) ON DELETE CASCADE,
  zona_id  UUID NOT NULL REFERENCES zonas(id)  ON DELETE CASCADE,
  PRIMARY KEY (viaje_id, zona_id)
);

-- Estado del cliente dentro del viaje: 'pendiente' | 'no_va'.
-- 'pedido_levantado' se deriva de los pedidos reales creados durante el viaje.
ALTER TABLE viajes_clientes
  ADD COLUMN IF NOT EXISTS estado VARCHAR(20) NOT NULL DEFAULT 'pendiente';

CREATE INDEX IF NOT EXISTS idx_viajes_tipo_vendedor ON viajes (tipo, vendedor_id);
