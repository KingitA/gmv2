# PROMPT PARA INTEGRAR CRM AL ERP

Copia y pega este prompt completo en el chat del CRM:

---

## IMPORTANTE: Anular trabajo anterior e integrar con ERP existente

Necesito que ANULES todo lo que hiciste anteriormente sobre base de datos y autenticación. Vamos a conectar este CRM a un ERP existente que ya tiene toda la estructura de base de datos configurada.

## Situación actual

Tengo dos proyectos:
1. **ERP (Inventory and sales system)**: Sistema completo de gestión empresarial con inventario, proveedores, compras, etc.
2. **CRM (este proyecto)**: Sistema de ventas móvil para vendedores y clientes

Ambos deben compartir la MISMA base de datos Supabase para que estén sincronizados.

## Estructura de base de datos ya creada en el ERP

El ERP ya tiene estas tablas configuradas:

### Tabla: `usuarios_crm`
\`\`\`sql
- id (uuid, primary key)
- email (text, unique)
- nombre_completo (text)
- telefono (text)
- empresa (text, nullable)
- rol (text: 'vendedor' o 'cliente')
- estado (text: 'pendiente', 'activo', 'rechazado')
- cliente_id (bigint, nullable, FK a clientes)
- viajante_id (bigint, nullable, FK a viajantes)
- created_at (timestamp)
- updated_at (timestamp)
- aprobado_por (text, nullable)
- aprobado_at (timestamp, nullable)
- notas_admin (text, nullable)
\`\`\`

### Tablas relacionadas que ya existen:
- `clientes`: Clientes del sistema con precios, descuentos, cuenta corriente
- `viajantes`: Vendedores con comisiones y zonas asignadas
- `articulos`: Productos con stock, precios, imágenes
- `precios`: Sistema de precios por lista
- `pedidos`: Pedidos de clientes
- `pedidos_detalle`: Detalle de productos en pedidos
- `cuenta_corriente`: Movimientos de cuenta corriente
- `zonas`: Zonas geográficas
- `localidades`: Localidades por zona

## Lo que necesito que hagas

### 1. Conectar a la base de datos del ERP

Usa estas variables de entorno que ya están configuradas:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (solo para operaciones admin)

### 2. Sistema de autenticación y registro

**Flujo de registro:**
1. Usuario nuevo se registra en el CRM con:
   - Email
   - Contraseña
   - Nombre completo
   - Teléfono
   - Empresa (opcional)
   - Tipo de cuenta que solicita: "Vendedor" o "Cliente"

2. Al registrarse:
   - Se crea el usuario en Supabase Auth
   - Se crea un registro en `usuarios_crm` con estado "pendiente"
   - El usuario NO puede acceder al sistema hasta ser aprobado

3. Administrador desde el ERP:
   - Ve usuarios pendientes
   - Aprueba y asigna rol definitivo (vendedor o cliente)
   - Si es vendedor: lo vincula a un viajante existente
   - Si es cliente: lo vincula a un cliente existente
   - Cambia estado a "activo"

4. Usuario aprobado:
   - Puede iniciar sesión
   - Ve funcionalidades según su rol

**Flujo de login:**
1. Usuario ingresa email y contraseña
2. Sistema verifica en Supabase Auth
3. Consulta `usuarios_crm` para obtener rol y estado
4. Si estado es "pendiente": muestra mensaje "Tu cuenta está pendiente de aprobación"
5. Si estado es "rechazado": muestra mensaje "Tu cuenta fue rechazada"
6. Si estado es "activo": redirige según rol

### 3. Funcionalidades por rol

**VENDEDOR (Viajante):**
- Ver catálogo de productos (tabla `articulos`)
- Ver sus clientes asignados (filtrados por su `viajante_id`)
- Crear pedidos para sus clientes
- Ver historial de pedidos de sus clientes
- Ver sus comisiones
- Agregar nuevos clientes (que quedan pendientes de aprobación en ERP)

**CLIENTE:**
- Ver catálogo de productos con SUS precios específicos
- Hacer pedidos
- Ver su cuenta corriente
- Ver historial de pedidos
- Imputar pagos (que quedan pendientes de aprobación)

### 4. Cálculo de precios (IMPORTANTE)

El sistema de precios es complejo:

\`\`\`typescript
// Precio final para un cliente
const precioFinal = precioLista * (1 - descuentoCliente/100) * (1 + ivaCliente/100)

// Donde:
// - precioLista: viene de tabla `precios` según lista_precio_id del cliente
// - descuentoCliente: campo `descuento` en tabla `clientes`
// - ivaCliente: campo `iva` en tabla `clientes`
\`\`\`

### 5. Políticas de seguridad (RLS)

Configura Row Level Security en Supabase:

**Para vendedores:**
\`\`\`sql
-- Solo ven sus clientes
CREATE POLICY "vendedores_ven_sus_clientes" ON clientes
FOR SELECT USING (
  viajante_id = (
    SELECT viajante_id FROM usuarios_crm 
    WHERE id = auth.uid() AND rol = 'vendedor'
  )
);

-- Solo ven pedidos de sus clientes
CREATE POLICY "vendedores_ven_pedidos_sus_clientes" ON pedidos
FOR SELECT USING (
  cliente_id IN (
    SELECT id FROM clientes 
    WHERE viajante_id = (
      SELECT viajante_id FROM usuarios_crm 
      WHERE id = auth.uid() AND rol = 'vendedor'
    )
  )
);
\`\`\`

**Para clientes:**
\`\`\`sql
-- Solo ven sus propios datos
CREATE POLICY "clientes_ven_sus_datos" ON clientes
FOR SELECT USING (
  id = (
    SELECT cliente_id FROM usuarios_crm 
    WHERE id = auth.uid() AND rol = 'cliente'
  )
);

-- Solo ven sus pedidos
CREATE POLICY "clientes_ven_sus_pedidos" ON pedidos
FOR SELECT USING (
  cliente_id = (
    SELECT cliente_id FROM usuarios_crm 
    WHERE id = auth.uid() AND rol = 'cliente'
  )
);
\`\`\`

### 6. Estructura de archivos sugerida

\`\`\`
app/
├── (auth)/
│   ├── login/
│   │   └── page.tsx          # Pantalla de login
│   ├── registro/
│   │   └── page.tsx          # Pantalla de registro
│   └── pendiente/
│       └── page.tsx          # Mensaje de cuenta pendiente
├── (vendedor)/
│   ├── catalogo/
│   │   └── page.tsx          # Catálogo de productos
│   ├── clientes/
│   │   └── page.tsx          # Lista de clientes del vendedor
│   ├── pedidos/
│   │   ├── page.tsx          # Lista de pedidos
│   │   └── nuevo/
│   │       └── page.tsx      # Crear nuevo pedido
│   └── comisiones/
│       └── page.tsx          # Ver comisiones
└── (cliente)/
    ├── catalogo/
    │   └── page.tsx          # Catálogo con precios del cliente
    ├── pedidos/
    │   ├── page.tsx          # Historial de pedidos
    │   └── nuevo/
    │       └── page.tsx      # Hacer nuevo pedido
    └── cuenta-corriente/
        └── page.tsx          # Ver cuenta corriente
\`\`\`

### 7. Helpers de Supabase

Crea estos helpers para manejar la autenticación:

\`\`\`typescript
// lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createServerSupabaseClient() {
  const cookieStore = await cookies()
  
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
      },
    }
  )
}

// lib/auth.ts
import { createServerSupabaseClient } from './supabase/server'

export async function getCurrentUser() {
  const supabase = await createServerSupabaseClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  
  const { data: usuarioCrm } = await supabase
    .from('usuarios_crm')
    .select('*')
    .eq('id', user.id)
    .single()
  
  return {
    ...user,
    rol: usuarioCrm?.rol,
    estado: usuarioCrm?.estado,
    cliente_id: usuarioCrm?.cliente_id,
    viajante_id: usuarioCrm?.viajante_id,
  }
}
\`\`\`

### 8. Middleware para proteger rutas

\`\`\`typescript
// middleware.ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const response = NextResponse.next()
  
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: any) {
          response.cookies.set(name, value, options)
        },
        remove(name: string, options: any) {
          response.cookies.delete(name)
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  
  // Si no hay usuario y no está en login/registro, redirigir a login
  if (!user && !request.nextUrl.pathname.startsWith('/login') && !request.nextUrl.pathname.startsWith('/registro')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  
  // Si hay usuario, verificar estado
  if (user) {
    const { data: usuarioCrm } = await supabase
      .from('usuarios_crm')
      .select('estado, rol')
      .eq('id', user.id)
      .single()
    
    // Si está pendiente, solo puede ver página de pendiente
    if (usuarioCrm?.estado === 'pendiente' && !request.nextUrl.pathname.startsWith('/pendiente')) {
      return NextResponse.redirect(new URL('/pendiente', request.url))
    }
    
    // Si está rechazado, cerrar sesión
    if (usuarioCrm?.estado === 'rechazado') {
      await supabase.auth.signOut()
      return NextResponse.redirect(new URL('/login?error=rechazado', request.url))
    }
  }
  
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
\`\`\`

## Resumen de lo que debes hacer

1. ✅ Conectar a la base de datos Supabase del ERP (usar variables de entorno existentes)
2. ✅ Crear sistema de registro que inserta en `usuarios_crm` con estado "pendiente"
3. ✅ Crear sistema de login que verifica estado y rol
4. ✅ Crear rutas protegidas con middleware
5. ✅ Implementar funcionalidades para VENDEDOR
6. ✅ Implementar funcionalidades para CLIENTE
7. ✅ Configurar RLS en Supabase para seguridad
8. ✅ Implementar cálculo correcto de precios

## IMPORTANTE

- NO crees nuevas tablas en Supabase, usa las que ya existen
- NO modifiques el esquema de la base de datos
- Usa SOLO las variables de entorno que ya están configuradas
- El ERP se encarga de aprobar usuarios, tú solo muestras el estado

---

¿Entendiste? Confirma que comprendiste la estructura y empezá a implementar el sistema de autenticación y las pantallas según el rol.
