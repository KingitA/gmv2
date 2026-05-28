-- =====================================================
-- MIGRACIÓN: Login por nombre de usuario
-- =====================================================
-- Usa la columna "nombre" existente como identificador de login.
-- Solo se agrega un índice único para garantizar que no haya dos
-- usuarios con el mismo nombre (case-insensitive).

CREATE UNIQUE INDEX IF NOT EXISTS usuarios_nombre_unique ON usuarios(LOWER(nombre));

-- Verificar resultado
SELECT id, nombre, email, estado FROM usuarios ORDER BY created_at;
