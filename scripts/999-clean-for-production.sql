-- ============================================================
-- SCRIPT DE LIMPIEZA PARA PRODUCCIÓN — GM ERP v2
-- COMPAÑIA DE HIGIENE TOTAL S.R.L. — CUIT 30-71022924-0
-- ============================================================
-- EJECUTAR UNA SOLA VEZ en el editor SQL de Supabase
-- (Dashboard → SQL Editor → New query → pegar → Run)
--
-- QUÉ HACE:
--   • Elimina todos los datos transaccionales de prueba
--   • Resetea stock a 0 en todos los artículos
--   • Resetea numeración de comprobantes a 0
--   • Elimina tipos de comprobante inválidos (FC, NCC, NDC)
--
-- QUÉ NO TOCA:
--   • clientes, artículos (estructura y precios), proveedores
--   • marcas, rubros, categorías, subcategorías
--   • vendedores, usuarios, roles, perfiles
--   • configuracion_empresa, listas_precio, listas_precio_reglas
--   • transportes, zonas, localidades
--   • historial de emails AI (ai_emails, ai_classifications)
--   • google_tokens (OAuth)
-- ============================================================

BEGIN;

-- ── 1. Picking / depósito ─────────────────────────────────
DELETE FROM picking_items;
DELETE FROM picking_sesiones;
DELETE FROM deposito_movimientos_detalle;
DELETE FROM deposito_movimientos;
DELETE FROM deposito_ajustes_stock;

-- ── 2. Cola de importaciones AI ──────────────────────────
DELETE FROM import_items;
DELETE FROM imports;

-- ── 3. Comisiones ────────────────────────────────────────
DELETE FROM comisiones;

-- ── 4. Kardex (operativo y contable) ─────────────────────
DELETE FROM kardex;
DELETE FROM kardex_contable;

-- ── 5. Movimientos de stock ───────────────────────────────
DELETE FROM movimientos_stock;

-- ── 6. Devoluciones ──────────────────────────────────────
DELETE FROM devoluciones_detalle;
DELETE FROM devoluciones;

-- ── 7. Comprobantes de venta ──────────────────────────────
DELETE FROM comprobantes_venta_detalle;
DELETE FROM comprobantes_venta;

-- ── 8. Remitos y recibos ─────────────────────────────────
DELETE FROM remitos_detalle;
DELETE FROM remitos;
DELETE FROM recibos;

-- ── 9. Pagos clientes ─────────────────────────────────────
DELETE FROM pagos_detalle;
DELETE FROM pagos_clientes;

-- ── 10. Viajes ────────────────────────────────────────────
DELETE FROM viajes_pagos;
DELETE FROM viajes_clientes;
DELETE FROM viajes;

-- ── 11. Cuenta corriente ──────────────────────────────────
DELETE FROM cuenta_corriente_ajustes;
DELETE FROM cuenta_corriente_clientes;

-- ── 12. Pedidos ───────────────────────────────────────────
DELETE FROM pedidos_detalle;
DELETE FROM pedidos;

-- ── 13. Comprobantes de compra y recepciones ──────────────
DELETE FROM recepciones_items;
DELETE FROM recepciones;
DELETE FROM comprobantes_compra_detalle;
DELETE FROM comprobantes_compra;

-- ── 14. Órdenes de compra ─────────────────────────────────
DELETE FROM ordenes_compra_detalle;
DELETE FROM ordenes_compra;

-- ── 15. Imputaciones ──────────────────────────────────────
-- (imputaciones_clientes eliminada por 20260901_aging_v2_drop_imputaciones_clientes)
DELETE FROM imputaciones;

-- ── 16. Vencimientos ──────────────────────────────────────
DELETE FROM vencimientos;

-- ── 17. Cheques ───────────────────────────────────────────
DELETE FROM cheques;

-- ── 18. Finanzas ──────────────────────────────────────────
DELETE FROM billetera_movimientos;
DELETE FROM finanzas_saldos;

-- ── 19. Pagos proveedores ─────────────────────────────────
DELETE FROM pagos_proveedores_items;
DELETE FROM pagos_proveedores_sugeridos;
DELETE FROM pagos_proveedores;

-- ── 20. Reset stock a 0 ───────────────────────────────────
-- IMPORTANTE: después de correr este script, ingresar el
-- stock real desde Depósito → Ajuste de stock.
UPDATE articulos SET stock_actual = 0;

-- ── 21. Reset numeración de comprobantes ──────────────────
UPDATE numeracion_comprobantes SET ultimo_numero = 0;

-- ── 22. Eliminar tipos inválidos para Responsable Inscripto
-- FC = Factura C (la emiten monotributistas como EMISORES, no RI)
-- NCC / NDC = NC y ND del tipo C (mismo motivo)
DELETE FROM numeracion_comprobantes
WHERE tipo_comprobante IN ('FC', 'NCC', 'NDC');

-- ── 23. Verificación final ────────────────────────────────
-- Estas consultas deben devolver 0 en todas las filas de "count"
SELECT 'comprobantes_venta'   AS tabla, COUNT(*) FROM comprobantes_venta   UNION ALL
SELECT 'pedidos',                        COUNT(*) FROM pedidos              UNION ALL
SELECT 'kardex',                         COUNT(*) FROM kardex               UNION ALL
SELECT 'movimientos_stock',              COUNT(*) FROM movimientos_stock    UNION ALL
SELECT 'comisiones',                     COUNT(*) FROM comisiones           UNION ALL
SELECT 'vencimientos',                   COUNT(*) FROM vencimientos         UNION ALL
SELECT 'imports',                        COUNT(*) FROM imports;

-- Numeración: debe mostrar 0 para todos
SELECT tipo_comprobante, punto_venta, ultimo_numero
FROM numeracion_comprobantes
ORDER BY punto_venta, tipo_comprobante;

COMMIT;
