-- Add precio_verificado column to recepciones_items to track if the price was explicitly approved
ALTER TABLE recepciones_items 
ADD COLUMN IF NOT EXISTS precio_verificado BOOLEAN DEFAULT FALSE;

-- Function to update article cost (simple wrapper for transparency)
-- We will handle logic in API but DB could have a log trigger if needed.
-- For now just the column.
