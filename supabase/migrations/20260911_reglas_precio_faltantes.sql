-- ─────────────────────────────────────────────────────────────────────────────
-- Completa las 3 combinaciones SIN fórmula guardada en listas_precio_reglas
-- (caían al "sistema anterior" — celda LEGACY). Detectadas el 11/09/2026:
--   · PERFUMERIA      | mixto             | presupuesto → 65 artículos (cambian de precio: aplica 0.95)
--   · LIMPIEZA_BAZAR  | factura           | presupuesto → 30 artículos (mismo precio que el legacy, se formaliza)
--   · PERFUMERIA      | adquisicion_stock | factura     → 10 artículos (mismo precio que el legacy, se formaliza)
--
-- Política acordada: en PERFUMERÍA el precio depende solo de IVA VENTAS, así que
-- cada fila nueva es copia exacta de la fila ya cargada con el mismo iva_ventas
-- (la planilla se indexa por la combinación exacta, por eso igual hace falta la fila).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Perfumería · compras MIXTO · ventas PRESUPUESTO (copia de adquisicion_stock/presupuesto)
INSERT INTO listas_precio_reglas (grupo_precio, iva_compras, iva_ventas, formulas)
VALUES ('PERFUMERIA', 'mixto', 'presupuesto', '{
  "viajante":"Base*1.09","neco_final":"Base*1.09","bahia_final":"Base",
  "neco_con_iva":"Base*0.95*1.09*1.21","neco_sin_iva":"Base*0.95*1.09",
  "bahia_con_iva":"Base*.9*1.21","bahia_sin_iva":"Base*.9",
  "neco_presupuesto":"Base*1.09","bahia_presupuesto":"Base"
}'::jsonb)
ON CONFLICT DO NOTHING;

-- 2) Perfumería · compras ADQUISICIÓN · ventas FACTURA (copia de factura/factura)
INSERT INTO listas_precio_reglas (grupo_precio, iva_compras, iva_ventas, formulas)
VALUES ('PERFUMERIA', 'adquisicion_stock', 'factura', '{
  "viajante":"Base*1.04*1.21","neco_final":"Base*1.21*1.04","bahia_final":"Base*1.21",
  "neco_con_iva":"Base*1.04*1.21","neco_sin_iva":"Base*1.04",
  "bahia_con_iva":"Base*1.21","bahia_sin_iva":"Base",
  "neco_presupuesto":"Base*1.21*1.04","bahia_presupuesto":"Base*1.21"
}'::jsonb)
ON CONFLICT DO NOTHING;

-- 3) Limpieza/Bazar · compras FACTURA · ventas PRESUPUESTO
--    (mismo criterio que el legacy: al vender en negro lo comprado en blanco se recupera el IVA → ×1.21)
INSERT INTO listas_precio_reglas (grupo_precio, iva_compras, iva_ventas, formulas)
VALUES ('LIMPIEZA_BAZAR', 'factura', 'presupuesto', '{
  "viajante":"Base*1.3*1.21","neco_final":"Base*1.12*1.21","bahia_final":"Base*1.21",
  "neco_con_iva":"Base*1.12*1.21","neco_sin_iva":"Base*1.12",
  "bahia_con_iva":"Base*1.21","bahia_sin_iva":"Base",
  "neco_presupuesto":"Base*1.12*1.21","bahia_presupuesto":"Base*1.21"
}'::jsonb)
ON CONFLICT DO NOTHING;

-- Control: deben quedar 9 combinaciones (6 previas + 3 nuevas)
SELECT grupo_precio, iva_compras, iva_ventas FROM listas_precio_reglas ORDER BY 1,2,3;
