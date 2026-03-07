-- Enable the pgvector extension to work with embedding vectors
create extension if not exists vector;

-- Add embedding column to articulos table
-- Using 3072 dimensions for models/gemini-embedding-001
alter table articulos 
drop column if exists embedding; -- Drop if exists to avoid conflict when changing dimensions

alter table articulos 
add column if not exists embedding vector(3072);

-- Create an index for faster similarity search
-- LIMITATION: pgvector index supports up to 2000 dimensions.
-- Since we are using 3072 dims for better quality, we skip the index creation for now.
-- For < 100k items, sequential scan is fast enough.
-- create index if not exists articulos_embedding_idx on articulos using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Create a function to search for articulos by similarity
create or replace function match_documents (
  query_embedding vector(3072),
  match_threshold float,
  match_count int
)
returns table (
  id uuid,
  nombre text, -- mapped from descripcion or nombre
  descripcion text,
  sku text,
  precio_base numeric, -- mapped from precio_compra or precio_base
  stock_actual numeric,
  unidad_medida text,
  activo boolean,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    articulos.id,
    articulos.descripcion::text as nombre, -- cast to text
    articulos.descripcion::text, -- cast to text
    articulos.sku::text, -- cast to text
    articulos.precio_compra as precio_base,
    articulos.stock_actual,
    'unidad'::text as unidad_medida,
    articulos.activo,
    1 - (articulos.embedding <=> query_embedding) as similarity
  from articulos
  where 1 - (articulos.embedding <=> query_embedding) > match_threshold
  and articulos.activo = true
  order by articulos.embedding <=> query_embedding
  limit match_count;
end;
$$;
