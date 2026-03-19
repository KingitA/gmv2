-- Fix: column articulos.codigo_interno does not exist, use sku instead
DROP FUNCTION IF EXISTS match_articulos;

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
    articulos.sku AS codigo_interno,
    1 - (articulos.embedding <=> query_embedding) AS similarity
  FROM articulos
  WHERE 1 - (articulos.embedding <=> query_embedding) > match_threshold
  ORDER BY articulos.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
