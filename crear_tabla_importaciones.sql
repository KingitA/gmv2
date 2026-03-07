
CREATE TABLE IF NOT EXISTS public.importaciones_articulos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    archivo_nombre VARCHAR(255),
    tipo VARCHAR(100),
    columnas_afectadas JSONB,
    registros_nuevos INTEGER DEFAULT 0,
    registros_actualizados INTEGER DEFAULT 0,
    skus_omitidos JSONB
);

-- Habilitar RLS pero permitir todo temporalmente o ajustar segun las reglas de tu sistema
ALTER TABLE public.importaciones_articulos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ver importaciones" 
ON public.importaciones_articulos FOR SELECT 
USING (true);

CREATE POLICY "Insertar importaciones" 
ON public.importaciones_articulos FOR INSERT 
WITH CHECK (true);
