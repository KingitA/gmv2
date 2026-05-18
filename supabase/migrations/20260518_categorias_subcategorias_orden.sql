-- Agrega columna orden a rubros, categorias y subcategorias
-- para permitir ordenamiento drag&drop en /tablas/categorias
-- y aplicarlo en comprobantes (presupuestos y facturas)

ALTER TABLE rubros        ADD COLUMN IF NOT EXISTS orden integer DEFAULT 999;
ALTER TABLE categorias    ADD COLUMN IF NOT EXISTS orden integer DEFAULT 999;
ALTER TABLE subcategorias ADD COLUMN IF NOT EXISTS orden integer DEFAULT 999;

-- Orden fijo de rubros: Limpieza → Bazar → Perfumería
UPDATE rubros SET orden = 1 WHERE slug = 'limpieza';
UPDATE rubros SET orden = 2 WHERE slug = 'bazar';
UPDATE rubros SET orden = 3 WHERE slug = 'perfumeria';

-- Orden inicial de categorias: alfabético dentro de cada rubro
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY rubro_id ORDER BY nombre) AS rn
  FROM categorias
)
UPDATE categorias c SET orden = r.rn FROM ranked r WHERE c.id = r.id;

-- Orden inicial de subcategorias: alfabético dentro de cada categoria
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY categoria_id ORDER BY nombre) AS rn
  FROM subcategorias
)
UPDATE subcategorias s SET orden = r.rn FROM ranked r WHERE s.id = r.id;
