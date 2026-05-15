-- =============================================================================
-- Kardex V3: reordenar columnas + renombrar precio_unitario_neto → precio_lista
-- Recrea la tabla dentro de una transacción para garantizar atomicidad.
-- PREREQUISITO: correr todas las migraciones kardex_v2 anteriores primero.
-- =============================================================================

BEGIN;

-- 1. Crear kardex_new con columnas en el orden correcto
--    precio_unitario_neto desaparece: sus datos van a precio_lista
-- -----------------------------------------------------------------------------
CREATE TABLE kardex_new (
  -- Identificación y clasificación
  id                              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha                           TIMESTAMPTZ NOT NULL,
  tipo_movimiento                 VARCHAR     NOT NULL
    CHECK (tipo_movimiento IN ('venta','compra','devolucion_venta','devolucion_compra',
                               'ajuste_entrada','ajuste_salida','nota_credito_venta','nota_debito_venta')),
  signo                           SMALLINT    NOT NULL CHECK (signo IN (-1, 1)),

  -- Artículo (denormalizado)
  articulo_id                     UUID        NOT NULL REFERENCES articulos(id),
  articulo_sku                    VARCHAR,
  articulo_descripcion            TEXT,
  articulo_categoria              VARCHAR,
  articulo_marca_id               UUID,
  articulo_proveedor_id           UUID        REFERENCES proveedores(id),
  articulo_iva_compras            VARCHAR,
  articulo_iva_ventas             VARCHAR,

  -- Cantidad
  cantidad                        NUMERIC     NOT NULL CHECK (cantidad > 0),

  -- Actores de la operación
  cliente_id                      UUID        REFERENCES clientes(id),
  proveedor_id                    UUID        REFERENCES proveedores(id),
  vendedor_id                     UUID,

  -- Precios de compra / descuentos proveedor
  precio_costo                    NUMERIC,
  descuento_proveedor_pct         NUMERIC(8,4),
  descuento_proveedor_monto       NUMERIC(14,4),
  descuento_proveedor_financiero_pct  NUMERIC(8,4),
  descuento_proveedor_financiero_monto NUMERIC(14,4),
  descuento_proveedor_comercial_pct   NUMERIC(8,4),
  descuento_proveedor_comercial_monto NUMERIC(14,4),

  -- Precio base de venta y descuentos de venta
  precio_lista                    NUMERIC,    -- antes llamado precio_unitario_neto
  descuento_mercaderia_pct        NUMERIC,
  descuento_mercaderia_monto      NUMERIC,
  descuento_general_pct           NUMERIC,
  descuento_general_monto         NUMERIC,
  descuento_viajante_pct          NUMERIC,
  descuento_viajante_monto        NUMERIC,
  descuento_financiero_pct        NUMERIC,
  descuento_financiero_monto      NUMERIC,
  precio_unitario_final           NUMERIC     NOT NULL,

  -- IVA
  iva_porcentaje                  NUMERIC     DEFAULT 0,
  iva_monto_unitario              NUMERIC     DEFAULT 0,
  iva_incluido                    BOOLEAN     DEFAULT false,

  -- Subtotales
  subtotal_neto                   NUMERIC     NOT NULL,
  subtotal_iva                    NUMERIC     DEFAULT 0,
  subtotal_total                  NUMERIC     NOT NULL,

  -- Comisión del viajante (embebida)
  comision_viajante_pct           NUMERIC(8,4),
  comision_viajante_monto         NUMERIC(14,4),

  -- Márgenes calculados
  margen_unitario                 NUMERIC,
  margen_porcentaje               NUMERIC,

  -- Comprobante
  tipo_comprobante                VARCHAR,
  numero_comprobante              VARCHAR,
  metodo_facturacion              VARCHAR,
  color_dinero                    VARCHAR,
  va_en_comprobante               VARCHAR,

  -- Percepciones
  percepcion_iva_pct              NUMERIC(8,4) DEFAULT 0,
  percepcion_iva_monto            NUMERIC      DEFAULT 0,
  percepcion_iibb_pct             NUMERIC(8,4) DEFAULT 0,
  percepcion_iibb_monto           NUMERIC      DEFAULT 0,
  percepcion_ganancias_pct        NUMERIC(8,4) DEFAULT 0,
  percepcion_ganancias_monto      NUMERIC      DEFAULT 0,
  provincia_destino               VARCHAR,

  -- Referencias a entidades originales
  comprobante_venta_id            UUID        REFERENCES comprobantes_venta(id),
  comprobante_compra_id           UUID        REFERENCES comprobantes_compra(id),
  pedido_id                       UUID        REFERENCES pedidos(id),
  recepcion_id                    UUID        REFERENCES recepciones(id),
  orden_compra_id                 UUID        REFERENCES ordenes_compra(id),
  lista_precio_id                 UUID        REFERENCES listas_precio(id),

  -- Stock snapshot
  stock_antes                     NUMERIC,
  stock_despues                   NUMERIC,

  -- Timestamps
  created_at                      TIMESTAMPTZ DEFAULT NOW(),

  -- Actores del proceso logístico
  comprador_id                    UUID,
  receptor_id                     UUID,
  controlador_id                  UUID,
  pagador_id                      UUID,
  preparadores_ids                UUID[],
  facturador_id                   UUID,
  entregador_id                   UUID,
  cobrador_id                     UUID,
  modificador_deposito_id         UUID,

  -- Tracking de cobro del cliente
  comprobante_cobrado             BOOLEAN     DEFAULT false,
  fecha_comprobante_cobrado       TIMESTAMPTZ,

  -- Columnas extra usadas en código (no en CSV, al final)
  operador_id                     UUID        REFERENCES auth.users(id),
  descuentos_json                 JSONB,
  descuento_cliente_pct           NUMERIC     DEFAULT 0
);

-- 2. Migrar datos: precio_unitario_neto → precio_lista
-- -----------------------------------------------------------------------------
INSERT INTO kardex_new (
  id, fecha, tipo_movimiento, signo,
  articulo_id, articulo_sku, articulo_descripcion, articulo_categoria,
  articulo_marca_id, articulo_proveedor_id, articulo_iva_compras, articulo_iva_ventas,
  cantidad,
  cliente_id, proveedor_id, vendedor_id,
  precio_costo,
  descuento_proveedor_pct, descuento_proveedor_monto,
  descuento_proveedor_financiero_pct, descuento_proveedor_financiero_monto,
  descuento_proveedor_comercial_pct, descuento_proveedor_comercial_monto,
  precio_lista,
  descuento_mercaderia_pct, descuento_mercaderia_monto,
  descuento_general_pct, descuento_general_monto,
  descuento_viajante_pct, descuento_viajante_monto,
  descuento_financiero_pct, descuento_financiero_monto,
  precio_unitario_final,
  iva_porcentaje, iva_monto_unitario, iva_incluido,
  subtotal_neto, subtotal_iva, subtotal_total,
  comision_viajante_pct, comision_viajante_monto,
  margen_unitario, margen_porcentaje,
  tipo_comprobante, numero_comprobante, metodo_facturacion, color_dinero, va_en_comprobante,
  percepcion_iva_pct, percepcion_iva_monto,
  percepcion_iibb_pct, percepcion_iibb_monto,
  percepcion_ganancias_pct, percepcion_ganancias_monto,
  provincia_destino,
  comprobante_venta_id, comprobante_compra_id,
  pedido_id, recepcion_id, orden_compra_id, lista_precio_id,
  stock_antes, stock_despues,
  created_at,
  comprador_id, receptor_id, controlador_id, pagador_id,
  preparadores_ids,
  facturador_id, entregador_id, cobrador_id, modificador_deposito_id,
  comprobante_cobrado, fecha_comprobante_cobrado,
  operador_id,
  descuentos_json,
  descuento_cliente_pct
)
SELECT
  id, fecha, tipo_movimiento, signo,
  articulo_id, articulo_sku, articulo_descripcion, articulo_categoria,
  articulo_marca_id, articulo_proveedor_id, articulo_iva_compras, articulo_iva_ventas,
  cantidad,
  cliente_id, proveedor_id, vendedor_id,
  precio_costo,
  descuento_proveedor_pct, descuento_proveedor_monto,
  descuento_proveedor_financiero_pct, descuento_proveedor_financiero_monto,
  descuento_proveedor_comercial_pct, descuento_proveedor_comercial_monto,
  -- Fusionar: precio_lista estaba vacío, precio_unitario_neto tenía los datos
  COALESCE(precio_lista, precio_unitario_neto) AS precio_lista,
  descuento_mercaderia_pct, descuento_mercaderia_monto,
  descuento_general_pct, descuento_general_monto,
  descuento_viajante_pct, descuento_viajante_monto,
  descuento_financiero_pct, descuento_financiero_monto,
  precio_unitario_final,
  iva_porcentaje, iva_monto_unitario, iva_incluido,
  subtotal_neto, subtotal_iva, subtotal_total,
  comision_viajante_pct, comision_viajante_monto,
  margen_unitario, margen_porcentaje,
  tipo_comprobante, numero_comprobante, metodo_facturacion, color_dinero, va_en_comprobante,
  percepcion_iva_pct, percepcion_iva_monto,
  percepcion_iibb_pct, percepcion_iibb_monto,
  percepcion_ganancias_pct, percepcion_ganancias_monto,
  provincia_destino,
  comprobante_venta_id, comprobante_compra_id,
  pedido_id, recepcion_id, orden_compra_id, lista_precio_id,
  stock_antes, stock_despues,
  created_at,
  comprador_id, receptor_id, controlador_id, pagador_id,
  preparadores_ids,
  facturador_id, entregador_id, cobrador_id, modificador_deposito_id,
  comprobante_cobrado, fecha_comprobante_cobrado,
  operador_id,
  descuentos_json,
  descuento_cliente_pct
FROM kardex;

-- Verificar que migramos todas las filas
DO $$
DECLARE
  old_count BIGINT;
  new_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO old_count FROM kardex;
  SELECT COUNT(*) INTO new_count FROM kardex_new;
  IF old_count <> new_count THEN
    RAISE EXCEPTION 'Row count mismatch: kardex=% kardex_new=%', old_count, new_count;
  END IF;
END $$;

-- 3. Soltar FK de comisiones antes de borrar kardex
-- -----------------------------------------------------------------------------
ALTER TABLE comisiones DROP CONSTRAINT comisiones_kardex_id_fkey;

-- 4. Reemplazar la tabla
-- -----------------------------------------------------------------------------
DROP TABLE kardex;
ALTER TABLE kardex_new RENAME TO kardex;

-- 5. Restaurar FK de comisiones
-- -----------------------------------------------------------------------------
ALTER TABLE comisiones
  ADD CONSTRAINT comisiones_kardex_id_fkey
    FOREIGN KEY (kardex_id) REFERENCES kardex(id) ON DELETE SET NULL;

-- 6. Recrear todos los índices
-- -----------------------------------------------------------------------------
CREATE INDEX idx_kardex_fecha            ON kardex(fecha DESC);
CREATE INDEX idx_kardex_articulo_fecha   ON kardex(articulo_id, fecha DESC);
CREATE INDEX idx_kardex_articulo_fecha_desc ON kardex(articulo_id, fecha DESC, created_at DESC);
CREATE INDEX idx_kardex_cliente_fecha    ON kardex(cliente_id, fecha DESC);
CREATE INDEX idx_kardex_proveedor_fecha  ON kardex(proveedor_id, fecha DESC);
CREATE INDEX idx_kardex_vendedor_fecha   ON kardex(vendedor_id, fecha DESC);
CREATE INDEX idx_kardex_tipo_fecha       ON kardex(tipo_movimiento, fecha DESC);
CREATE INDEX idx_kardex_categoria_fecha  ON kardex(articulo_categoria, fecha DESC);
CREATE INDEX idx_kardex_comprobante_venta ON kardex(comprobante_venta_id);
CREATE INDEX idx_kardex_pedido           ON kardex(pedido_id);
CREATE INDEX idx_kardex_recepcion        ON kardex(recepcion_id);
CREATE INDEX idx_kardex_operador         ON kardex(operador_id);
CREATE INDEX idx_kardex_cobrado          ON kardex(comprobante_venta_id) WHERE comprobante_cobrado = true;
CREATE INDEX idx_kardex_comision_viajante ON kardex(vendedor_id, fecha)
  WHERE comision_viajante_monto IS NOT NULL AND comision_viajante_monto > 0;
CREATE INDEX idx_comisiones_kardex       ON comisiones(kardex_id) WHERE kardex_id IS NOT NULL;

-- 7. Verificación final
-- -----------------------------------------------------------------------------
SELECT
  COUNT(*) AS total_filas,
  COUNT(*) FILTER (WHERE precio_lista IS NOT NULL AND precio_lista > 0) AS filas_con_precio_lista,
  COUNT(*) FILTER (WHERE tipo_movimiento = 'venta') AS ventas,
  COUNT(*) FILTER (WHERE tipo_movimiento = 'compra') AS compras
FROM kardex;

COMMIT;
