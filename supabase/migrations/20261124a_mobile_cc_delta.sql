-- SYNC vendedor_cc POR CAMBIOS (lentitud del 24/11/2026)
--
-- La cuenta corriente de la app Vendedor (dataset vendedor_cc) se recalculaba ENTERA
-- cada 15 minutos por equipo: ficha + comprados + habituales + extracto + contexto de
-- devolución de TODOS los clientes de la cartera (hasta 84, ~5 consultas c/u). Con
-- varios vendedores en la calle eso saturaba el pooler (24/11 10:00 y 17/11).
--
-- Desde ahora cada escritura que mueve la cuenta de un cliente deja una marca en
-- mobile_cambios con tabla = 'cc_cliente' y ref_id = el cliente. La sync solo
-- recalcula esos clientes (y una vez por día la cartera entera, por las dudas).
--
-- Tablas: cuenta_corriente_clientes, comprobantes_venta, pagos_clientes, devoluciones,
-- pedidos (por cliente_id) y clientes (por id). Trigger propio (trg_mobile_cc) para no
-- pisar los trg_mobile_cambios que ya existen en pedidos, clientes y devoluciones.
--
-- NO APLICADA. Idempotente. Sin la migración la app sigue igual que hoy (snapshot):
-- el dataset exige entradas 'cc_cliente' en el log para usar el modo por cambios.

-- ── 1. Función: marca el cliente afectado ───────────────────────────────────
-- TG_ARGV[0] = columna del cliente ('cliente_id' o 'id'). Igual que
-- mobile_registrar_cambio: nunca rompe la escritura del ERP.
CREATE OR REPLACE FUNCTION public.mobile_registrar_cambio_cc() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ref_col TEXT := COALESCE(TG_ARGV[0], 'cliente_id');
  n JSONB := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  o JSONB := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
BEGIN
  IF TG_OP = 'UPDATE' AND n = o THEN RETURN NULL; END IF;
  BEGIN
    IF COALESCE(n, o)->>ref_col IS NOT NULL THEN
      INSERT INTO public.mobile_cambios (tabla, registro_id, ref_id, op)
      VALUES ('cc_cliente', COALESCE(n, o)->>'id', COALESCE(n, o)->>ref_col, left(TG_OP, 1));
    END IF;
    -- Movimiento pasado a otro cliente: el viejo también se recalcula
    IF TG_OP = 'UPDATE' AND (o->>ref_col) IS NOT NULL AND (o->>ref_col) IS DISTINCT FROM (n->>ref_col) THEN
      INSERT INTO public.mobile_cambios (tabla, registro_id, ref_id, op)
      VALUES ('cc_cliente', o->>'id', o->>ref_col, 'U');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'mobile_registrar_cambio_cc(%): %', TG_TABLE_NAME, SQLERRM;
  END;
  RETURN NULL;
END $$;

-- ── 2. Triggers ─────────────────────────────────────────────────────────────
DO $$
DECLARE t RECORD;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('cuenta_corriente_clientes', 'cliente_id'),
    ('comprobantes_venta',        'cliente_id'),
    ('pagos_clientes',            'cliente_id'),
    ('devoluciones',              'cliente_id'),
    ('pedidos',                   'cliente_id'),
    ('clientes',                  'id')
  ) AS v(tabla, ref)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_mobile_cc ON public.%I', t.tabla);
    EXECUTE format('CREATE TRIGGER trg_mobile_cc AFTER INSERT OR UPDATE OR DELETE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION public.mobile_registrar_cambio_cc(%L)', t.tabla, t.ref);
  END LOOP;
END $$;

-- ── 3. Marca inicial: sin ella la app no sabe que el log ya funciona ─────────
-- (una sola fila; el próximo snapshot de cada equipo deja el cursor al día)
INSERT INTO public.mobile_cambios (tabla, registro_id, ref_id, op)
SELECT 'cc_cliente', 'inicio', NULL, 'U'
WHERE NOT EXISTS (SELECT 1 FROM public.mobile_cambios WHERE tabla = 'cc_cliente');

-- ── Verificación: 6 filas ────────────────────────────────────────────────────
SELECT c.relname AS tabla, t.tgname
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
WHERE t.tgname = 'trg_mobile_cc' ORDER BY 1;
