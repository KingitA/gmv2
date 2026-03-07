# Guía de Conexión del CRM a la Base de Datos del ERP

## Resumen

Este documento explica cómo conectar el proyecto CRM (proyecto separado en v0) a la misma base de datos Supabase que usa el ERP.

## Paso 1: Obtener las Credenciales de Supabase

Las credenciales de Supabase del ERP son:

- `SUPABASE_URL`: La URL de tu proyecto Supabase
- `NEXT_PUBLIC_SUPABASE_URL`: La misma URL pero accesible desde el cliente
- `SUPABASE_ANON_KEY`: La clave anónima (pública)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: La misma clave pero accesible desde el cliente
- `SUPABASE_SERVICE_ROLE_KEY`: La clave de servicio (privada, solo servidor)

## Paso 2: Configurar el CRM

En el proyecto CRM, debes agregar estas mismas variables de entorno en la sección "Vars" del sidebar de v0.

### Variables que necesitas agregar:

\`\`\`
SUPABASE_URL=<la misma URL del ERP>
NEXT_PUBLIC_SUPABASE_URL=<la misma URL del ERP>
SUPABASE_ANON_KEY=<la misma clave del ERP>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<la misma clave del ERP>
SUPABASE_SERVICE_ROLE_KEY=<la misma clave del ERP>
\`\`\`

## Paso 3: Estructura de Tablas para el CRM

El CRM necesita acceso a las siguientes tablas:

### Tablas Principales:

1. **usuarios_crm** - Usuarios registrados (vendedores y clientes)
2. **clientes** - Información de clientes
3. **vendedores** - Información de vendedores
4. **articulos** - Catálogo de productos
5. **pedidos** - Pedidos realizados
6. **pedidos_detalle** - Detalle de los pedidos
7. **comprobantes_venta** - Comprobantes de venta
8. **zonas** - Zonas de venta
9. **proveedores** - Proveedores (para cálculo de precios)

### Tabla de Usuarios CRM:

\`\`\`sql
usuarios_crm (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  nombre VARCHAR(255) NOT NULL,
  telefono VARCHAR(50),
  cuit VARCHAR(20),
  direccion TEXT,
  rol VARCHAR(50), -- 'pendiente', 'vendedor', 'cliente'
  estado VARCHAR(50), -- 'pendiente_aprobacion', 'activo', 'rechazado', 'suspendido'
  vendedor_id UUID, -- Referencia a vendedores(id)
  cliente_id UUID, -- Referencia a clientes(id)
  observaciones TEXT,
  motivo_rechazo TEXT,
  fecha_registro TIMESTAMP,
  fecha_aprobacion TIMESTAMP,
  usuario_aprobador VARCHAR(255)
)
\`\`\`

## Paso 4: Flujo de Registro y Aprobación

### Desde el CRM:

1. Usuario se registra en el CRM
2. Se crea un registro en `usuarios_crm` con:
   - `rol = 'pendiente'`
   - `estado = 'pendiente_aprobacion'`

### Desde el ERP:

1. Admin ve el usuario en "Gestión de Usuarios CRM"
2. Admin aprueba y asigna rol ('vendedor' o 'cliente')
3. Se actualiza el registro:
   - `rol = 'vendedor'` o `'cliente'`
   - `estado = 'activo'`
   - Se crea el registro correspondiente en `vendedores` o `clientes`
   - Se vincula con `vendedor_id` o `cliente_id`

### De vuelta en el CRM:

1. Usuario inicia sesión
2. CRM verifica el rol en `usuarios_crm`
3. Según el rol, muestra:
   - **Vendedor**: Panel de vendedor con clientes, pedidos, comisiones
   - **Cliente**: Panel de cliente con catálogo, carrito, cuenta corriente

## Paso 5: Seguridad con RLS (Row Level Security)

Para proteger los datos, debes configurar políticas RLS en Supabase:

### Política para Vendedores:

\`\`\`sql
-- Los vendedores solo ven sus propios clientes y pedidos
CREATE POLICY "vendedores_ven_sus_clientes"
ON clientes FOR SELECT
USING (vendedor_id = (
  SELECT vendedor_id FROM usuarios_crm 
  WHERE email = auth.jwt() ->> 'email'
));
\`\`\`

### Política para Clientes:

\`\`\`sql
-- Los clientes solo ven sus propios datos
CREATE POLICY "clientes_ven_sus_datos"
ON clientes FOR SELECT
USING (id = (
  SELECT cliente_id FROM usuarios_crm 
  WHERE email = auth.jwt() ->> 'email'
));
\`\`\`

## Paso 6: Autenticación

El CRM debe usar Supabase Auth para autenticar usuarios:

\`\`\`typescript
import { createBrowserClient } from '@supabase/ssr'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Registro
const { data, error } = await supabase.auth.signUp({
  email,
  password,
  options: {
    data: {
      nombre,
      telefono,
      // ... otros datos
    }
  }
})

// Login
const { data, error } = await supabase.auth.signInWithPassword({
  email,
  password
})

// Obtener usuario actual
const { data: { user } } = await supabase.auth.getUser()

// Obtener rol del usuario
const { data: usuarioCRM } = await supabase
  .from('usuarios_crm')
  .select('rol, estado, vendedor_id, cliente_id')
  .eq('email', user.email)
  .single()
\`\`\`

## Paso 7: Cálculo de Precios

El CRM debe calcular precios según la fórmula:

\`\`\`
precio_base = precio_compra + (precio_compra * margen_proveedor / 100)
precio_final = precio_base + flete + comision + impuestos + ajustes
\`\`\`

Donde:
- `precio_compra`: De la tabla `articulos`
- `margen_proveedor`: De la tabla `proveedores`
- `flete`: Según zona del cliente
- `comision`: Según proveedor y vendedor
- `impuestos`: IVA, IIBB, percepciones según cliente
- `ajustes`: Según nivel de puntaje del cliente

## Resumen de Conexión

1. ✅ Copiar las credenciales de Supabase del ERP al CRM
2. ✅ Ejecutar el script SQL para crear `usuarios_crm`
3. ✅ Configurar autenticación en el CRM
4. ✅ Implementar lógica de roles en el CRM
5. ✅ Configurar RLS para seguridad
6. ✅ Implementar cálculo de precios
7. ✅ Probar el flujo completo

## Ventajas de esta Arquitectura

- ✅ **Sincronización automática**: Ambos proyectos usan la misma DB
- ✅ **CRM liviano**: Solo carga lo necesario para móvil
- ✅ **ERP completo**: Mantiene todas sus funciones
- ✅ **Seguridad**: RLS protege los datos según rol
- ✅ **Escalabilidad**: Cada proyecto puede crecer independientemente

## Soporte

Si tienes dudas sobre la conexión, revisa:
1. Las variables de entorno en ambos proyectos
2. Las políticas RLS en Supabase
3. Los logs de autenticación
4. La tabla `usuarios_crm` para verificar roles
