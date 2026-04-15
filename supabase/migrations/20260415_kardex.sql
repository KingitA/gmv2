-- Migration: Kardex unificado de movimientos de mercadería
-- Reemplaza movimientos_stock como fuente de verdad para todos los movimientos

CREATE TABLE IF NOT EXISTS kardex (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tipo y dirección del movimiento
  fecha TIMESTAMPTZ NOT NULL,
  tipo_movimiento VARCHAR(30) NOT NULL CHECK (tipo_movimiento IN (
    'venta', 'compra',
    'devolucion_venta', 'devolucion_compra',
    'ajuste_entrada', 'ajuste_salida',
    'nota_credito_venta', 'nota_debito_venta'
  )),
  signo SMALLINT NOT NULL CHECK (signo IN (-1, 1)),
  -- +1 = incrementa stock (compra, devolucion_venta, ajuste_entrada)
  -- -1 = reduce stock   (venta, devolucion_compra, ajuste_salida)

  -- Artículo — denormalizado para reportes sin JOIN (los datos cambian con el tiempo)
  articulo_id UUID NOT NULL REFERENCES articulos(id),
  articulo_sku VARCHAR(200),
  articulo_descripcion TEXT,
  articulo_categoria VARCHAR(100),
  articulo_marca_id UUID,
  articulo_proveedor_id UUID REFERENCES proveedores(id),
  articulo_iva_compras VARCHAR(20),   -- 'factura' | 'adquisicion_stock' | 'mixto'
  articulo_iva_ventas VARCHAR(20),    -- 'factura' | 'presupuesto'

  -- Cantidad (siempre positiva; signo indica dirección)
  cantidad DECIMAL(12, 4) NOT NULL CHECK (cantidad > 0),

  -- Partes involucradas
  cliente_id UUID REFERENCES clientes(id),
  proveedor_id UUID REFERENCES proveedores(id),
  vendedor_id UUID,   -- references auth.users — sin FK para evitar restricción

  -- Precios
  precio_costo DECIMAL(12, 4),              -- snapshot precio_compra al momento del mov.
  precio_unitario_neto DECIMAL(12, 4) NOT NULL,    -- sin IVA
  precio_unitario_final DECIMAL(12, 4) NOT NULL,   -- lo que se cobra/paga (puede incluir IVA)

  -- IVA
  iva_porcentaje DECIMAL(5, 2) NOT NULL DEFAULT 0,    -- 0, 10.5, 21
  iva_monto_unitario DECIMAL(12, 4) NOT NULL DEFAULT 0,
  iva_incluido BOOLEAN NOT NULL DEFAULT FALSE,         -- true = IVA dentro de precio_final

  -- Descuentos (snapshot de lo aplicado)
  descuentos_json JSONB,
  -- Formato: [{"tipo": "comercial"|"financiero"|"promocional", "porcentaje": 5, "monto_unitario": 1.5}]
  descuento_cliente_pct DECIMAL(5, 2) NOT NULL DEFAULT 0,

  -- Totales de línea
  subtotal_neto DECIMAL(12, 2) NOT NULL,    -- cantidad × precio_unitario_neto
  subtotal_iva DECIMAL(12, 2) NOT NULL DEFAULT 0,    -- cantidad × iva_monto_unitario
  subtotal_total DECIMAL(12, 2) NOT NULL,   -- subtotal_neto + subtotal_iva

  -- Margen (solo en ventas; NULL en compras)
  margen_unitario DECIMAL(12, 4),           -- precio_unitario_neto - precio_costo
  margen_porcentaje DECIMAL(5, 2),          -- (margen / precio_neto) × 100

  -- Comprobante / Facturación
  tipo_comprobante VARCHAR(20),             -- 'FA','FB','FC','PRES','NCA','NCB','NCC','FA_COMPRA'
  numero_comprobante VARCHAR(50),
  metodo_facturacion VARCHAR(30),           -- 'Factura' | 'Presupuesto' | 'Final'
  color_dinero VARCHAR(10),                 -- 'BLANCO' | 'NEGRO'
  va_en_comprobante VARCHAR(20),            -- 'factura' | 'presupuesto'

  -- Impuestos adicionales (para posición IVA del contador)
  percepcion_iva_monto DECIMAL(12, 2) NOT NULL DEFAULT 0,
  percepcion_iibb_monto DECIMAL(12, 2) NOT NULL DEFAULT 0,
  percepcion_ganancias_monto DECIMAL(12, 2) NOT NULL DEFAULT 0,
  provincia_destino VARCHAR(100),           -- clientes.zona al momento de la venta

  -- Referencias a tablas originales (trazabilidad)
  -- FKs opcionales se agregan después via DO $$ para no fallar si la tabla no existe
  comprobante_venta_id UUID,
  comprobante_compra_id UUID,
  pedido_id UUID REFERENCES pedidos(id),
  recepcion_id UUID REFERENCES recepciones(id),
  orden_compra_id UUID REFERENCES ordenes_compra(id),
  lista_precio_id UUID,

  -- Snapshot de stock al momento del movimiento
  stock_antes DECIMAL(10, 2),
  stock_despues DECIMAL(10, 2),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── FKs opcionales (solo si las tablas referenciadas existen) ───────────────
DO $$
BEGIN
  -- comprobantes_venta → kardex.comprobante_venta_id
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'comprobantes_venta')
  AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_kardex_comprobante_venta' AND table_name = 'kardex')
  THEN
    ALTER TABLE kardex ADD CONSTRAINT fk_kardex_comprobante_venta
      FOREIGN KEY (comprobante_venta_id) REFERENCES comprobantes_venta(id);
  END IF;

  -- comprobantes_compra → kardex.comprobante_compra_id
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'comprobantes_compra')
  AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_kardex_comprobante_compra' AND table_name = 'kardex')
  THEN
    ALTER TABLE kardex ADD CONSTRAINT fk_kardex_comprobante_compra
      FOREIGN KEY (comprobante_compra_id) REFERENCES comprobantes_compra(id);
  END IF;

  -- listas_precio → kardex.lista_precio_id
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'listas_precio')
  AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_kardex_lista_precio' AND table_name = 'kardex')
  THEN
    ALTER TABLE kardex ADD CONSTRAINT fk_kardex_lista_precio
      FOREIGN KEY (lista_precio_id) REFERENCES listas_precio(id);
  END IF;
END $$;

-- ─── Índices para reportes ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_kardex_fecha              ON kardex (fecha DESC);
CREATE INDEX IF NOT EXISTS idx_kardex_articulo_fecha     ON kardex (articulo_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_kardex_cliente_fecha      ON kardex (cliente_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_kardex_proveedor_fecha    ON kardex (proveedor_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_kardex_vendedor_fecha     ON kardex (vendedor_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_kardex_tipo_fecha         ON kardex (tipo_movimiento, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_kardex_categoria_fecha    ON kardex (articulo_categoria, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_kardex_comprobante_venta  ON kardex (comprobante_venta_id);
CREATE INDEX IF NOT EXISTS idx_kardex_pedido             ON kardex (pedido_id);
CREATE INDEX IF NOT EXISTS idx_kardex_recepcion          ON kardex (recepcion_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE kardex ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'kardex' AND policyname = 'kardex_authenticated'
  ) THEN
    CREATE POLICY "kardex_authenticated" ON kardex FOR ALL TO authenticated USING (true);
  END IF;
END $$;

-- ─── Tabla comisiones (create if not exists) ─────────────────────────────────
-- La tabla puede existir ya en Supabase; la creamos solo si no está.
CREATE TABLE IF NOT EXISTS comisiones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  viajante_id UUID,                        -- vendedor / viajante
  pedido_id UUID REFERENCES pedidos(id) ON DELETE SET NULL,
  monto DECIMAL(12, 2) NOT NULL DEFAULT 0,
  porcentaje DECIMAL(5, 2) NOT NULL DEFAULT 0,
  pagado BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_pago TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Ajustes a tabla comisiones ───────────────────────────────────────────────
-- Agregar columnas nuevas de forma defensiva (ignora si ya existen)
DO $$
BEGIN
  -- comprobante_venta_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'comisiones' AND column_name = 'comprobante_venta_id'
  ) THEN
    ALTER TABLE comisiones ADD COLUMN comprobante_venta_id UUID;
    -- FK por separado para que no falle si la columna ya existía sin FK
    ALTER TABLE comisiones
      ADD CONSTRAINT fk_comisiones_comprobante_venta
      FOREIGN KEY (comprobante_venta_id) REFERENCES comprobantes_venta(id);
  END IF;

  -- comprobante_cobrado
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'comisiones' AND column_name = 'comprobante_cobrado'
  ) THEN
    ALTER TABLE comisiones ADD COLUMN comprobante_cobrado BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;

  -- fecha_comprobante_cobrado
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'comisiones' AND column_name = 'fecha_comprobante_cobrado'
  ) THEN
    ALTER TABLE comisiones ADD COLUMN fecha_comprobante_cobrado TIMESTAMPTZ;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_comisiones_comprobante     ON comisiones (comprobante_venta_id);
CREATE INDEX IF NOT EXISTS idx_comisiones_viajante_estado ON comisiones (viajante_id, comprobante_cobrado, pagado);
