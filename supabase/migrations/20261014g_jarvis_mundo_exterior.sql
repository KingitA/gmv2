-- ═══════════════════════════════════════════════════════════════════════
-- JARVIS · Etapa 5: el mundo exterior (PLAN.md §5 y §10).
--
-- 1. ai_insumos: catálogo de "de qué depende el costo" (plástico, papel,
--    químicos…) y qué indicadores de afuera lo mueven. Se puede ampliar.
-- 2. ai_articulo_insumos: de qué depende cada ARTÍCULO. Lo completa Jarvis
--    (fuente 'ia', con confianza); una persona corrige (fuente 'persona') y lo
--    de una persona NUNCA lo pisa la IA. Cada corrección queda en la bitácora.
-- 3. ai_indicadores_externos: valores de afuera (dólar, inflación, petróleo,
--    resinas…) con fecha, fuente y link. Historia: un valor por indicador y día.
-- 4. jarvis_proveedor_insumos(): perfil de cada proveedor según lo que le
--    compramos/vendemos (ej. "80 % plástico").
--
-- No toca la tabla articulos (que se sincroniza a las apps): todo va aparte.
-- ADITIVA e IDEMPOTENTE.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.ai_insumos (
  insumo       TEXT PRIMARY KEY,          -- 'plastico', 'papel', …
  nombre       TEXT NOT NULL,
  descripcion  TEXT,
  indicadores  TEXT[] NOT NULL DEFAULT '{}', -- claves de ai_indicadores_externos que lo mueven
  activo       BOOLEAN NOT NULL DEFAULT true
);
ALTER TABLE public.ai_insumos ENABLE ROW LEVEL SECURITY;

INSERT INTO public.ai_insumos (insumo, nombre, descripcion, indicadores) VALUES
  ('plastico',  'Plástico',              'Baldes, fuentones, bolsas, envases, escobas plásticas, film. Resinas derivadas del petróleo.', ARRAY['petroleo_brent','resina_polietileno','dolar_oficial']),
  ('papel',     'Papel y celulosa',      'Papel higiénico, rollos de cocina, servilletas, pañuelos, pañales (parte).',                  ARRAY['celulosa','dolar_oficial']),
  ('quimicos',  'Químicos y tensioactivos','Detergentes, lavandina, desodorantes de ambiente, limpiadores, perfumería, shampoo.',       ARRAY['petroleo_brent','dolar_oficial']),
  ('metal',     'Metal (acero / aluminio)','Virulana, lana de acero, papel aluminio, ollas, cubiertos, termos de acero.',              ARRAY['aluminio','acero','dolar_oficial']),
  ('vidrio',    'Vidrio',                'Vasos, frascos, vajilla de vidrio.',                                                           ARRAY['dolar_oficial','inflacion_mensual']),
  ('textil',    'Textil (algodón)',      'Trapos, rejillas, toallas, repasadores, guantes de tela.',                                     ARRAY['algodon','dolar_oficial']),
  ('madera',    'Madera',                'Escobas y secadores con cabo de madera, broches, palillos, fósforos.',                        ARRAY['inflacion_mensual']),
  ('importado', 'Importado terminado',   'Producto que viene hecho de afuera (China, Brasil…): depende sobre todo del dólar.',          ARRAY['dolar_oficial','dolar_blue']),
  ('mixto',     'Mixto / local',         'Sin una materia prima dominante: sigue costos locales.',                                     ARRAY['inflacion_mensual','dolar_oficial'])
ON CONFLICT (insumo) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ai_articulo_insumos (
  articulo_id    UUID PRIMARY KEY REFERENCES public.articulos(id) ON DELETE CASCADE,
  insumo         TEXT NOT NULL REFERENCES public.ai_insumos(insumo),
  confianza      NUMERIC NOT NULL DEFAULT 0,   -- 0 a 1 (la de una persona = 1)
  fuente         TEXT NOT NULL DEFAULT 'ia' CHECK (fuente IN ('ia', 'persona')),
  motivo         TEXT,                         -- por qué (lo explica Jarvis)
  modelo         TEXT,                         -- qué IA lo clasificó
  revisado_por   UUID,                         -- persona que lo confirmó / corrigió
  revisado_at    TIMESTAMPTZ,
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_articulo_insumos_insumo ON public.ai_articulo_insumos (insumo);
CREATE INDEX IF NOT EXISTS idx_ai_articulo_insumos_dudas ON public.ai_articulo_insumos (confianza) WHERE fuente = 'ia';
ALTER TABLE public.ai_articulo_insumos ENABLE ROW LEVEL SECURITY;

-- Corrección de una persona → bitácora inborrable
CREATE OR REPLACE FUNCTION public.ai_articulo_insumos_registrar() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.fuente = 'persona' AND (TG_OP = 'INSERT' OR OLD.fuente IS DISTINCT FROM 'persona' OR OLD.insumo IS DISTINCT FROM NEW.insumo) THEN
    INSERT INTO ai_registro (usuario_id, accion, entidad_tipo, entidad_id, detalle)
    VALUES (NEW.revisado_por, 'insumo_revisado', 'articulo', NEW.articulo_id::text,
            jsonb_build_object('titulo', (SELECT descripcion FROM articulos WHERE id = NEW.articulo_id),
                               'de', CASE WHEN TG_OP = 'UPDATE' THEN OLD.insumo END, 'a', NEW.insumo,
                               'nota', CASE WHEN TG_OP = 'UPDATE' AND OLD.insumo = NEW.insumo THEN 'Confirmó lo que propuso Jarvis' ELSE 'Corrigió a ' || NEW.insumo END));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ai_articulo_insumos_registrar ON public.ai_articulo_insumos;
CREATE TRIGGER trg_ai_articulo_insumos_registrar
  AFTER INSERT OR UPDATE ON public.ai_articulo_insumos
  FOR EACH ROW EXECUTE FUNCTION public.ai_articulo_insumos_registrar();

CREATE TABLE IF NOT EXISTS public.ai_indicadores_externos (
  id            BIGSERIAL PRIMARY KEY,
  indicador     TEXT NOT NULL,          -- 'dolar_oficial', 'petroleo_brent', …
  fecha         DATE NOT NULL,          -- a qué día corresponde el valor
  valor         NUMERIC NOT NULL,
  unidad        TEXT,                   -- 'ARS por USD', 'USD por barril', '% mensual'…
  fuente        TEXT,                   -- nombre de la fuente
  fuente_url    TEXT,
  obtenido_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  obtenido_por  TEXT NOT NULL DEFAULT 'api', -- 'api' (fuente pública fija) | 'ia' (búsqueda web)
  UNIQUE (indicador, fecha)
);
CREATE INDEX IF NOT EXISTS idx_ai_indicadores_fecha ON public.ai_indicadores_externos (indicador, fecha DESC);
ALTER TABLE public.ai_indicadores_externos ENABLE ROW LEVEL SECURITY;

-- Perfil de insumos de cada proveedor: qué parte de lo que le vendemos (90 días)
-- depende de cada insumo. Si no hay ventas, cuenta artículos.
CREATE OR REPLACE FUNCTION public.jarvis_proveedor_insumos(p_proveedor_id uuid DEFAULT NULL)
RETURNS TABLE(proveedor_id uuid, proveedor text, insumo text, articulos bigint, articulos_clasificados bigint,
              venta_90d numeric, participacion_pct numeric)
LANGUAGE sql STABLE AS $$
  WITH arts AS (
    SELECT a.id, a.proveedor_id, ai.insumo
    FROM articulos a
    LEFT JOIN ai_articulo_insumos ai ON ai.articulo_id = a.id
    WHERE a.activo IS NOT FALSE AND a.proveedor_id IS NOT NULL
      AND (p_proveedor_id IS NULL OR a.proveedor_id = p_proveedor_id)
  ), venta AS (
    SELECT k.articulo_id, SUM(COALESCE(k.subtotal_neto, k.subtotal_total, 0)) AS neto
    FROM kardex k
    WHERE k.tipo_movimiento = 'venta' AND COALESCE(k.pedido_eliminado, false) = false
      AND k.fecha >= ((public.hoy_ar() - 90)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')
    GROUP BY k.articulo_id
  ), por AS (
    SELECT a.proveedor_id, COALESCE(a.insumo, 'sin_clasificar') AS insumo,
      COUNT(*) AS n, COUNT(a.insumo) AS n_clas, COALESCE(SUM(v.neto), 0) AS neto
    FROM arts a LEFT JOIN venta v ON v.articulo_id = a.id
    GROUP BY 1, 2
  ), tot AS (
    SELECT proveedor_id, SUM(neto) AS neto, SUM(n) AS n FROM por GROUP BY 1
  )
  SELECT p.proveedor_id, pr.nombre::text, p.insumo, p.n, p.n_clas, ROUND(p.neto, 2),
    ROUND(100 * CASE WHEN t.neto > 0 THEN p.neto / t.neto ELSE p.n::numeric / NULLIF(t.n, 0) END, 1)
  FROM por p JOIN tot t ON t.proveedor_id = p.proveedor_id
  JOIN proveedores pr ON pr.id = p.proveedor_id
  ORDER BY pr.nombre, 7 DESC
$$;
GRANT EXECUTE ON FUNCTION public.jarvis_proveedor_insumos(uuid) TO service_role;

-- Reglas nuevas (compra anticipada)
INSERT INTO public.ai_ajustes (clave, valor, descripcion) VALUES
  ('regla_suba_insumo_pct',      '10', 'Suba de un indicador de afuera (en 30 días) que hace pensar que un proveedor va a aumentar.'),
  ('regla_dias_sin_aumento',     '45', 'Días sin aumento cargado para considerar que un proveedor "todavía no aumentó".'),
  ('regla_participacion_insumo', '50', 'Qué parte de lo que le vendemos a un proveedor tiene que depender del insumo (%) para avisar.')
ON CONFLICT (clave) DO NOTHING;
