-- Migration: estado 'en_revision' en pedidos (09/10/2026).
-- Primer pedido de un cliente tomado desde la app del vendedor (en general un
-- cliente dado de alta en la calle, con o sin señal): queda RETENIDO para que la
-- oficina revise cliente y pedido. Depósito no lo ve (no está entre los estados
-- preparables) hasta que la oficina lo pasa a 'pendiente' con el cambio de estado
-- de siempre (/clientes-pedidos). Ver lib/pedidos/estados.ts y MOBILE.md §18.
--
-- Mismo check que 20260707_pedidos_estado_en_venta.sql + 'en_revision'.
-- Idempotente: se puede correr más de una vez.

ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_estado_check;

ALTER TABLE pedidos ADD CONSTRAINT pedidos_estado_check CHECK (
  (estado)::text = ANY ((ARRAY[
    'en_revision'::character varying,
    'en_venta'::character varying,
    'pendiente'::character varying,
    'en_preparacion'::character varying,
    'impreso'::character varying,
    'pendiente_facturacion'::character varying,
    'facturado'::character varying,
    'listo_para_retirar'::character varying,
    'listo_para_enviar'::character varying,
    'en_viaje'::character varying,
    'entregado'::character varying,
    'rechazado'::character varying,
    'eliminado'::character varying
  ])::text[])
);
