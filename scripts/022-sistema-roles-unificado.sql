-- =====================================================
-- SISTEMA DE ROLES MÚLTIPLES - MIGRACIÓN COMPLETA
-- =====================================================
-- Este script implementa un sistema de roles flexible donde
-- un usuario puede tener múltiples roles (chofer + depósito, vendedor + admin, etc.)

BEGIN;

-- =====================================================
-- PASO 1: CREAR NUEVAS TABLAS
-- =====================================================

-- Tabla unificada de usuarios (fuente única de verdad)
CREATE TABLE IF NOT EXISTS usuarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar UNIQUE NOT NULL,
  nombre varchar NOT NULL,
  telefono varchar,
  estado varchar DEFAULT 'activo', -- activo, inactivo, pendiente_aprobacion
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

-- Catálogo de roles disponibles en el sistema
CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre varchar UNIQUE NOT NULL,
  descripcion text,
  created_at timestamp DEFAULT now()
);

-- Relación many-to-many: un usuario puede tener múltiples roles
CREATE TABLE IF NOT EXISTS usuarios_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid REFERENCES usuarios(id) ON DELETE CASCADE,
  rol_id uuid REFERENCES roles(id) ON DELETE CASCADE,
  asignado_en timestamp DEFAULT now(),
  UNIQUE(usuario_id, rol_id) -- Prevenir duplicados
);

-- Información específica de vendedores (solo para usuarios con rol vendedor)
CREATE TABLE IF NOT EXISTS vendedores_info (
  usuario_id uuid PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  comision_bazar_limpieza numeric DEFAULT 0,
  comision_perfumeria numeric DEFAULT 0,
  zona_asignada varchar,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

-- Información específica de clientes (solo para usuarios con rol cliente)
CREATE TABLE IF NOT EXISTS clientes_info (
  usuario_id uuid PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  razon_social varchar,
  cuit varchar,
  direccion text,
  condicion_iva varchar,
  condicion_pago varchar,
  localidad_id uuid REFERENCES localidades(id),
  vendedor_id uuid REFERENCES usuarios(id),
  porcentaje_ajuste numeric DEFAULT 0,
  puntaje numeric DEFAULT 0,
  nivel_puntaje varchar,
  tipo_canal varchar,
  activo boolean DEFAULT true,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

-- =====================================================
-- PASO 2: INSERTAR ROLES DISPONIBLES
-- =====================================================

INSERT INTO roles (nombre, descripcion) VALUES
  ('admin', 'Acceso total al ERP - gestión completa del sistema'),
  ('chofer', 'Módulo de choferes - gestión de viajes y entregas'),
  ('vendedor', 'Módulo CRM - gestión de clientes y pedidos'),
  ('deposito', 'Módulo de depósito - preparación y picking de pedidos'),
  ('cliente', 'Módulo de clientes - realizar pedidos y consultar cuenta corriente')
ON CONFLICT (nombre) DO NOTHING;

-- =====================================================
-- PASO 3: MIGRAR DATOS DESDE PROFILES
-- =====================================================

-- Migrar usuarios desde profiles (choferes, admin, depósito, etc)
INSERT INTO usuarios (id, email, nombre, estado)
SELECT 
  id, 
  COALESCE(email, id::text || '@temp.com'), -- Si no tiene email, generar uno temporal
  COALESCE(nombre, 'Usuario'), 
  'activo'
FROM profiles
WHERE id IS NOT NULL
ON CONFLICT (email) DO NOTHING;

-- Asignar roles desde profiles (solo si el rol existe en la tabla roles)
INSERT INTO usuarios_roles (usuario_id, rol_id)
SELECT 
  p.id,
  r.id
FROM profiles p
JOIN roles r ON r.nombre = p.rol
WHERE p.rol IS NOT NULL
  AND p.id IS NOT NULL
  AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = p.id)
ON CONFLICT (usuario_id, rol_id) DO NOTHING;

-- =====================================================
-- PASO 4: MIGRAR DATOS DESDE VENDEDORES
-- =====================================================

-- Migrar vendedores a la tabla usuarios
INSERT INTO usuarios (id, email, nombre, telefono, estado)
SELECT 
  id,
  COALESCE(email, id::text || '@vendedor.temp.com'),
  nombre,
  telefono,
  CASE WHEN activo THEN 'activo' ELSE 'inactivo' END
FROM vendedores
WHERE id IS NOT NULL
ON CONFLICT (email) DO NOTHING;

-- Asignar rol vendedor
INSERT INTO usuarios_roles (usuario_id, rol_id)
SELECT 
  v.id,
  r.id
FROM vendedores v
JOIN roles r ON r.nombre = 'vendedor'
WHERE v.id IS NOT NULL
  AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = v.id)
ON CONFLICT (usuario_id, rol_id) DO NOTHING;

-- Migrar información específica de vendedores
INSERT INTO vendedores_info (usuario_id, comision_bazar_limpieza, comision_perfumeria)
SELECT 
  id,
  COALESCE(comision_bazar_limpieza, 0),
  COALESCE(comision_perfumeria, 0)
FROM vendedores
WHERE id IS NOT NULL
  AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = vendedores.id)
ON CONFLICT (usuario_id) DO NOTHING;

-- =====================================================
-- PASO 5: MIGRAR DATOS DESDE USUARIOS_CRM
-- =====================================================

-- Migrar usuarios del CRM que están activos o pendientes
INSERT INTO usuarios (id, email, nombre, telefono, estado)
SELECT 
  id,
  email,
  nombre,
  telefono,
  estado
FROM usuarios_crm
WHERE estado IN ('activo', 'pendiente_aprobacion')
  AND id IS NOT NULL
  AND email IS NOT NULL
ON CONFLICT (email) DO NOTHING;

-- Asignar roles a usuarios del CRM aprobados
INSERT INTO usuarios_roles (usuario_id, rol_id)
SELECT 
  uc.id,
  r.id
FROM usuarios_crm uc
JOIN roles r ON r.nombre = uc.rol
WHERE uc.estado = 'activo' 
  AND uc.rol IN ('vendedor', 'cliente')
  AND uc.id IS NOT NULL
  AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = uc.id)
ON CONFLICT (usuario_id, rol_id) DO NOTHING;

-- Migrar información de vendedores que venían del CRM
INSERT INTO vendedores_info (usuario_id, comision_bazar_limpieza, comision_perfumeria)
SELECT 
  uc.id,
  COALESCE(v.comision_bazar_limpieza, 0),
  COALESCE(v.comision_perfumeria, 0)
FROM usuarios_crm uc
JOIN vendedores v ON v.id = uc.vendedor_id
WHERE uc.rol = 'vendedor' 
  AND uc.estado = 'activo'
  AND uc.vendedor_id IS NOT NULL
  AND uc.id IS NOT NULL
  AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id = uc.id)
ON CONFLICT (usuario_id) DO NOTHING;

-- =====================================================
-- PASO 6: CREAR ÍNDICES PARA OPTIMIZAR CONSULTAS
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);
CREATE INDEX IF NOT EXISTS idx_usuarios_estado ON usuarios(estado);
CREATE INDEX IF NOT EXISTS idx_usuarios_roles_usuario ON usuarios_roles(usuario_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_roles_rol ON usuarios_roles(rol_id);
CREATE INDEX IF NOT EXISTS idx_vendedores_info_usuario ON vendedores_info(usuario_id);
CREATE INDEX IF NOT EXISTS idx_clientes_info_usuario ON clientes_info(usuario_id);

-- =====================================================
-- PASO 7: CREAR FUNCIONES AUXILIARES
-- =====================================================

-- Función para verificar si un usuario tiene un rol específico
CREATE OR REPLACE FUNCTION usuario_tiene_rol(p_usuario_id uuid, p_rol_nombre varchar)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM usuarios_roles ur
    JOIN roles r ON r.id = ur.rol_id
    WHERE ur.usuario_id = p_usuario_id
      AND r.nombre = p_rol_nombre
  );
END;
$$ LANGUAGE plpgsql;

-- Función para obtener todos los roles de un usuario
CREATE OR REPLACE FUNCTION obtener_roles_usuario(p_usuario_id uuid)
RETURNS TABLE(rol_nombre varchar, rol_descripcion text) AS $$
BEGIN
  RETURN QUERY
  SELECT r.nombre, r.descripcion
  FROM usuarios_roles ur
  JOIN roles r ON r.id = ur.rol_id
  WHERE ur.usuario_id = p_usuario_id
  ORDER BY r.nombre;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- PASO 8: CREAR VISTA PARA FACILITAR CONSULTAS
-- =====================================================

CREATE OR REPLACE VIEW vista_usuarios_completa AS
SELECT 
  u.id,
  u.email,
  u.nombre,
  u.telefono,
  u.estado,
  u.created_at,
  ARRAY_AGG(DISTINCT r.nombre) FILTER (WHERE r.nombre IS NOT NULL) as roles,
  vi.comision_bazar_limpieza,
  vi.comision_perfumeria,
  ci.razon_social,
  ci.cuit,
  ci.direccion
FROM usuarios u
LEFT JOIN usuarios_roles ur ON ur.usuario_id = u.id
LEFT JOIN roles r ON r.id = ur.rol_id
LEFT JOIN vendedores_info vi ON vi.usuario_id = u.id
LEFT JOIN clientes_info ci ON ci.usuario_id = u.id
GROUP BY 
  u.id, u.email, u.nombre, u.telefono, u.estado, u.created_at,
  vi.comision_bazar_limpieza, vi.comision_perfumeria,
  ci.razon_social, ci.cuit, ci.direccion;

-- =====================================================
-- PASO 9: VERIFICACIÓN Y RESUMEN
-- =====================================================

-- Mostrar resumen de la migración
DO $$
DECLARE
  total_usuarios integer;
  total_roles_asignados integer;
BEGIN
  SELECT COUNT(*) INTO total_usuarios FROM usuarios;
  SELECT COUNT(*) INTO total_roles_asignados FROM usuarios_roles;
  
  RAISE NOTICE '========================================';
  RAISE NOTICE 'MIGRACIÓN COMPLETADA EXITOSAMENTE';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Total de usuarios migrados: %', total_usuarios;
  RAISE NOTICE 'Total de roles asignados: %', total_roles_asignados;
  RAISE NOTICE '========================================';
END $$;

-- Mostrar distribución de roles
SELECT 
  r.nombre as rol,
  COUNT(ur.usuario_id) as cantidad_usuarios
FROM roles r
LEFT JOIN usuarios_roles ur ON ur.rol_id = r.id
GROUP BY r.nombre
ORDER BY cantidad_usuarios DESC;

COMMIT;

-- =====================================================
-- NOTAS IMPORTANTES PARA DESPUÉS DE LA MIGRACIÓN
-- =====================================================

-- 1. Crear tu usuario admin manualmente desde Supabase Auth:
--    - Email: juancruzrossi072@gmail.com
--    - Password: 123456
--
-- 2. Obtener el UUID del usuario creado en auth.users
--
-- 3. Insertar en la tabla usuarios:
--    INSERT INTO usuarios (id, email, nombre, estado)
--    VALUES ('UUID-DE-AUTH', 'juancruzrossi072@gmail.com', 'Juan Cruz Rossi', 'activo');
--
-- 4. Asignar todos los roles excepto cliente:
--    INSERT INTO usuarios_roles (usuario_id, rol_id)
--    SELECT 'UUID-DE-AUTH', id FROM roles WHERE nombre != 'cliente';

-- =====================================================
-- PASO 10: ACTUALIZAR FOREIGN KEYS (COMENTADO POR SEGURIDAD)
-- =====================================================
-- IMPORTANTE: Solo ejecutar después de verificar que todo funcionó correctamente

-- ALTER TABLE viajes 
--   DROP CONSTRAINT IF EXISTS viajes_chofer_id_fkey,
--   ADD CONSTRAINT viajes_chofer_id_fkey 
--     FOREIGN KEY (chofer_id) REFERENCES usuarios(id);

-- ALTER TABLE pedidos
--   DROP CONSTRAINT IF EXISTS pedidos_vendedor_id_fkey,
--   ADD CONSTRAINT pedidos_vendedor_id_fkey
--     FOREIGN KEY (vendedor_id) REFERENCES usuarios(id);

-- ALTER TABLE clientes
--   DROP CONSTRAINT IF EXISTS clientes_vendedor_id_fkey,
--   ADD CONSTRAINT clientes_vendedor_id_fkey
--     FOREIGN KEY (vendedor_id) REFERENCES usuarios(id);

-- ALTER TABLE viajes_pagos
--   DROP CONSTRAINT IF EXISTS viajes_pagos_registrado_por_fkey,
--   ADD CONSTRAINT viajes_pagos_registrado_por_fkey
--     FOREIGN KEY (registrado_por) REFERENCES usuarios(id);
