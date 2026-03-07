-- Switch embedding dimension from 1536 (OpenAI) to 768 (Gemini)
BEGIN;

-- 1. Drop the existing index (depends on the column type)
DROP INDEX IF EXISTS idx_articulos_embedding;

-- 2. Alter the column type
-- This truncates existing data because dimensions don't match. 
-- We are backfilling anyway, so it's fine to clear them.
UPDATE articulos SET embedding = NULL;
ALTER TABLE articulos ALTER COLUMN embedding TYPE vector(768);

-- 3. Re-create the index
CREATE INDEX idx_articulos_embedding 
ON articulos 
USING hnsw (embedding vector_cosine_ops);

COMMIT;
