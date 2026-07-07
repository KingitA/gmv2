-- Migration: descripción e imagen de rubros para el catálogo navegable del vendedor
-- La imagen se referencia por URL (bucket de Supabase Storage o externa).

ALTER TABLE rubros
  ADD COLUMN IF NOT EXISTS descripcion TEXT,
  ADD COLUMN IF NOT EXISTS imagen_url TEXT;
