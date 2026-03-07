-- Script 036: Esquema para Módulo de Recepción Inteligente
-- Autor: Sistema ERP
-- Fecha: 2025

-- 1. Tabla de Recepciones (Cabecera)
CREATE TABLE IF NOT EXISTS recepciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    orden_compra_id UUID REFERENCES ordenes_compra(id) ON DELETE CASCADE,
    fecha_inicio TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    fecha_fin TIMESTAMP WITH TIME ZONE,
    estado VARCHAR(50) DEFAULT 'borrador' CHECK (estado IN ('borrador', 'en_proceso', 'finalizada', 'cancelada')),
    usuario_id UUID, -- Referencia al usuario que realiza la recepción
    observaciones TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Tabla de Documentos de Recepción (OCR)
CREATE TABLE IF NOT EXISTS recepciones_documentos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recepcion_id UUID REFERENCES recepciones(id) ON DELETE CASCADE,
    tipo_documento VARCHAR(50) NOT NULL CHECK (tipo_documento IN ('factura', 'presupuesto', 'remito', 'nota_credito', 'reversa')),
    url_imagen TEXT,
    datos_ocr JSONB, -- Almacena la respuesta cruda del OCR
    procesado BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Tabla de Items de Recepción (Cotejo Físico vs OC vs Documento)
-- Nota: Se eliminaron columnas de precio según feedback del usuario. El precio se valida en otra instancia.
CREATE TABLE IF NOT EXISTS recepciones_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recepcion_id UUID REFERENCES recepciones(id) ON DELETE CASCADE,
    articulo_id UUID REFERENCES articulos(id) ON DELETE RESTRICT,
    
    cantidad_oc DECIMAL(10, 2) DEFAULT 0, -- Cantidad esperada según Orden de Compra
    cantidad_fisica DECIMAL(10, 2) DEFAULT 0, -- Cantidad contada físicamente
    cantidad_documentada DECIMAL(10, 2) DEFAULT 0, -- Cantidad leída del documento (OCR)
    
    estado_linea VARCHAR(50) DEFAULT 'pendiente' CHECK (estado_linea IN ('pendiente', 'ok', 'diferencia_cantidad', 'no_pedido')),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Tabla de Mapeo Artículos Proveedor (Aprendizaje)
CREATE TABLE IF NOT EXISTS articulos_proveedores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proveedor_id UUID REFERENCES proveedores(id) ON DELETE CASCADE,
    articulo_id UUID REFERENCES articulos(id) ON DELETE CASCADE,
    codigo_proveedor VARCHAR(100), -- SKU del proveedor
    descripcion_proveedor VARCHAR(255), -- Nombre como aparece en la factura
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(proveedor_id, articulo_id),
    UNIQUE(proveedor_id, codigo_proveedor)
);

-- Indices para mejorar performance
CREATE INDEX IF NOT EXISTS idx_recepciones_oc ON recepciones(orden_compra_id);
CREATE INDEX IF NOT EXISTS idx_recepciones_items_recepcion ON recepciones_items(recepcion_id);
CREATE INDEX IF NOT EXISTS idx_recepciones_docs_recepcion ON recepciones_documentos(recepcion_id);
CREATE INDEX IF NOT EXISTS idx_articulos_prov_mapping ON articulos_proveedores(proveedor_id, codigo_proveedor);
