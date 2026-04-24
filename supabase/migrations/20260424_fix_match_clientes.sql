-- Recrear match_clientes para evitar mismatch de tipos (varchar vs text).
-- La función devuelve solo (id, similarity); el código fetcha los datos completos por ID.
CREATE OR REPLACE FUNCTION match_clientes(
    query_embedding vector(768),
    match_threshold float DEFAULT 0.35,
    match_count int DEFAULT 10
)
RETURNS TABLE (id uuid, similarity float)
LANGUAGE sql STABLE
AS $$
    SELECT c.id, (1 - (c.embedding <=> query_embedding))::float AS similarity
    FROM clientes c
    WHERE c.embedding IS NOT NULL
      AND 1 - (c.embedding <=> query_embedding) > match_threshold
    ORDER BY similarity DESC
    LIMIT match_count;
$$;
