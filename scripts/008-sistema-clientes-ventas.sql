-- Tabla de Vendedores
CREATE TABLE IF NOT EXISTS vendedores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  telefono VARCHAR(50),
  comision_bazar_limpieza DECIMAL(5,2) DEFAULT 6.00,
  comision_perfumeria DECIMAL(5,2) DEFAULT 3.00,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tabla de Transportes
CREATE TABLE IF NOT EXISTS transportes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(255) NOT NULL,
  cuit VARCHAR(20),
  telefono VARCHAR(50),
  email VARCHAR(255),
  porcentaje_flete DECIMAL(5,2) NOT NULL,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tabla de Zonas
CREATE TABLE IF NOT EXISTS zonas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(255) NOT NULL,
  descripcion TEXT,
  tipo_flete VARCHAR(50) DEFAULT 'retira', -- 'propio', 'transporte', 'cliente', 'retira'
  transporte_id UUID REFERENCES transportes(id),
  porcentaje_flete DECIMAL(5,2) DEFAULT 0,
  costo_nafta DECIMAL(10,2) DEFAULT 0,
  costo_sueldo DECIMAL(10,2) DEFAULT 0,
  costo_pernoctada DECIMAL(10,2) DEFAULT 0,
  costo_otros DECIMAL(10,2) DEFAULT 0,
  dias_visita VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tabla de Clientes
CREATE TABLE IF NOT EXISTS clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(255) NOT NULL,
  razon_social VARCHAR(255),
  direccion TEXT,
  cuit VARCHAR(20),
  condicion_iva VARCHAR(50) DEFAULT 'Consumidor Final', -- 'Responsable Inscripto', 'Monotributo', 'Consumidor Final', 'Sujeto Exento', 'No Categorizado'
  metodo_facturacion VARCHAR(50) DEFAULT 'Factura', -- 'Factura', 'Final', 'Presupuesto'
  localidad VARCHAR(100),
  provincia VARCHAR(100),
  telefono VARCHAR(50),
  mail VARCHAR(255),
  condicion_pago VARCHAR(50) DEFAULT 'Efectivo', -- 'Efectivo', 'Transferencia', 'Cheque al día', 'Cheque 30 días', 'Cheque 30/60/90'
  nro_iibb VARCHAR(50),
  exento_iibb BOOLEAN DEFAULT false,
  exento_iva BOOLEAN DEFAULT false,
  percepcion_iibb DECIMAL(5,2) DEFAULT 0,
  tipo_canal VARCHAR(50) DEFAULT 'Minorista', -- 'Mayorista', 'Minorista', 'Consumidor Final'
  puntaje DECIMAL(5,2) DEFAULT 70,
  nivel_puntaje VARCHAR(20) DEFAULT 'Regular', -- 'Premium', 'Regular', 'Riesgo', 'Crítico'
  porcentaje_ajuste DECIMAL(5,2) DEFAULT 0,
  vendedor_id UUID REFERENCES vendedores(id),
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Relación Clientes-Zonas (muchos a muchos)
CREATE TABLE IF NOT EXISTS clientes_zonas (
  cliente_id UUID REFERENCES clientes(id) ON DELETE CASCADE,
  zona_id UUID REFERENCES zonas(id) ON DELETE CASCADE,
  PRIMARY KEY (cliente_id, zona_id)
);

-- Tabla de Viajes
CREATE TABLE IF NOT EXISTS viajes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(255) NOT NULL,
  fecha DATE NOT NULL,
  zona_id UUID REFERENCES zonas(id),
  estado VARCHAR(50) DEFAULT 'planificando', -- 'planificando', 'en_preparacion', 'en_viaje', 'completado', 'cancelado'
  tipo_transporte VARCHAR(50), -- 'propio', 'tercero', 'cliente', 'retira'
  transporte_id UUID REFERENCES transportes(id),
  porcentaje_flete DECIMAL(5,2) DEFAULT 0,
  chofer VARCHAR(255),
  vehiculo VARCHAR(255),
  dinero_nafta DECIMAL(10,2) DEFAULT 0,
  gastos_adicionales DECIMAL(10,2) DEFAULT 0,
  gastos_hotel DECIMAL(10,2) DEFAULT 0,
  gastos_peon DECIMAL(10,2) DEFAULT 0,
  observaciones TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Relación Viajes-Clientes (para clientes agregados manualmente)
CREATE TABLE IF NOT EXISTS viajes_clientes (
  viaje_id UUID REFERENCES viajes(id) ON DELETE CASCADE,
  cliente_id UUID REFERENCES clientes(id) ON DELETE CASCADE,
  PRIMARY KEY (viaje_id, cliente_id)
);

-- Tabla de Pedidos
CREATE TABLE IF NOT EXISTS pedidos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_pedido VARCHAR(50) UNIQUE NOT NULL,
  cliente_id UUID REFERENCES clientes(id) NOT NULL,
  viaje_id UUID REFERENCES viajes(id),
  vendedor_id UUID REFERENCES vendedores(id),
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  estado VARCHAR(50) DEFAULT 'pendiente', -- 'pendiente', 'asignado', 'preparado', 'facturado', 'controlado', 'entregado'
  punto_venta VARCHAR(50), -- 'vendedor', 'whatsapp', 'web', 'deposito'
  subtotal DECIMAL(10,2) DEFAULT 0,
  descuento_vendedor DECIMAL(5,2) DEFAULT 0,
  descuento_general DECIMAL(10,2) DEFAULT 0,
  total_comision DECIMAL(10,2) DEFAULT 0,
  total_flete DECIMAL(10,2) DEFAULT 0,
  total_impuestos DECIMAL(10,2) DEFAULT 0,
  total DECIMAL(10,2) DEFAULT 0,
  observaciones TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Detalle de Pedidos
CREATE TABLE IF NOT EXISTS pedidos_detalle (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id UUID REFERENCES pedidos(id) ON DELETE CASCADE,
  articulo_id UUID REFERENCES articulos(id),
  cantidad DECIMAL(10,2) NOT NULL,
  precio_costo DECIMAL(10,2) NOT NULL,
  precio_base DECIMAL(10,2) NOT NULL,
  precio_final DECIMAL(10,2) NOT NULL,
  descuento_articulo DECIMAL(5,2) DEFAULT 0,
  comision DECIMAL(10,2) DEFAULT 0,
  flete DECIMAL(10,2) DEFAULT 0,
  impuestos DECIMAL(10,2) DEFAULT 0,
  subtotal DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Métricas de Clientes (para cálculo de puntaje)
CREATE TABLE IF NOT EXISTS metricas_clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID REFERENCES clientes(id) ON DELETE CASCADE UNIQUE,
  volumen_6_meses DECIMAL(10,2) DEFAULT 0,
  compras_6_meses INTEGER DEFAULT 0,
  facturas_en_termino INTEGER DEFAULT 0,
  facturas_totales INTEGER DEFAULT 0,
  dias_mora_promedio DECIMAL(5,2) DEFAULT 0,
  reclamos_6_meses INTEGER DEFAULT 0,
  devoluciones_6_meses INTEGER DEFAULT 0,
  ultima_actualizacion TIMESTAMP DEFAULT NOW()
);

-- Historial de Puntajes
CREATE TABLE IF NOT EXISTS historial_puntajes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID REFERENCES clientes(id) ON DELETE CASCADE,
  puntaje_anterior DECIMAL(5,2),
  puntaje_nuevo DECIMAL(5,2),
  nivel_anterior VARCHAR(20),
  nivel_nuevo VARCHAR(20),
  volumen_compra DECIMAL(5,2),
  frecuencia_compra DECIMAL(5,2),
  regularidad_pago DECIMAL(5,2),
  mora_promedio DECIMAL(5,2),
  reclamos_devoluciones DECIMAL(5,2),
  motivo TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Benchmarks por Canal
CREATE TABLE IF NOT EXISTS benchmarks_canal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_canal VARCHAR(50) UNIQUE NOT NULL,
  volumen_promedio_mensual DECIMAL(10,2) DEFAULT 0,
  compras_promedio_mensuales DECIMAL(5,2) DEFAULT 0,
  ultima_actualizacion TIMESTAMP DEFAULT NOW()
);

-- Insertar benchmarks iniciales
INSERT INTO benchmarks_canal (tipo_canal, volumen_promedio_mensual, compras_promedio_mensuales)
VALUES 
  ('Mayorista', 2000000.00, 1.0),
  ('Minorista', 400000.00, 4.0),
  ('Consumidor Final', 50000.00, 2.0)
ON CONFLICT (tipo_canal) DO NOTHING;

-- Comprobantes de Venta
CREATE TABLE IF NOT EXISTS comprobantes_venta (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id UUID REFERENCES pedidos(id),
  cliente_id UUID REFERENCES clientes(id) NOT NULL,
  tipo_comprobante VARCHAR(50) NOT NULL, -- 'Factura A', 'Factura B', 'Factura C', 'Nota de Crédito', etc.
  numero_comprobante VARCHAR(50) NOT NULL,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento DATE,
  total_neto DECIMAL(10,2) NOT NULL,
  total_iva DECIMAL(10,2) DEFAULT 0,
  percepcion_iva DECIMAL(10,2) DEFAULT 0,
  percepcion_iibb DECIMAL(10,2) DEFAULT 0,
  total_factura DECIMAL(10,2) NOT NULL,
  saldo_pendiente DECIMAL(10,2) NOT NULL,
  estado_pago VARCHAR(50) DEFAULT 'pendiente', -- 'pendiente', 'parcial', 'pagado'
  observaciones TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Reclamos y Devoluciones
CREATE TABLE IF NOT EXISTS reclamos_devoluciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID REFERENCES clientes(id) ON DELETE CASCADE,
  pedido_id UUID REFERENCES pedidos(id),
  tipo VARCHAR(50) NOT NULL, -- 'reclamo', 'devolucion'
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  motivo TEXT,
  monto DECIMAL(10,2),
  estado VARCHAR(50) DEFAULT 'pendiente', -- 'pendiente', 'resuelto', 'rechazado'
  created_at TIMESTAMP DEFAULT NOW()
);

-- Agregar columnas a proveedores
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS margen_ganancia DECIMAL(5,2) DEFAULT 0;

-- Agregar columnas a articulos
ALTER TABLE articulos ADD COLUMN IF NOT EXISTS margen_ganancia_custom DECIMAL(5,2);
ALTER TABLE articulos ADD COLUMN IF NOT EXISTS descuento_propio DECIMAL(5,2) DEFAULT 0;

-- Crear índices para mejorar performance
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente ON pedidos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_estado ON pedidos(estado);
CREATE INDEX IF NOT EXISTS idx_pedidos_fecha ON pedidos(fecha);
CREATE INDEX IF NOT EXISTS idx_comprobantes_venta_cliente ON comprobantes_venta(cliente_id);
CREATE INDEX IF NOT EXISTS idx_comprobantes_venta_estado ON comprobantes_venta(estado_pago);
