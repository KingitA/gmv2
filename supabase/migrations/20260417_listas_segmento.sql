-- Migration: Listas de precio por segmento de proveedor
-- Permite asignar una lista + método de facturación diferente según el tipo de artículo:
--   LIMPIEZA/BAZAR  → artículos sin "PERFUMERIA" en categoría
--   PERFUMERÍA 0    → artículos con "PERFUMERIA" en categoría + iva_compras='adquisicion_stock'
--   PERFUMERÍA +    → artículos con "PERFUMERIA" en categoría + iva_compras IN ('factura','mixto')
--
-- Jerarquía de resolución por ítem:
--   1. Override en el pedido (lista_*_pedido_id / metodo_*_pedido)
--   2. Default del cliente (lista_*_id / metodo_*)
--   3. Fallback → lista general del pedido / cliente (comportamiento previo)

-- ─── Defaults por segmento en CLIENTES ───────────────────────────────────────
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS lista_limpieza_id   UUID REFERENCES listas_precio(id),
  ADD COLUMN IF NOT EXISTS metodo_limpieza     VARCHAR(50),
  ADD COLUMN IF NOT EXISTS lista_perf0_id      UUID REFERENCES listas_precio(id),
  ADD COLUMN IF NOT EXISTS metodo_perf0        VARCHAR(50),
  ADD COLUMN IF NOT EXISTS lista_perf_plus_id  UUID REFERENCES listas_precio(id),
  ADD COLUMN IF NOT EXISTS metodo_perf_plus    VARCHAR(50);

-- ─── Overrides por segmento en PEDIDOS ───────────────────────────────────────
ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS lista_limpieza_pedido_id   UUID REFERENCES listas_precio(id),
  ADD COLUMN IF NOT EXISTS metodo_limpieza_pedido     VARCHAR(50),
  ADD COLUMN IF NOT EXISTS lista_perf0_pedido_id      UUID REFERENCES listas_precio(id),
  ADD COLUMN IF NOT EXISTS metodo_perf0_pedido        VARCHAR(50),
  ADD COLUMN IF NOT EXISTS lista_perf_plus_pedido_id  UUID REFERENCES listas_precio(id),
  ADD COLUMN IF NOT EXISTS metodo_perf_plus_pedido    VARCHAR(50);

-- ─── Registro de lista/método usado por ítem en PEDIDOS_DETALLE ──────────────
ALTER TABLE pedidos_detalle
  ADD COLUMN IF NOT EXISTS lista_precio_id        UUID REFERENCES listas_precio(id),
  ADD COLUMN IF NOT EXISTS metodo_facturacion_item VARCHAR(50);
