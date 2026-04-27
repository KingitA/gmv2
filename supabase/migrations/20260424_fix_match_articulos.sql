-- Recrear match_articulos para evitar referencias a columnas inexistentes.
-- Devuelve solo (id, similarity); el código ya maneja el fetch de datos completos.
DROP FUNCTION IF EXISTS match_articulos(vector, double precision, integer);

CREATE FUNCTION match_articulos(
    query_embedding vector(768),
    match_threshold float DEFAULT 0.35,
    match_count int DEFAULT 20
)
RETURNS TABLE (id uuid, similarity float)
LANGUAGE sql STABLE
AS $$
    SELECT a.id, (1 - (a.embedding <=> query_embedding))::float AS similarity
    FROM articulos a
    WHERE a.embedding IS NOT NULL
      AND 1 - (a.embedding <=> query_embedding) > match_threshold
    ORDER BY similarity DESC
    LIMIT match_count;
$$;
