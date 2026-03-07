-- Drop the old function first if signature change causes issues (though OR REPLACE handles it if types match, here they differ)
DROP FUNCTION IF EXISTS match_articulos;

-- Recreate with 768 dimensions for Gemini
CREATE OR REPLACE FUNCTION match_articulos (
  query_embedding vector(768),
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id uuid,
  descripcion text,
  codigo_interno text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    articulos.id,
    articulos.descripcion,
    articulos.codigo_interno,
    1 - (articulos.embedding <=> query_embedding) AS similarity
  FROM articulos
  WHERE 1 - (articulos.embedding <=> query_embedding) > match_threshold
  ORDER BY articulos.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
