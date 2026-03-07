# Respuestas a las Preguntas del CRM

## 1. Endpoint de precios

**Respuesta:** El endpoint `/api/precios/catalogo` **YA EXISTE en el ERP** y está listo para usar.

**Tú solo debes consumirlo desde el CRM**, no crearlo.

### Cómo usarlo:

\`\`\`typescript
// Para un cliente específico
const response = await fetch(
  `https://tu-erp.vercel.app/api/precios/catalogo?cliente_id=${clienteId}`
)
const data = await response.json()
// data.productos contiene todos los artículos con precios calculados

// Para un vendedor (ve todos sus clientes)
const response = await fetch(
  `https://tu-erp.vercel.app/api/precios/catalogo?vendedor_id=${vendedorId}`
)
const data = await response.json()
// data.clientes contiene array de clientes con sus productos
\`\`\`

---

## 2. Creación de pedidos

**Respuesta:** Ahora existe el endpoint `/api/pedidos` en el ERP para crear pedidos.

### Estructura de la petición:

\`\`\`typescript
POST https://tu-erp.vercel.app/api/pedidos

Body:
{
  "cliente_id": "uuid-del-cliente",
  "vendedor_id": "uuid-del-vendedor", // Opcional, se toma del cliente si no se envía
  "items": [
    {
      "articulo_id": "uuid-del-articulo",
      "cantidad": 10
    },
    {
      "articulo_id": "uuid-otro-articulo",
      "cantidad": 5
    }
  ],
  "observaciones": "Entregar antes del viernes", // Opcional
  "punto_venta": "CRM" // Opcional, por defecto es "CRM"
}
\`\`\`

### Respuesta exitosa:

\`\`\`json
{
  "success": true,
  "pedido": {
    "id": "uuid-del-pedido",
    "numero_pedido": "0042",
    "total": 15750,
    "items": 2
  }
}
\`\`\`

### Respuesta con error:

\`\`\`json
{
  "error": "Stock insuficiente para SHAMPOO DOVE 400ML. Disponible: 5, Solicitado: 10"
}
\`\`\`

### Estructura de las tablas:

**Tabla `pedidos`:**
- `id`: UUID (generado automáticamente)
- `numero_pedido`: VARCHAR (generado automáticamente, ej: "0001", "0002")
- `cliente_id`: UUID (requerido)
- `vendedor_id`: UUID (opcional, se toma del cliente)
- `fecha`: DATE (fecha actual)
- `estado`: VARCHAR (pendiente, en_preparacion, listo, en_viaje, entregado, cancelado)
- `punto_venta`: VARCHAR (CRM, ERP, etc.)
- `subtotal`: NUMERIC
- `total_flete`: NUMERIC
- `total_comision`: NUMERIC
- `total_impuestos`: NUMERIC
- `descuento_general`: NUMERIC
- `descuento_vendedor`: NUMERIC
- `total`: NUMERIC
- `observaciones`: TEXT
- `viaje_id`: UUID (se asigna después desde el ERP)

**Tabla `pedidos_detalle`:**
- `id`: UUID (generado automáticamente)
- `pedido_id`: UUID (requerido)
- `articulo_id`: UUID (requerido)
- `cantidad`: NUMERIC (requerido)
- `precio_costo`: NUMERIC (calculado automáticamente)
- `precio_base`: NUMERIC (calculado automáticamente)
- `precio_final`: NUMERIC (calculado automáticamente)
- `subtotal`: NUMERIC (calculado automáticamente)
- `descuento_articulo`: NUMERIC
- `flete`: NUMERIC (calculado automáticamente)
- `comision`: NUMERIC (calculado automáticamente)
- `impuestos`: NUMERIC (calculado automáticamente)

**NO necesitas insertar directamente en Supabase**, el endpoint hace todo por ti:
- Calcula todos los precios
- Verifica stock disponible
- Genera el número de pedido
- Crea el pedido y sus items
- Actualiza el stock (lo reserva)

---

## 3. Relación vendedor-cliente

**Respuesta:** SÍ, existe el campo `vendedor_id` en la tabla `clientes`.

### Cómo funciona:

- Cada cliente tiene asignado un vendedor en el campo `clientes.vendedor_id`
- Los vendedores pueden ver SOLO sus clientes asignados
- Los clientes solo ven sus propios datos

### Para obtener clientes de un vendedor:

\`\`\`typescript
// Desde el CRM, usando Supabase directamente
const { data: clientes } = await supabase
  .from('clientes')
  .select('*')
  .eq('vendedor_id', vendedorId)
  .eq('activo', true)
\`\`\`

### O usar el endpoint de precios:

\`\`\`typescript
// Esto ya te devuelve los clientes con sus precios
const response = await fetch(
  `https://tu-erp.vercel.app/api/precios/catalogo?vendedor_id=${vendedorId}`
)
const data = await response.json()
// data.clientes = [{ cliente: {...}, productos: [...] }]
\`\`\`

---

## 4. Stock y reservas

**Respuesta:** El stock se reserva SOLO al confirmar el pedido (cuando se crea).

### Flujo recomendado:

1. **Usuario agrega al carrito:** NO se reserva stock, solo se guarda en el estado local del CRM
2. **Usuario confirma pedido:** Se llama a `POST /api/pedidos` que:
   - Verifica que haya stock disponible
   - Si hay stock: crea el pedido y descuenta el stock
   - Si NO hay stock: retorna error con el artículo que no tiene stock

### NO existe tabla de reservas temporales

El stock se maneja directamente en `articulos.stock_actual`:
- Cuando se crea un pedido: `stock_actual -= cantidad`
- Cuando se cancela un pedido: `stock_actual += cantidad`
- Cuando se entrega un pedido: el stock ya está descontado

### Validación de stock en tiempo real:

Antes de confirmar el pedido, puedes verificar el stock:

\`\`\`typescript
const { data: articulo } = await supabase
  .from('articulos')
  .select('stock_actual, descripcion')
  .eq('id', articuloId)
  .single()

if (articulo.stock_actual < cantidadSolicitada) {
  alert(`Solo hay ${articulo.stock_actual} unidades disponibles`)
}
\`\`\`

---

## Resumen de endpoints disponibles:

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/precios/catalogo?cliente_id=xxx` | GET | Obtener precios para un cliente |
| `/api/precios/catalogo?vendedor_id=xxx` | GET | Obtener precios de todos los clientes de un vendedor |
| `/api/pedidos` | POST | Crear un nuevo pedido |
| `/api/pedidos?cliente_id=xxx` | GET | Obtener pedidos de un cliente |
| `/api/pedidos?vendedor_id=xxx` | GET | Obtener pedidos de un vendedor |

---

## Autenticación

Todos los endpoints usan la misma base de datos de Supabase compartida entre ERP y CRM.

**Configuración en el CRM:**

\`\`\`typescript
// .env.local
NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu-anon-key
\`\`\`

**Crear cliente de Supabase:**

\`\`\`typescript
import { createBrowserClient } from '@supabase/ssr'

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
\`\`\`

---

## Ejemplo completo de flujo en el CRM:

\`\`\`typescript
// 1. Usuario inicia sesión
const { data: usuario } = await supabase.auth.getUser()

// 2. Obtener datos del usuario CRM
const { data: usuarioCRM } = await supabase
  .from('usuarios_crm')
  .select('*, cliente_id, vendedor_id, rol')
  .eq('email', usuario.email)
  .single()

// 3. Cargar catálogo según el rol
let catalogoUrl = ''
if (usuarioCRM.rol === 'cliente') {
  catalogoUrl = `/api/precios/catalogo?cliente_id=${usuarioCRM.cliente_id}`
} else if (usuarioCRM.rol === 'vendedor') {
  catalogoUrl = `/api/precios/catalogo?vendedor_id=${usuarioCRM.vendedor_id}`
}

const response = await fetch(catalogoUrl)
const { productos } = await response.json()

// 4. Mostrar productos en el catálogo
productos.forEach(producto => {
  console.log(`${producto.descripcion}: $${producto.precio_final}`)
  if (producto.stock_disponible === 0) {
    console.log('SIN STOCK')
  }
})

// 5. Usuario agrega al carrito (estado local)
const carrito = [
  { articulo_id: 'uuid-1', cantidad: 5 },
  { articulo_id: 'uuid-2', cantidad: 10 }
]

// 6. Usuario confirma pedido
const pedidoResponse = await fetch('/api/pedidos', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    cliente_id: usuarioCRM.cliente_id,
    items: carrito,
    observaciones: 'Entregar por la mañana'
  })
})

const { success, pedido, error } = await pedidoResponse.json()

if (success) {
  alert(`Pedido #${pedido.numero_pedido} creado exitosamente!`)
} else {
  alert(`Error: ${error}`)
}
\`\`\`

---

¿Alguna otra duda? Estoy listo para ayudarte con la integración.
