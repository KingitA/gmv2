-- ─────────────────────────────────────────────────────────────────────────────
-- FASE A Compras: matching factura↔OC con aprendizaje (28/07/2026)
--
-- 1. comprobantes_compra_detalle guarda TODAS las líneas del OCR, incluso las
--    no matcheadas, con la sugerencia y su score para corrección manual.
-- 2. recepciones_items.fuera_de_oc: ítems facturados que no estaban en la OC.
-- 3. RPC compras_aprender_equivalencia: único punto de escritura de
--    equivalencias artículo↔proveedor. Sincroniza articulos_proveedores
--    (tabla canónica del matcher) y articulos_alias (índice de búsqueda;
--    su trigger de 20260725 refresca articulos.search_text solo).
-- 4. Backfill bidireccional entre ambas tablas de equivalencia.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Sugerencias persistidas en el detalle del comprobante
ALTER TABLE comprobantes_compra_detalle
  ADD COLUMN IF NOT EXISTS articulo_sugerido_id uuid REFERENCES articulos(id),
  ADD COLUMN IF NOT EXISTS match_score numeric,
  ADD COLUMN IF NOT EXISTS match_estado varchar DEFAULT 'sin_match',
  ADD COLUMN IF NOT EXISTS recepcion_item_id uuid REFERENCES recepciones_items(id) ON DELETE SET NULL;

COMMENT ON COLUMN comprobantes_compra_detalle.match_estado IS
  'auto: matcheado automático | sugerido: score 0.75-0.93, requiere confirmación | manual: confirmado por usuario | sin_match: sin candidato';

CREATE INDEX IF NOT EXISTS idx_ccd_comprobante_match
  ON comprobantes_compra_detalle (comprobante_id, match_estado);

-- 2. Ítems facturados fuera de la OC
ALTER TABLE recepciones_items
  ADD COLUMN IF NOT EXISTS fuera_de_oc boolean DEFAULT false;

-- 3. RPC de aprendizaje de equivalencias
CREATE OR REPLACE FUNCTION compras_aprender_equivalencia(
  p_articulo_id uuid,
  p_proveedor_id uuid,
  p_codigo_proveedor text DEFAULT NULL,
  p_descripcion text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_codigo text := NULLIF(btrim(COALESCE(p_codigo_proveedor, '')), '');
  v_norm   text := NULLIF(norm_search(COALESCE(p_descripcion, '')), '');
  v_ap_id  uuid;
BEGIN
  IF p_articulo_id IS NULL OR p_proveedor_id IS NULL THEN
    RAISE EXCEPTION 'compras_aprender_equivalencia: articulo_id y proveedor_id son requeridos';
  END IF;

  -- Re-aprendizaje: si el código del proveedor mapeaba a OTRO artículo, ese
  -- mapeo era incorrecto — se elimina para que el upsert no viole unicidad.
  IF v_codigo IS NOT NULL THEN
    DELETE FROM articulos_proveedores
     WHERE proveedor_id = p_proveedor_id
       AND codigo_proveedor = v_codigo
       AND articulo_id <> p_articulo_id;
  END IF;

  INSERT INTO articulos_proveedores (
    proveedor_id, articulo_id, codigo_proveedor,
    descripcion_proveedor, descripcion_proveedor_norm,
    confianza, veces_usado, last_used_at, updated_at
  ) VALUES (
    p_proveedor_id, p_articulo_id, v_codigo,
    p_descripcion, v_norm,
    'manual', 1, now(), now()
  )
  ON CONFLICT (proveedor_id, articulo_id) DO UPDATE SET
    codigo_proveedor           = COALESCE(EXCLUDED.codigo_proveedor, articulos_proveedores.codigo_proveedor),
    descripcion_proveedor      = COALESCE(EXCLUDED.descripcion_proveedor, articulos_proveedores.descripcion_proveedor),
    descripcion_proveedor_norm = COALESCE(EXCLUDED.descripcion_proveedor_norm, articulos_proveedores.descripcion_proveedor_norm),
    confianza                  = 'manual',
    veces_usado                = COALESCE(articulos_proveedores.veces_usado, 0) + 1,
    last_used_at               = now(),
    updated_at                 = now()
  RETURNING id INTO v_ap_id;

  -- Alias de búsqueda: el trigger trg_articulos_alias_refresh (20260725)
  -- refresca articulos.search_text automáticamente.
  IF p_descripcion IS NOT NULL THEN
    INSERT INTO articulos_alias (
      articulo_id, proveedor_id, codigo_proveedor, descripcion_proveedor, confianza, veces_usado
    ) VALUES (
      p_articulo_id, p_proveedor_id, v_codigo, p_descripcion, 'manual', 1
    )
    ON CONFLICT (articulo_id, proveedor_id, descripcion_proveedor) DO UPDATE SET
      codigo_proveedor = COALESCE(EXCLUDED.codigo_proveedor, articulos_alias.codigo_proveedor),
      veces_usado      = COALESCE(articulos_alias.veces_usado, 0) + 1,
      updated_at       = now();
  END IF;

  RETURN jsonb_build_object('ok', true, 'articulo_proveedor_id', v_ap_id);
END;
$$;

GRANT EXECUTE ON FUNCTION compras_aprender_equivalencia(uuid, uuid, text, text) TO authenticated, service_role;

-- 4. Backfill bidireccional (alias→proveedores y proveedores→alias)
INSERT INTO articulos_proveedores (
  proveedor_id, articulo_id, codigo_proveedor,
  descripcion_proveedor, descripcion_proveedor_norm, confianza
)
SELECT al.proveedor_id, al.articulo_id, al.codigo_proveedor,
       al.descripcion_proveedor, norm_search(al.descripcion_proveedor), 'backfill'
FROM articulos_alias al
WHERE al.proveedor_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO articulos_alias (
  articulo_id, proveedor_id, codigo_proveedor, descripcion_proveedor, confianza
)
SELECT ap.articulo_id, ap.proveedor_id, ap.codigo_proveedor, ap.descripcion_proveedor, 'backfill'
FROM articulos_proveedores ap
WHERE ap.descripcion_proveedor IS NOT NULL
ON CONFLICT DO NOTHING;

-- Control
SELECT
  (SELECT count(*) FROM articulos_proveedores) AS equivalencias_matcher,
  (SELECT count(*) FROM articulos_alias)       AS aliases_busqueda;
