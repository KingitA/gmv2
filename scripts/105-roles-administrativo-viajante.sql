-- =====================================================
-- MIGRACIÓN: Agregar roles administrativo y viajante
-- =====================================================
-- Ejecutar en Supabase SQL Editor

INSERT INTO roles (nombre, descripcion) VALUES
  ('administrativo', 'Acceso al ERP completo sin módulos deposito/chofer/viajantes/finanzas/listas-precio'),
  ('viajante', 'Módulo viajante - ventas y cobranzas en campo (en desarrollo)')
ON CONFLICT (nombre) DO NOTHING;

-- Verificar resultado
SELECT nombre, descripcion FROM roles ORDER BY nombre;
