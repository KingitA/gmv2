-- Migration: habilitar el estado 'en_venta' en pedidos (pedido que el vendedor
-- está armando en vivo desde la tablet; pasa a 'pendiente' al confirmar).
-- El check constraint existente no lo incluía y bloqueaba el INSERT.

ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_estado_check;

ALTER TABLE pedidos ADD CONSTRAINT pedidos_estado_check CHECK (
  (estado)::text = ANY ((ARRAY[
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
