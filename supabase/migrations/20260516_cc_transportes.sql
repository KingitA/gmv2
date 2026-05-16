-- Tabla de cuenta corriente para transportes
-- Permite imputar faltantes de mercadería al transporte responsable

CREATE TABLE IF NOT EXISTS cuenta_corriente_transportes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  transporte_id uuid REFERENCES transportes(id) NOT NULL,
  fecha timestamptz NOT NULL DEFAULT now(),
  tipo_movimiento varchar NOT NULL, -- 'faltante_mercaderia' | 'pago' | 'ajuste'
  monto numeric(12,2) NOT NULL,
  descripcion text,
  referencia_id uuid,
  referencia_tipo varchar, -- 'recepcion' | 'pago'
  numero_comprobante varchar,
  creado_por uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cc_transportes_transporte ON cuenta_corriente_transportes(transporte_id, fecha DESC);

-- Permisos
GRANT SELECT ON cuenta_corriente_transportes TO claude_readonly;
