-- Script 051: Schema for Intelligent Matching System
-- Author: Antigravity
-- Date: 2025-12-23
-- Purpose: Enable vector search and create generic import pipeline tables.

-- 1. Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Add embedding column to articulos (Master SKU table)
ALTER TABLE articulos
ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Create index for vector search (HNSW for better performance/recall)
-- Note: This might take time on large datasets.
CREATE INDEX IF NOT EXISTS idx_articulos_embedding 
ON articulos USING hnsw (embedding vector_cosine_ops);

-- 3. Create 'imports' table (Header for any import process)
CREATE TABLE IF NOT EXISTS imports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(50) NOT NULL, -- 'price_list', 'invoice', 'purchase_order', 'reception'
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
    meta JSONB DEFAULT '{}'::jsonb, -- Flexible metadata: filename, provider_id, etc.
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id)
);

-- RLS for imports
ALTER TABLE imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own imports or public ones" ON imports
    FOR SELECT USING (true); -- Adjust this based on actual multi-tenant requirement, currently 'true' for internal tool usage.

CREATE POLICY "Users can insert imports" ON imports
    FOR INSERT WITH CHECK (auth.uid() = created_by);
    
CREATE POLICY "Users can update imports" ON imports
    FOR UPDATE USING (true); -- Simplified for now.

-- 4. Create 'import_items' table (Staging area for lines)
CREATE TABLE IF NOT EXISTS import_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    import_id UUID NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
    
    -- Raw content
    raw_data JSONB NOT NULL, -- Store everything: description, code, prices, etc.
    
    -- Status pipeline
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'matched', 'approved', 'rejected'
    
    -- Matching Candidates (The "Link")
    candidate_sku_id UUID REFERENCES articulos(id),
    match_confidence NUMERIC(4,3), -- 0.000 to 1.000
    match_method VARCHAR(50), -- 'exact_code', 'exact_ean', 'exact_name', 'vector', 'manual'
    match_details JSONB, -- Explain why: { score: 0.88, signals: ['brand_match'] }
    
    -- Auditing
    reviewed_by UUID REFERENCES auth.users(id),
    reviewed_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_import_items_import_id ON import_items(import_id);
CREATE INDEX IF NOT EXISTS idx_import_items_status ON import_items(status);
CREATE INDEX IF NOT EXISTS idx_import_items_candidate ON import_items(candidate_sku_id);

-- RLS for import_items
ALTER TABLE import_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view import items" ON import_items
    FOR SELECT USING (true);

CREATE POLICY "Users can manage import items" ON import_items
    FOR ALL USING (true); -- Simplified for internal tool usage.

-- 5. Trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_imports_modtime
    BEFORE UPDATE ON imports
    FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_import_items_modtime
    BEFORE UPDATE ON import_items
    FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();

-- 6. Add Reference to generic 'articulos_proveedores' enhancements if missed
-- (Just validating that scripts 039/040/043 ran is manual, but we assume existing schema is ready per audit)

COMMENT ON TABLE imports IS 'Header for bulk data ingestion (Invoices, Price Lists)';
COMMENT ON TABLE import_items IS 'Staging lines needing matching/validation before entering core tables';
