-- Nuevo segmento de proveedor: perfumeria +/0
-- Artículos que entran en blanco (iva_compras=factura) pero salen en negro (iva_ventas=presupuesto)
-- Ejemplo: marca Suiza. El coef IVA 1.21 se aplica al precio, tienen su propio recargo de lista.

-- ─── listas_precio: columna de recargo para perf_medio ───────────────────────
ALTER TABLE listas_precio ADD COLUMN IF NOT EXISTS recargo_perfumeria_medio numeric DEFAULT 0;

-- ─── clientes: lista y método por segmento perf_medio ────────────────────────
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS lista_perf_medio_id uuid REFERENCES listas_precio(id);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS metodo_perf_medio text;

-- ─── pedidos: overrides por segmento perf_medio ──────────────────────────────
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS lista_perf_medio_pedido_id uuid REFERENCES listas_precio(id);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS metodo_perf_medio_pedido text;
