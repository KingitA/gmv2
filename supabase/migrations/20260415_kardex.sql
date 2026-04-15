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
  comprobante_venta_id UUID REFERENCES comprobantes_venta(id),
  comprobante_compra_id UUID REFERENCES comprobantes_compra(id),
  pedido_id UUID REFERENCES pedidos(id),
  recepcion_id UUID REFERENCES recepciones(id),
  orden_compra_id UUID REFERENCES ordenes_compra(id),
  lista_precio_id UUID REFERENCES listas_precio(id),

  -- Snapshot de stock al momento del movimiento
  stock_antes DECIMAL(10, 2),
  stock_despues DECIMAL(10, 2),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
CREATE POLICY "kardex_authenticated" ON kardex FOR ALL TO authenticated USING (true);

-- ─── Ajustes a tabla comisiones ───────────────────────────────────────────────
-- Vincular comisión al comprobante generado y rastrear cuándo se vuelve cobrable
ALTER TABLE comisiones
  ADD COLUMN IF NOT EXISTS comprobante_venta_id UUID REFERENCES comprobantes_venta(id),
  ADD COLUMN IF NOT EXISTS comprobante_cobrado BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS fecha_comprobante_cobrado TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_comisiones_comprobante     ON comisiones (comprobante_venta_id);
CREATE INDEX IF NOT EXISTS idx_comisiones_viajante_estado ON comisiones (viajante_id, comprobante_cobrado, pagado);
