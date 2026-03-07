-- Migration: Finance Module V2 + AI Support

-- 1. ENUMS
DO $$ BEGIN
    CREATE TYPE money_color AS ENUM ('BLANCO','NEGRO');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE payment_method AS ENUM ('EFECTIVO','TRANSFERENCIA','DEPOSITO','MERCADOPAGO','CHEQUE_TERCERO','CHEQUE_PROPIO');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE fund_account_type AS ENUM ('CAJA','BANCO');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE movement_kind AS ENUM ('INGRESO','EGRESO','TRANSFERENCIA_INTERNA');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE cheque_type AS ENUM ('TERCERO','PROPIO');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE cheque_status AS ENUM ('EN_CARTERA','DEPOSITADO','ENTREGADO_A_PROVEEDOR','COBRADO','RECHAZADO');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE pending_payment_status AS ENUM ('PENDIENTE','CONFIRMADO','ANULADO');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE expense_category AS ENUM ('OPERATIVO','SUELDOS','INVERSION','CREDITO','IMPUESTOS','OTROS');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. TABLES

-- A) Cajas Financieras
CREATE TABLE IF NOT EXISTS cajas_financieras (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre text UNIQUE NOT NULL,
    activo boolean DEFAULT true,
    created_at timestamptz DEFAULT now()
);

-- B) Cuentas Bancarias
CREATE TABLE IF NOT EXISTS cuentas_bancarias (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    banco text NOT NULL,
    nombre text NOT NULL,
    alias text,
    cbu text,
    activo boolean DEFAULT true,
    created_at timestamptz DEFAULT now()
);

-- C) Saldos Financieros
CREATE TABLE IF NOT EXISTS saldos_financieros (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cuenta_tipo fund_account_type NOT NULL,
    cuenta_id uuid NOT NULL,
    color money_color NOT NULL,
    saldo numeric(14,2) NOT NULL DEFAULT 0,
    updated_at timestamptz DEFAULT now(),
    UNIQUE (cuenta_tipo, cuenta_id, color)
);

-- D) Movimientos Financieros (Ledger)
CREATE TABLE IF NOT EXISTS movimientos_financieros (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    fecha timestamptz NOT NULL DEFAULT now(),
    kind movement_kind NOT NULL,
    origen_tipo fund_account_type,
    origen_id uuid,
    destino_tipo fund_account_type,
    destino_id uuid,
    metodo payment_method NOT NULL,
    color money_color NOT NULL,
    monto numeric(14,2) NOT NULL CHECK (monto > 0),
    referencia_tipo text, -- 'COBRO_CLIENTE','PAGO_PROVEEDOR','GASTO','TRANSFERENCIA','DEPOSITO_CHEQUE'
    referencia_id uuid,
    descripcion text,
    creado_por uuid REFERENCES auth.users(id),
    created_at timestamptz DEFAULT now()
);

-- E) Pagos Pendientes (Ingreso previo a confirmación)
CREATE TABLE IF NOT EXISTS pagos_pendientes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id uuid NOT NULL, 
    fecha_carga timestamptz NOT NULL DEFAULT now(),
    metodo payment_method NOT NULL,
    monto numeric(14,2) NOT NULL CHECK (monto > 0),
    color_sugerido money_color,
    detalle text,
    estado pending_payment_status NOT NULL DEFAULT 'PENDIENTE',
    cargado_por uuid REFERENCES auth.users(id),
    confirmado_por uuid REFERENCES auth.users(id),
    confirmado_at timestamptz,
    referencia_cc_id uuid,
    created_at timestamptz DEFAULT now()
);

-- F) Cheques
CREATE TABLE IF NOT EXISTS cheques (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo cheque_type NOT NULL,
    estado cheque_status NOT NULL DEFAULT 'EN_CARTERA',
    banco text NOT NULL,
    numero text NOT NULL,
    fecha_emision date,
    fecha_vencimiento date NOT NULL,
    monto numeric(14,2) NOT NULL CHECK (monto > 0),
    color money_color NOT NULL,
    cliente_origen_id uuid,
    proveedor_destino_id uuid,
    cuenta_banco_id uuid, -- Para deposito
    creado_desde_pago_pendiente_id uuid,
    observaciones text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE (banco, numero, monto, fecha_vencimiento)
);

-- G) Pagos Proveedores (Cabecera)
CREATE TABLE IF NOT EXISTS pagos_proveedores (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    proveedor_id uuid NOT NULL,
    fecha timestamptz NOT NULL DEFAULT now(),
    total numeric(14,2) NOT NULL CHECK(total>0),
    color money_color NOT NULL,
    estado text NOT NULL DEFAULT 'CONFIRMADO',
    descripcion text,
    creado_por uuid REFERENCES auth.users(id),
    created_at timestamptz DEFAULT now()
);

-- H) Pagos Proveedores Items
CREATE TABLE IF NOT EXISTS pagos_proveedores_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pago_proveedor_id uuid NOT NULL REFERENCES pagos_proveedores(id) ON DELETE CASCADE,
    metodo payment_method NOT NULL,
    monto numeric(14,2) NOT NULL CHECK(monto>0),
    origen_tipo fund_account_type,
    origen_id uuid,
    cheque_id uuid REFERENCES cheques(id),
    cuenta_banco_id uuid, 
    caja_id uuid,         
    created_at timestamptz DEFAULT now()
);

-- I) Egresos Generales
CREATE TABLE IF NOT EXISTS egresos_generales (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    fecha timestamptz DEFAULT now(),
    categoria expense_category NOT NULL,
    descripcion text NOT NULL,
    metodo payment_method NOT NULL,
    color money_color NOT NULL,
    monto numeric(14,2) NOT NULL CHECK(monto>0),
    origen_tipo fund_account_type NOT NULL,
    origen_id uuid NOT NULL,
    creado_por uuid REFERENCES auth.users(id),
    created_at timestamptz DEFAULT now()
);

-- J) Proveedor Preferencias (IA Extension)
CREATE TABLE IF NOT EXISTS proveedor_preferencias_pago (
    proveedor_id uuid PRIMARY KEY, -- 1:1 con proveedor
    acepta_cheques_terceros boolean DEFAULT true,
    acepta_transferencia boolean DEFAULT true,
    acepta_efectivo boolean DEFAULT true,
    dias_tolerancia_vencimiento int DEFAULT 30,
    prioridad_color money_color DEFAULT 'NEGRO', -- preferido
    politica_cheques text, 
    comentarios text,
    updated_at timestamptz DEFAULT now()
);

-- K) Pagos Sugeridos (IA Extension)
CREATE TABLE IF NOT EXISTS pagos_proveedores_sugeridos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    proveedor_id uuid NOT NULL,
    color money_color NOT NULL,
    monto_objetivo numeric(14,2) NOT NULL,
    items_json jsonb NOT NULL, 
    razonamiento text,
    confianza numeric(3,2), -- 0.00 a 1.00
    estado text NOT NULL DEFAULT 'BORRADOR', -- BORRADOR, APROBADO, RECHAZADO, EJECUTADO
    creado_por uuid REFERENCES auth.users(id),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);


-- 3. INDEXES
CREATE INDEX IF NOT EXISTS idx_mov_fecha ON movimientos_financieros (fecha);
CREATE INDEX IF NOT EXISTS idx_mov_ref ON movimientos_financieros (referencia_tipo, referencia_id);
CREATE INDEX IF NOT EXISTS idx_mov_origen ON movimientos_financieros (origen_tipo, origen_id);
CREATE INDEX IF NOT EXISTS idx_mov_destino ON movimientos_financieros (destino_tipo, destino_id);

CREATE INDEX IF NOT EXISTS idx_pagos_pendientes_cliente ON pagos_pendientes (cliente_id, estado);
CREATE INDEX IF NOT EXISTS idx_pagos_pendientes_fecha ON pagos_pendientes (fecha_carga);

CREATE INDEX IF NOT EXISTS idx_cheques_estado ON cheques (estado, fecha_vencimiento);
CREATE INDEX IF NOT EXISTS idx_cheques_origen ON cheques (cliente_origen_id);
CREATE INDEX IF NOT EXISTS idx_cheques_destino ON cheques (proveedor_destino_id);


-- 4. RLS POLICIES 
ALTER TABLE cajas_financieras ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuentas_bancarias ENABLE ROW LEVEL SECURITY;
ALTER TABLE saldos_financieros ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos_financieros ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos_pendientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE cheques ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos_proveedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos_proveedores_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE egresos_generales ENABLE ROW LEVEL SECURITY;
ALTER TABLE proveedor_preferencias_pago ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos_proveedores_sugeridos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read for authenticated users" ON cajas_financieras FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable read for authenticated users" ON cuentas_bancarias FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable read for authenticated users" ON saldos_financieros FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable read for authenticated users" ON movimientos_financieros FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable read for authenticated users" ON cheques FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable read for authenticated users" ON proveedor_preferencias_pago FOR SELECT TO authenticated USING (true);

CREATE POLICY "Enable insert for authenticated users" ON pagos_pendientes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Enable select for authenticated users" ON pagos_pendientes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable update for authenticated users" ON pagos_pendientes FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Enable all for authenticated users" ON movimientos_financieros FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON cheques FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON pagos_proveedores FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON pagos_proveedores_items FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON egresos_generales FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON pagos_proveedores_sugeridos FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable all for authenticated users" ON proveedor_preferencias_pago FOR ALL TO authenticated USING (true);


-- 5. RPC FUNCTIONS (TRANSACTIONAL)

-- RPC: Confirmar Pago Pendiente
CREATE OR REPLACE FUNCTION fin_confirmar_pago_pendiente(
    p_pago_id uuid,
    p_destino_tipo fund_account_type,
    p_destino_id uuid,
    p_color_final money_color,
    p_user_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_pago record;
    v_cheque_id uuid;
BEGIN
    SELECT * INTO v_pago FROM pagos_pendientes WHERE id = p_pago_id AND estado = 'PENDIENTE' FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pago no encontrado o no está pendiente';
    END IF;

    IF v_pago.metodo = 'EFECTIVO' OR v_pago.metodo IN ('TRANSFERENCIA','DEPOSITO','MERCADOPAGO') THEN
        INSERT INTO saldos_financieros (cuenta_tipo, cuenta_id, color, saldo)
        VALUES (p_destino_tipo, p_destino_id, p_color_final, v_pago.monto)
        ON CONFLICT (cuenta_tipo, cuenta_id, color)
        DO UPDATE SET saldo = saldos_financieros.saldo + EXCLUDED.saldo, updated_at = now();

        INSERT INTO movimientos_financieros (kind, origen_tipo, origen_id, destino_tipo, destino_id, metodo, color, monto, referencia_tipo, referencia_id, creado_por)
        VALUES ('INGRESO', null, null, p_destino_tipo, p_destino_id, v_pago.metodo, p_color_final, v_pago.monto, 'COBRO_CLIENTE', p_pago_id, p_user_id);

    ELSIF v_pago.metodo = 'CHEQUE_TERCERO' THEN
        INSERT INTO cheques (tipo, estado, banco, numero, fecha_emision, fecha_vencimiento, monto, color, cliente_origen_id, creado_desde_pago_pendiente_id)
        VALUES ('TERCERO', 'EN_CARTERA', split_part(v_pago.detalle, '|', 1), split_part(v_pago.detalle, '|', 2), now(), (v_pago.fecha_carga + interval '30 days')::date, v_pago.monto, p_color_final, v_pago.cliente_id, p_pago_id)
        RETURNING id INTO v_cheque_id;
    END IF;

    UPDATE pagos_pendientes
    SET estado = 'CONFIRMADO', confirmado_por = p_user_id, confirmado_at = now()
    WHERE id = p_pago_id;

    RETURN json_build_object('success', true, 'cheque_id', v_cheque_id);
EXCEPTION
    WHEN OTHERS THEN
        RAISE; 
END;
$$;


-- RPC: Crear Pago Proveedor (Updated for CHEQUE_PROPIO)
CREATE OR REPLACE FUNCTION fin_crear_pago_proveedor(
    p_proveedor_id uuid,
    p_color money_color,
    p_items_json jsonb,
    p_total numeric,
    p_user_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_pago_prov_id uuid;
    v_item jsonb;
    v_saldo_actual numeric;
    v_cheque_propio_id uuid;
BEGIN
    INSERT INTO pagos_proveedores (proveedor_id, total, color, estado, creado_por)
    VALUES (p_proveedor_id, p_total, p_color, 'CONFIRMADO', p_user_id)
    RETURNING id INTO v_pago_prov_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items_json)
    LOOP
        -- p_items_json: { tipo, id (if existing), monto, aux_id (if cash/bank), banco, numero, fecha_vencimiento, fecha_emision (if propio) }

        IF v_item->>'tipo' = 'CHEQUE' THEN
            -- Cheque Tercero Existente
            UPDATE cheques 
            SET estado = 'ENTREGADO_A_PROVEEDOR', 
                proveedor_destino_id = p_proveedor_id,
                updated_at = now()
            WHERE id = (v_item->>'id')::uuid AND estado = 'EN_CARTERA';
            
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Cheque % no disponible', v_item->>'id';
            END IF;

            INSERT INTO pagos_proveedores_items (pago_proveedor_id, metodo, monto, cheque_id)
            VALUES (v_pago_prov_id, 'CHEQUE_TERCERO', (v_item->>'monto')::numeric, (v_item->>'id')::uuid);

        ELSIF v_item->>'tipo' = 'CHEQUE_PROPIO' THEN
            -- Cheque Propio Nuevo
            INSERT INTO cheques (
                tipo, estado, banco, numero, fecha_emision, fecha_vencimiento, 
                monto, color, proveedor_destino_id, creado_desde_pago_pendiente_id
            )
            VALUES (
                'PROPIO', 'ENTREGADO_A_PROVEEDOR', v_item->>'banco', v_item->>'numero', 
                COALESCE((v_item->>'fecha_emision')::date, now()::date), 
                (v_item->>'fecha_vencimiento')::date, 
                (v_item->>'monto')::numeric, p_color, p_proveedor_id, null
            )
            RETURNING id INTO v_cheque_propio_id;

            INSERT INTO pagos_proveedores_items (pago_proveedor_id, metodo, monto, cheque_id)
            VALUES (v_pago_prov_id, 'CHEQUE_PROPIO', (v_item->>'monto')::numeric, v_cheque_propio_id);

        ELSIF v_item->>'tipo' = 'EFECTIVO' OR v_item->>'tipo' = 'BANCO' THEN
            SELECT saldo INTO v_saldo_actual 
            FROM saldos_financieros 
            WHERE cuenta_id = (v_item->>'aux_id')::uuid AND color = p_color 
            FOR UPDATE;

            IF v_saldo_actual IS NULL OR v_saldo_actual < (v_item->>'monto')::numeric THEN
                RAISE EXCEPTION 'Saldo insuficiente en cuenta %', v_item->>'aux_id';
            END IF;

            UPDATE saldos_financieros 
            SET saldo = saldo - (v_item->>'monto')::numeric, updated_at = now()
            WHERE cuenta_id = (v_item->>'aux_id')::uuid AND color = p_color;

            INSERT INTO pagos_proveedores_items (pago_proveedor_id, metodo, monto, origen_tipo, origen_id)
            VALUES (v_pago_prov_id, CASE WHEN v_item->>'tipo'='EFECTIVO' THEN 'EFECTIVO'::payment_method ELSE 'TRANSFERENCIA'::payment_method END, (v_item->>'monto')::numeric, CASE WHEN v_item->>'tipo'='EFECTIVO' THEN 'CAJA'::fund_account_type ELSE 'BANCO'::fund_account_type END, (v_item->>'aux_id')::uuid);

            INSERT INTO movimientos_financieros (kind, origen_tipo, origen_id, destino_tipo, destino_id, metodo, color, monto, referencia_tipo, referencia_id, creado_por)
            VALUES ('EGRESO', CASE WHEN v_item->>'tipo'='EFECTIVO' THEN 'CAJA'::fund_account_type ELSE 'BANCO'::fund_account_type END, (v_item->>'aux_id')::uuid, null, null, CASE WHEN v_item->>'tipo'='EFECTIVO' THEN 'EFECTIVO'::payment_method ELSE 'TRANSFERENCIA'::payment_method END, p_color, (v_item->>'monto')::numeric, 'PAGO_PROVEEDOR', v_pago_prov_id, p_user_id);
            
        END IF;
    END LOOP;

    RETURN json_build_object('success', true, 'pago_id', v_pago_prov_id);
EXCEPTION
    WHEN OTHERS THEN
        RAISE;
END;
$$;


-- RPC: Depositar Cheque
CREATE OR REPLACE FUNCTION fin_depositar_cheque(
    p_cheque_id uuid,
    p_cuenta_banco_id uuid,
    p_user_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE cheques
    SET estado = 'DEPOSITADO', 
        cuenta_banco_id = p_cuenta_banco_id,
        updated_at = now()
    WHERE id = p_cheque_id AND estado = 'EN_CARTERA';

    IF NOT FOUND THEN
         RAISE EXCEPTION 'Cheque no disponible para depósito';
    END IF;

    RETURN json_build_object('success', true);
EXCEPTION WHEN OTHERS THEN RAISE; END;
$$;


-- RPC: Cobrar Cheque
CREATE OR REPLACE FUNCTION fin_cobrar_cheque(
    p_cheque_id uuid,
    p_user_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_cheque cheques%ROWTYPE;
BEGIN
    SELECT * INTO v_cheque FROM cheques WHERE id = p_cheque_id FOR UPDATE;
    
    IF v_cheque.estado != 'DEPOSITADO' THEN
         RAISE EXCEPTION 'El cheque debe estar depositado para cobrarse';
    END IF;

    UPDATE cheques SET estado = 'COBRADO', updated_at = now() WHERE id = p_cheque_id;

    INSERT INTO saldos_financieros (cuenta_tipo, cuenta_id, color, saldo)
    VALUES ('BANCO', v_cheque.cuenta_banco_id, v_cheque.color, v_cheque.monto)
    ON CONFLICT (cuenta_tipo, cuenta_id, color)
    DO UPDATE SET saldo = saldos_financieros.saldo + EXCLUDED.saldo, updated_at = now();

    INSERT INTO movimientos_financieros (kind, origen_tipo, origen_id, destino_tipo, destino_id, metodo, color, monto, referencia_tipo, referencia_id, creado_por)
    VALUES ('INGRESO', null, null, 'BANCO', v_cheque.cuenta_banco_id, 'DEPOSITO', v_cheque.color, v_cheque.monto, 'DEPOSITO_CHEQUE', p_cheque_id, p_user_id);

    RETURN json_build_object('success', true);
EXCEPTION WHEN OTHERS THEN RAISE; END;
$$;

-- Seed Data (Minimal)
INSERT INTO cajas_financieras (nombre) VALUES ('Caja Chica'), ('Caja Principal') ON CONFLICT DO NOTHING;
