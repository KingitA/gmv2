-- ─────────────────────────────────────────────────────────────────────────────
-- FASE D1 — Rol mostrador
--
-- Operario de mostrador: crea pedidos retira_mostrador, factura y cobra en un
-- solo flujo (/mostrador), registra anticipos de pedidos para retirar y
-- devoluciones de mostrador. NO hace picking ni administra el ERP completo.
-- La autorización de rutas la resuelve lib/role-utils.ts (middleware).
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO roles (nombre, descripcion)
VALUES ('mostrador', 'Operario de mostrador: venta, cobro y devoluciones en mostrador')
ON CONFLICT (nombre) DO NOTHING;
