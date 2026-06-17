-- Asegura que el libro mayor y su vista de saldo sean legibles por los roles de
-- la app (browser anon/authenticated y server service_role). Idempotente.
GRANT SELECT ON public.v_saldo_clientes         TO anon, authenticated, service_role;
GRANT SELECT ON public.cuenta_corriente_clientes TO anon, authenticated, service_role;
