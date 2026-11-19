-- ════════════════════════════════════════════════════════════════════════════════════════
-- Cerrar el acceso ANÓNIMO a la base (revisión antes de producción, 19/11/2026)
-- ════════════════════════════════════════════════════════════════════════════════════════
-- Problema: la clave pública de Supabase (NEXT_PUBLIC_SUPABASE_ANON_KEY) viaja en el JavaScript
-- de gmv2.vercel.app. Con ella, SIN iniciar sesión, se podía leer y modificar 152 tablas
-- (123 sin RLS: proveedores, vencimientos, órdenes de pago, cheques, google_tokens, usuarios…)
-- y ejecutar 157 funciones propias (caja_egreso, cobranza_anular, kardex_registrar…).
--
-- Arreglo: el rol `anon` (quien no inició sesión) no puede tocar NADA del esquema public.
--   · Quien inició sesión (rol `authenticated`) sigue igual: esta migración no lo toca,
--     salvo vencimientos_mantener, que solo la llama el servidor.
--   · El servidor usa la clave de servicio (service_role): sigue igual.
--   · Revisado en el código (19/11): el login, el login de las apps, los webhooks de Gmail y
--     los cron usan el cliente de servicio o ya tienen sesión. El único que usaba la clave
--     pública sin sesión era /api/cron/purge-deleted-orders y se pasó al cliente de servicio
--     en el mismo cambio (desplegarlo ANTES de correr esto, o ese cron deja de borrar).
--
-- Idempotente: se puede correr más de una vez.
-- Para volver atrás (no debería hacer falta): GRANT ALL ON ALL TABLES IN SCHEMA public TO anon; etc.
-- ════════════════════════════════════════════════════════════════════════════════════════

-- 1. Tablas, vistas y secuencias
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- 2. Funciones propias (no las de extensiones como pg_trgm o vector, que no mueven datos).
--    Se saca a anon y a PUBLIC (anon hereda de PUBLIC). Si `authenticated` podía ejecutarla
--    antes, se le vuelve a dar explícitamente: para quien inició sesión no cambia nada.
DO $$
DECLARE
  f record;
  auth_podia boolean;
  srv_podia boolean;
  n int := 0;
BEGIN
  FOR f IN
    SELECT p.oid, p.oid::regprocedure AS firma
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.prokind IN ('f', 'p')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
       AND has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    auth_podia := has_function_privilege('authenticated', f.oid, 'EXECUTE');
    srv_podia  := has_function_privilege('service_role', f.oid, 'EXECUTE');
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.firma);
    IF auth_podia THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.firma); END IF;
    IF srv_podia  THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.firma); END IF;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'Funciones cerradas para anon: %', n;
END $$;

-- 3. Solo la llama el servidor (app/api/vencimientos, con el cliente de servicio): con sesión
--    tampoco. Un usuario logueado podía generar vencimientos recurrentes a 100 años.
REVOKE EXECUTE ON FUNCTION public.vencimientos_mantener(integer) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.vencimientos_mantener(integer) TO service_role;

-- 4. Lo que se cree de acá en adelante (migraciones corridas como postgres) nace cerrado para anon
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL     ON TABLES    FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL     ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT  EXECUTE ON FUNCTIONS TO authenticated, service_role;

-- 5. Control (tiene que dar 0 y 0)
SELECT
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','S','p')
      AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('anon', c.oid, 'UPDATE'))) AS tablas_abiertas_a_anon,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind IN ('f','p')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
      AND has_function_privilege('anon', p.oid, 'EXECUTE')) AS funciones_abiertas_a_anon;
