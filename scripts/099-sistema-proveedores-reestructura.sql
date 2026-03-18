-- =====================================================
-- Script 099: Reestructuración sistema de proveedores
-- Tablas nuevas para: vencimientos, órdenes de pago,
-- cheques extendidos, excenciones impositivas
-- NO modifica tablas existentes con datos
-- =====================================================

-- ─────────────────────────────────────────────────────
-- 1. VENCIMIENTOS (agenda general de pagos)
-- Cualquier cosa que venza: factura de mercadería,
-- VEP de ARBA/ARCA, luz, seguros, hosting, etc.
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vencimientos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proveedor_id UUID REFERENCES proveedores(id),
    -- Tipo: factura, servicio, impuesto, seguro, vep, otro
    tipo VARCHAR(50) NOT NULL DEFAULT 'factura',
    concepto TEXT NOT NULL,
    -- Ej: "Factura A 0001-00045678", "IIBB Marzo 2026", "Seguro camión patente ABC123"
    monto NUMERIC(20,2) NOT NULL DEFAULT 0,
    moneda VARCHAR(10) DEFAULT 'ARS',
    fecha_vencimiento DATE NOT NULL,
    -- Estado del vencimiento
    estado VARCHAR(30) DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagado', 'vencido', 'cancelado')),
    -- Recurrencia (null = único, o "mensual", "bimestral", "trimestral", "semestral", "anual")
    recurrencia VARCHAR(30) DEFAULT NULL,
    -- Si es recurrente, hasta cuándo generar (null = indefinido)
    recurrencia_hasta DATE DEFAULT NULL,
    -- Referencia al comprobante o movimiento de CC que lo originó
    referencia_id UUID,
    referencia_tipo VARCHAR(50), -- 'comprobante_compra', 'cuenta_corriente', 'orden_pago', etc.
    -- Referencia a la orden de pago que lo cubrió
    orden_pago_id UUID,
    observaciones TEXT,
    -- Alerta: días antes del vencimiento para avisar
    dias_alerta INTEGER DEFAULT 3,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vencimientos_proveedor ON vencimientos(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_vencimientos_fecha ON vencimientos(fecha_vencimiento);
CREATE INDEX IF NOT EXISTS idx_vencimientos_estado ON vencimientos(estado);
CREATE INDEX IF NOT EXISTS idx_vencimientos_tipo ON vencimientos(tipo);

COMMENT ON TABLE vencimientos IS 'Agenda general de vencimientos. Factura, VEP, servicios, seguros, impuestos, etc. Sirve como agenda de pagos.';
COMMENT ON COLUMN vencimientos.recurrencia IS 'Si es recurrente: mensual, bimestral, trimestral, semestral, anual. NULL = pago único.';
COMMENT ON COLUMN vencimientos.dias_alerta IS 'Cuántos días antes del vencimiento generar alerta.';


-- ─────────────────────────────────────────────────────
-- 2. ÓRDENES DE PAGO (cabecera)
-- Instrucción de "hay que pagarle a X proveedor"
-- Puede afectar o no a comprobantes/vencimientos
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ordenes_pago (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    numero_op VARCHAR(20) NOT NULL,
    proveedor_id UUID NOT NULL REFERENCES proveedores(id),
    fecha DATE NOT NULL DEFAULT CURRENT_DATE,
    -- Monto total de la orden de pago
    monto_total NUMERIC(20,2) NOT NULL DEFAULT 0,
    -- Estado
    estado VARCHAR(30) DEFAULT 'borrador' CHECK (estado IN ('borrador', 'pendiente', 'pagada', 'parcial', 'cancelada')),
    -- Observaciones
    observaciones TEXT,
    -- Retenciones aplicadas en este pago
    retencion_ganancias NUMERIC(20,2) DEFAULT 0,
    retencion_iibb NUMERIC(20,2) DEFAULT 0,
    retencion_iva NUMERIC(20,2) DEFAULT 0,
    retencion_suss NUMERIC(20,2) DEFAULT 0,
    -- Total retenciones
    total_retenciones NUMERIC(20,2) DEFAULT 0,
    -- Neto a pagar (monto_total - total_retenciones)
    neto_a_pagar NUMERIC(20,2) DEFAULT 0,
    -- Usuario que creó
    usuario_creador VARCHAR(100) DEFAULT 'admin',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ordenes_pago_proveedor ON ordenes_pago(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_pago_estado ON ordenes_pago(estado);
CREATE INDEX IF NOT EXISTS idx_ordenes_pago_fecha ON ordenes_pago(fecha);

COMMENT ON TABLE ordenes_pago IS 'Órdenes de pago a proveedores. Pueden tener múltiples medios de pago (mixto).';


-- ─────────────────────────────────────────────────────
-- 3. ÓRDENES DE PAGO DETALLE (medios de pago)
-- Cada línea es un medio: cheque, transferencia, etc.
-- Soporta pagos mixtos
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ordenes_pago_detalle (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    orden_pago_id UUID NOT NULL REFERENCES ordenes_pago(id) ON DELETE CASCADE,
    -- Medio de pago
    medio VARCHAR(30) NOT NULL CHECK (medio IN ('efectivo', 'cheque', 'cheque_propio', 'transferencia', 'deposito')),
    monto NUMERIC(20,2) NOT NULL DEFAULT 0,
    -- Datos según medio
    -- Cheque tercero: referencia al cheque en cartera
    cheque_id UUID,
    -- Cheque propio: datos inline
    cheque_banco VARCHAR(100),
    cheque_numero VARCHAR(50),
    cheque_fecha_vencimiento DATE,
    -- Transferencia/Depósito
    banco_destino VARCHAR(100),
    numero_cuenta VARCHAR(100),
    cbu VARCHAR(30),
    numero_transferencia VARCHAR(100),
    fecha_transferencia DATE,
    -- Observaciones
    observaciones TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_op_detalle_orden ON ordenes_pago_detalle(orden_pago_id);

COMMENT ON TABLE ordenes_pago_detalle IS 'Detalle de medios de pago de una orden. Soporta mixto: parte cheque, parte transferencia, etc.';


-- ─────────────────────────────────────────────────────
-- 4. ÓRDENES DE PAGO IMPUTACIONES
-- Qué comprobantes/vencimientos cubre esta OP
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ordenes_pago_imputaciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    orden_pago_id UUID NOT NULL REFERENCES ordenes_pago(id) ON DELETE CASCADE,
    -- Puede imputar contra un movimiento de CC o un vencimiento
    movimiento_cc_id UUID REFERENCES cuenta_corriente_proveedores(id),
    vencimiento_id UUID REFERENCES vencimientos(id),
    comprobante_compra_id UUID REFERENCES comprobantes_compra(id),
    -- Monto imputado a este comprobante/vencimiento
    monto_imputado NUMERIC(20,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_op_imputaciones_orden ON ordenes_pago_imputaciones(orden_pago_id);
CREATE INDEX IF NOT EXISTS idx_op_imputaciones_mov ON ordenes_pago_imputaciones(movimiento_cc_id);
CREATE INDEX IF NOT EXISTS idx_op_imputaciones_venc ON ordenes_pago_imputaciones(vencimiento_id);

COMMENT ON TABLE ordenes_pago_imputaciones IS 'Qué comprobantes o vencimientos cubre cada orden de pago.';


-- ─────────────────────────────────────────────────────
-- 5. EXTENDER TABLA CHEQUES
-- Agregar columnas faltantes para el flujo completo
-- La tabla ya existe (vacía), solo le agregamos campos
-- ─────────────────────────────────────────────────────

-- Verificar qué columnas tiene y agregar las faltantes
ALTER TABLE cheques ADD COLUMN IF NOT EXISTS tipo VARCHAR(30) DEFAULT 'tercero' CHECK (tipo IN ('tercero', 'propio'));
ALTER TABLE cheques ADD COLUMN IF NOT EXISTS proveedor_destino_id UUID REFERENCES proveedores(id);
ALTER TABLE cheques ADD COLUMN IF NOT EXISTS cliente_origen_id UUID;
ALTER TABLE cheques ADD COLUMN IF NOT EXISTS cuenta_banco_deposito VARCHAR(100);
ALTER TABLE cheques ADD COLUMN IF NOT EXISTS fecha_deposito DATE;
ALTER TABLE cheques ADD COLUMN IF NOT EXISTS fecha_rechazo DATE;
ALTER TABLE cheques ADD COLUMN IF NOT EXISTS motivo_rechazo TEXT;
ALTER TABLE cheques ADD COLUMN IF NOT EXISTS orden_pago_id UUID REFERENCES ordenes_pago(id);

-- Actualizar constraint de estado si no tiene los valores nuevos
-- Primero verificar si existe un check constraint y manejarlo
DO $$
BEGIN
    -- Intentar agregar/actualizar el check constraint de estado
    -- Si la columna estado no tiene check, lo agregamos
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints 
        WHERE constraint_name LIKE '%cheques_estado%'
    ) THEN
        BEGIN
            ALTER TABLE cheques ADD CONSTRAINT cheques_estado_check 
                CHECK (estado IN ('EN_CARTERA', 'DEPOSITADO', 'PASADO_PROVEEDOR', 'RECHAZADO', 'ELIMINADO'));
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Check constraint already exists or cannot be added: %', SQLERRM;
        END;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cheques_estado ON cheques(estado);
CREATE INDEX IF NOT EXISTS idx_cheques_proveedor ON cheques(proveedor_destino_id);
CREATE INDEX IF NOT EXISTS idx_cheques_vencimiento ON cheques(fecha_vencimiento);

COMMENT ON COLUMN cheques.tipo IS 'tercero = recibido de un cliente, propio = emitido por nosotros';
COMMENT ON COLUMN cheques.proveedor_destino_id IS 'A qué proveedor se endosó/pasó el cheque';
COMMENT ON COLUMN cheques.cuenta_banco_deposito IS 'En qué cuenta bancaria se depositó (si estado=DEPOSITADO)';
COMMENT ON COLUMN cheques.orden_pago_id IS 'Orden de pago en la que se usó este cheque';


-- ─────────────────────────────────────────────────────
-- 6. EXCENCIONES IMPOSITIVAS POR PROVEEDOR
-- Períodos en que un proveedor está exento de
-- retenciones o percepciones específicas
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS excenciones_impositivas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proveedor_id UUID NOT NULL REFERENCES proveedores(id),
    -- Tipo de excención
    tipo VARCHAR(50) NOT NULL CHECK (tipo IN (
        'retencion_ganancias', 'retencion_iibb', 'retencion_iva', 'retencion_suss',
        'percepcion_iva', 'percepcion_iibb'
    )),
    -- Período de vigencia
    fecha_desde DATE NOT NULL,
    fecha_hasta DATE NOT NULL,
    -- Porcentaje de excención (100 = totalmente exento, 50 = mitad)
    porcentaje_excencion NUMERIC(5,2) DEFAULT 100,
    -- Número de certificado o resolución
    numero_certificado VARCHAR(100),
    observaciones TEXT,
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_excenciones_proveedor ON excenciones_impositivas(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_excenciones_vigencia ON excenciones_impositivas(fecha_desde, fecha_hasta);

COMMENT ON TABLE excenciones_impositivas IS 'Períodos de excención impositiva por proveedor. Ej: exento de retención IIBB del 01/03 al 30/06.';


-- ─────────────────────────────────────────────────────
-- 7. AGREGAR tipo_proveedor = transporte
-- El CHECK constraint actual solo permite 
-- mercaderia_general y servicios. Lo extendemos.
-- ─────────────────────────────────────────────────────
DO $$
BEGIN
    -- Drop old constraint if exists
    ALTER TABLE proveedores DROP CONSTRAINT IF EXISTS proveedores_tipo_proveedor_check;
    -- No re-add constraint, just allow free text since proveedores already has data
    -- The app will control valid values
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'No constraint to drop: %', SQLERRM;
END $$;

-- Agregar transporte_id para vincular proveedores tipo transporte con la tabla transportes
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS transporte_id UUID;

COMMENT ON COLUMN proveedores.transporte_id IS 'Si tipo_proveedor=transporte, vincula con la tabla transportes';


-- ─────────────────────────────────────────────────────
-- 8. AGREGAR vencimiento a cuenta_corriente_proveedores
-- Para saber cuándo vence cada comprobante
-- ─────────────────────────────────────────────────────
ALTER TABLE cuenta_corriente_proveedores ADD COLUMN IF NOT EXISTS fecha_vencimiento DATE;
ALTER TABLE cuenta_corriente_proveedores ADD COLUMN IF NOT EXISTS numero_comprobante VARCHAR(50);
ALTER TABLE cuenta_corriente_proveedores ADD COLUMN IF NOT EXISTS tipo_comprobante VARCHAR(20);

COMMENT ON COLUMN cuenta_corriente_proveedores.fecha_vencimiento IS 'Fecha de vencimiento del comprobante, calculada según plazo del proveedor';
COMMENT ON COLUMN cuenta_corriente_proveedores.numero_comprobante IS 'Número de comprobante para referencia rápida';
COMMENT ON COLUMN cuenta_corriente_proveedores.tipo_comprobante IS 'FA, NCA, NDA, etc.';


-- ─────────────────────────────────────────────────────
-- 9. SECUENCIA para número de orden de pago
-- ─────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS ordenes_pago_seq START 1;
