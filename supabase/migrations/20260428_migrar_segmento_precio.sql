-- Migración: poblar segmento_precio desde rubro_id (relacional) o rubro (texto legacy)
--
-- Reglas:
--   slug 'perfumeria'             → segmento_precio = 'perfumeria'
--   slug 'limpieza' o 'bazar'     → segmento_precio = 'limpieza_bazar'
--   rubro texto 'PERFUMERIA/Perf' → segmento_precio = 'perfumeria'  (fallback)
--   cualquier otro rubro texto    → segmento_precio = 'limpieza_bazar' (fallback)
--
-- Solo actualiza artículos que tengan segmento_precio = NULL (no sobreescribe overrides manuales).

UPDATE articulos a
SET segmento_precio = CASE
  WHEN r.slug = 'perfumeria'            THEN 'perfumeria'
  WHEN r.slug IN ('limpieza', 'bazar')  THEN 'limpieza_bazar'
  ELSE NULL
END
FROM rubros r
WHERE a.rubro_id = r.id
  AND a.segmento_precio IS NULL;

-- Fallback: artículos sin rubro_id pero con campo texto rubro o categoria
UPDATE articulos
SET segmento_precio = CASE
  WHEN UPPER(COALESCE(rubro, categoria, '')) LIKE '%PERFUMERIA%'
    OR UPPER(COALESCE(rubro, categoria, '')) LIKE '%PERFUMERÍA%'  THEN 'perfumeria'
  ELSE 'limpieza_bazar'
END
WHERE rubro_id IS NULL
  AND segmento_precio IS NULL
  AND activo = true;
