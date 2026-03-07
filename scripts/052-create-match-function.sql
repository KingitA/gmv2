-- Script 052: Create RPC function for vector matching
-- Author: Antigravity
-- Date: 2025-12-23

CREATE OR REPLACE FUNCTION match_articulos (
  query_embedding vector(1536),
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
