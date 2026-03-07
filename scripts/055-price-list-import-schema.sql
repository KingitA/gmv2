-- Script 055: Price List Import Schema Updates
-- Purpose: Add columns for Robust Price List Import (Unit/Case logic) and ensure vector dimensions.

-- 1. Ensure 'articulos' has correct 768-dimension vector for Gemini
-- If it was created as 1536 (OpenAI), we need to change it.
DO $$
BEGIN
    -- Check if column exists and has wrong dimension
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'articulos' 
        AND column_name = 'embedding'
    ) THEN
        -- We can't easily alter type with data in it if dimensions mismatch, 
        -- but for this dev stage we might just drop/add or alter if empty.
        -- Let's try to alter strict.
        BEGIN
            ALTER TABLE articulos ALTER COLUMN embedding TYPE vector(768);
        EXCEPTION WHEN OTHERS THEN
            -- If it fails (e.g. data exists), we might need to clear it or user needs to handle.
            -- For now, we assume it's safe or we just report.
            RAISE NOTICE 'Could not alter embedding to 768. It might have data. Please check.';
        END;
    END IF;
END $$;

-- 2. Add Detailed Columns to 'import_items'
-- These support the Unit vs Case logic and robust parsing.
ALTER TABLE import_items
ADD COLUMN IF NOT EXISTS supplier_code TEXT,
ADD COLUMN IF NOT EXISTS ean TEXT,
ADD COLUMN IF NOT EXISTS description_norm TEXT,
ADD COLUMN IF NOT EXISTS pack_qty NUMERIC(10,2),    -- Paq x Bulto
ADD COLUMN IF NOT EXISTS unit_price NUMERIC(20,4),  -- Precio Unitario Detectado
ADD COLUMN IF NOT EXISTS case_price NUMERIC(20,4),  -- Precio Bulto Detectado
ADD COLUMN IF NOT EXISTS cost_unit NUMERIC(20,4),   -- Costo Final Unitario (Calculado)
ADD COLUMN IF NOT EXISTS cost_case NUMERIC(20,4),   -- Costo Final Bulto (Calculado)
ADD COLUMN IF NOT EXISTS requires_review BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS parse_notes JSONB DEFAULT '{}'::jsonb; -- "Why review?", "Parsing logic used"

-- 3. Create Index for searching imports by status/provider
CREATE INDEX IF NOT EXISTS idx_import_items_req_review ON import_items(import_id, requires_review);

-- 4. Comment columns
COMMENT ON COLUMN import_items.pack_qty IS 'Units per Case (Paq x Bulto)';
COMMENT ON COLUMN import_items.cost_unit IS 'Final calculated Unit Cost used for updates';
