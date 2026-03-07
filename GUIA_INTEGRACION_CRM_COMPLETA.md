# Guía Completa de Integración CRM - ERP

## URL Base del ERP
\`\`\`
https://preview-inventory-and-sales-system-kzml27jfb84gihk99op.vusercontent.net
\`\`\`

---

## 1. PANTALLA PRINCIPAL DEL VENDEDOR

### 1.1 Obtener lista de clientes del vendedor con estado de cuenta

**Endpoint:** `GET /api/clientes?vendedor_id={vendedor_id}`

**Ejemplo:**
\`\`\`typescript
const response = await fetch(
  `${ERP_URL}/api/clientes?vendedor_id=${vendedorId}`
)
const { clientes } = await response.json()

// Respuesta:
{
  "clientes": [
    {
      "id": "uuid",
      "razon_social": "CARDOZO JORGE",
      "direccion": "Av. Siempre Viva 123",
      "localidad": { "nombre": "CABA", "zona": { "nombre": "ZONA 1" } },
      "estado_cuenta": {
        "saldo": -15000,  // negativo = debe, positivo = a favor
        "estado": "pago_vencido", // "libre" | "pago_pendiente" | "pago_vencido"
        "pagos_pendientes": 2,
        "ultimo_pago": "2025-01-15"
      }
    }
  ]
}
\`\`\`

**Filtros disponibles:**
- `?vendedor_id=xxx&zona=ZONA 1` - Filtrar por zona
- `?vendedor_id=xxx&buscar=CARDOZO` - Buscar por nombre

---

## 2. CUENTA CORRIENTE DEL CLIENTE

### 2.1 Ver cuenta corriente completa

**Endpoint:** `GET /api/cuenta-corriente?cliente_id={cliente_id}`

**Ejemplo:**
\`\`\`typescript
const response = await fetch(
  `${ERP_URL}/api/cuenta-corriente?cliente_id=${clienteId}`
)
const data = await response.json()

// Respuesta:
{
  "cliente": {
    "id": "uuid",
    "razon_social": "CARDOZO JORGE",
    "saldo_actual": -15000
  },
  "movimientos": [
    {
      "id": "uuid",
      "fecha": "2025-01-20",
      "tipo": "pedido",
      "numero": "0042",
      "descripcion": "Pedido #0042",
      "debe": 15000,
      "haber": 0,
      "saldo": -15000
    },
    {
      "id": "uuid",
      "fecha": "2025-01-15",
      "tipo": "pago",
      "numero": "REC-001",
      "descripcion": "Pago en efectivo",
      "debe": 0,
      "haber": 10000,
      "saldo": -5000,
      "estado": "confirmado"
    }
  ],
  "resumen": {
    "total_debe": 15000,
    "total_haber": 10000,
    "saldo_actual": -15000,
    "pagos_pendientes": 1,
    "pagos_pendientes_monto": 5000
  }
}
\`\`\`

### 2.2 Registrar un nuevo pago (queda pendiente de confirmación)

**Endpoint:** `POST /api/pagos`

**Ejemplo:**
\`\`\`typescript
const response = await fetch(`${ERP_URL}/api/pagos`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    cliente_id: "uuid-del-cliente",
    vendedor_id: "uuid-del-vendedor",
    monto: 10000,
    forma_pago: "efectivo", // "efectivo" | "transferencia" | "cheque" | "tarjeta"
    comprobante: "REC-001", // Número de recibo o referencia
    observaciones: "Pago parcial de pedido #0042"
  })
})

const { success, pago } = await response.json()

// Respuesta:
{
  "success": true,
  "pago": {
    "id": "uuid",
    "numero": "PAG-0001",
    "estado": "pendiente", // Debe ser confirmado desde el ERP
    "monto": 10000
  }
}
\`\`\`

**IMPORTANTE:** El pago queda en estado "pendiente" hasta que el ERP lo confirme. NO afecta la cuenta corriente hasta ser confirmado.

---

## 3. REALIZAR PEDIDO

### 3.1 Obtener catálogo de productos con precios

**Endpoint:** `GET /api/precios/catalogo?cliente_id={cliente_id}`

**Ejemplo:**
\`\`\`typescript
const response = await fetch(
  `${ERP_URL}/api/precios/catalogo?cliente_id=${clienteId}`
)
const { productos } = await response.json()

// Respuesta:
{
  "productos": [
    {
      "id": "uuid",
      "sku": "062483",
      "descripcion": "SHAMPOO DOVE 400ML",
      "precio_final": 1250,
      "stock_disponible": 45,
      "unidades_por_bulto": 12,
      "categoria": "PERFUMERIA"
    }
  ]
}
\`\`\`

### 3.2 Crear nuevo cliente desde CRM

**Endpoint:** `POST /api/clientes`

**Ejemplo:**
\`\`\`typescript
const response = await fetch(`${ERP_URL}/api/clientes`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    vendedor_id: "uuid-del-vendedor",
    razon_social: "NUEVO CLIENTE SA",
    cuit: "20-12345678-9",
    direccion: "Calle Falsa 123",
    localidad_id: "uuid-de-localidad",
    telefono: "1234567890",
    email: "cliente@email.com",
    puntaje: "regular", // "premium" | "regular" | "riesgo"
    retira_deposito: false
  })
})

const { success, cliente } = await response.json()
\`\`\`

### 3.3 Actualizar datos del cliente (temporal o permanente)

**Endpoint:** `PATCH /api/clientes/{cliente_id}`

**Ejemplo:**
\`\`\`typescript
// Actualización permanente (guarda en BD)
const response = await fetch(`${ERP_URL}/api/clientes/${clienteId}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    direccion: "Nueva Dirección 456",
    razon_social: "NUEVA RAZON SOCIAL"
  })
})
\`\`\`

**Para cambios temporales (solo para un pedido):**
Enviar los datos en el body del pedido con el campo `condiciones_temporales`:

\`\`\`typescript
// Al crear el pedido
{
  cliente_id: "uuid",
  items: [...],
  condiciones_temporales: {
    direccion_entrega: "Dirección temporal",
    razon_social_factura: "Razón social temporal",
    forma_facturacion: "factura" // "factura" | "final" | "remito"
  }
}
\`\`\`

### 3.4 Crear pedido

**Endpoint:** `POST /api/pedidos`

**Ejemplo:**
\`\`\`typescript
const response = await fetch(`${ERP_URL}/api/pedidos`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    cliente_id: "uuid-del-cliente",
    vendedor_id: "uuid-del-vendedor",
    items: [
      {
        articulo_id: "uuid-articulo-1",
        cantidad: 24, // Puede ser en unidades o bultos
        es_bulto: true // Si es true, multiplica por unidades_por_bulto
      },
      {
        articulo_id: "uuid-articulo-2",
        cantidad: 10,
        es_bulto: false
      }
    ],
    observaciones: "Entregar antes del viernes",
    condiciones_temporales: { // Opcional
      direccion_entrega: "Dirección temporal",
      forma_facturacion: "factura"
    }
  })
})

const { success, pedido, error } = await response.json()

// Respuesta exitosa:
{
  "success": true,
  "pedido": {
    "id": "uuid",
    "numero_pedido": "0042",
    "total": 30000,
    "items": 2,
    "estado": "pendiente"
  }
}

// Respuesta con error:
{
  "error": "Stock insuficiente para SHAMPOO DOVE 400ML. Disponible: 5, Solicitado: 24"
}
\`\`\`

---

## 4. MIS VENTAS

### 4.1 Ver pedidos del vendedor

**Endpoint:** `GET /api/pedidos?vendedor_id={vendedor_id}`

**Filtros disponibles:**
- `?vendedor_id=xxx&estado=pendiente` - Solo pendientes
- `?vendedor_id=xxx&estado=en_preparacion` - En preparación
- `?vendedor_id=xxx&cliente_id=xxx` - De un cliente específico

**Ejemplo:**
\`\`\`typescript
const response = await fetch(
  `${ERP_URL}/api/pedidos?vendedor_id=${vendedorId}&estado=pendiente`
)
const { pedidos } = await response.json()

// Respuesta:
{
  "pedidos": [
    {
      "id": "uuid",
      "numero_pedido": "0042",
      "fecha": "2025-01-20",
      "cliente": {
        "razon_social": "CARDOZO JORGE",
        "direccion": "Av. Siempre Viva 123"
      },
      "estado": "pendiente",
      "total": 30000,
      "items_count": 5
    }
  ]
}
\`\`\`

---

## 5. MERCADERÍA VENDIDA

### 5.1 Ver historial de mercadería vendida al cliente

**Endpoint:** `GET /api/mercaderia-vendida?cliente_id={cliente_id}`

**Filtros disponibles:**
- `?cliente_id=xxx&fecha_desde=2025-01-01&fecha_hasta=2025-01-31`
- `?cliente_id=xxx&articulo_id=xxx`
- `?cliente_id=xxx&pedido_id=xxx`

**Ejemplo:**
\`\`\`typescript
const response = await fetch(
  `${ERP_URL}/api/mercaderia-vendida?cliente_id=${clienteId}&fecha_desde=2025-01-01`
)
const { ventas } = await response.json()

// Respuesta:
{
  "ventas": [
    {
      "id": "uuid",
      "fecha": "2025-01-20",
      "pedido_numero": "0042",
      "articulo": {
        "id": "uuid",
        "sku": "062483",
        "descripcion": "SHAMPOO DOVE 400ML"
      },
      "cantidad": 24,
      "precio_unitario": 1250,
      "subtotal": 30000
    }
  ],
  "resumen": {
    "total_articulos": 150,
    "total_monto": 187500
  }
}
\`\`\`

---

## 6. DEVOLUCIONES

### 6.1 Crear devolución (queda pendiente de confirmación)

**Endpoint:** `POST /api/devoluciones`

**Ejemplo:**
\`\`\`typescript
const response = await fetch(`${ERP_URL}/api/devoluciones`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    cliente_id: "uuid-del-cliente",
    vendedor_id: "uuid-del-vendedor",
    pedido_id: "uuid-del-pedido", // Opcional
    retira_viajante: true, // true = lo retira el viajante, false = queda en cliente
    items: [
      {
        articulo_id: "uuid-articulo",
        cantidad: 5,
        precio_venta_original: 1250, // Precio al que se vendió
        fecha_venta_original: "2025-01-20"
      }
    ],
    observaciones: "Producto defectuoso"
  })
})

const { success, devolucion } = await response.json()

// Respuesta:
{
  "success": true,
  "devolucion": {
    "id": "uuid",
    "numero": "DEV-0001",
    "estado": "pendiente", // Debe ser confirmado desde el ERP
    "total": 6250
  }
}
\`\`\`

**IMPORTANTE:** La devolución queda en estado "pendiente" hasta que el ERP la confirme. NO afecta el stock ni la cuenta corriente hasta ser confirmada.

---

## 7. CONSULTAS DIRECTAS A SUPABASE

### 7.1 Obtener localidades (para crear cliente)

\`\`\`typescript
const { data: localidades } = await supabase
  .from('localidades')
  .select('id, nombre, zona:zonas(nombre)')
  .order('nombre')
\`\`\`

### 7.2 Obtener zonas

\`\`\`typescript
const { data: zonas } = await supabase
  .from('zonas')
  .select('id, nombre')
  .order('nombre')
\`\`\`

### 7.3 Verificar usuario CRM vinculado

\`\`\`typescript
const { data: usuario } = await supabase
  .from('usuarios_crm')
  .select('*, cliente:clientes(*), vendedor:vendedores(*)')
  .eq('email', userEmail)
  .single()

// Si rol = 'cliente' → usar usuario.cliente_id
// Si rol = 'vendedor' → usar usuario.vendedor_id
\`\`\`

---

## 8. ESTADOS Y VALORES PERMITIDOS

### Estados de pedidos:
- `pendiente` - Recién creado
- `en_preparacion` - Enviado a depósito
- `listo` - Preparado para envío
- `en_viaje` - Asignado a un viaje
- `entregado` - Entregado al cliente
- `cancelado` - Cancelado

### Estados de pagos:
- `pendiente` - Registrado desde CRM, esperando confirmación
- `confirmado` - Confirmado desde ERP, afecta cuenta corriente
- `rechazado` - Rechazado desde ERP

### Estados de devoluciones:
- `pendiente` - Registrada desde CRM, esperando confirmación
- `confirmado` - Confirmada desde ERP, afecta stock y cuenta corriente
- `rechazado` - Rechazada desde ERP

### Formas de pago:
- `efectivo`
- `transferencia`
- `cheque`
- `tarjeta`

### Formas de facturación:
- `factura` - Factura A/B
- `final` - Factura C / Consumidor Final
- `remito` - Solo remito sin factura

### Puntajes de cliente:
- `premium` - Cliente premium (mejores condiciones)
- `regular` - Cliente regular
- `riesgo` - Cliente con riesgo crediticio

---

## 9. FLUJO COMPLETO DE EJEMPLO

\`\`\`typescript
// 1. Usuario inicia sesión
const { data: { user } } = await supabase.auth.getUser()

// 2. Obtener datos del usuario CRM
const { data: usuarioCRM } = await supabase
  .from('usuarios_crm')
  .select('*, vendedor_id, cliente_id, rol')
  .eq('email', user.email)
  .single()

// 3. Si es vendedor, obtener sus clientes
if (usuarioCRM.rol === 'vendedor') {
  const response = await fetch(
    `${ERP_URL}/api/clientes?vendedor_id=${usuarioCRM.vendedor_id}`
  )
  const { clientes } = await response.json()
  
  // Mostrar lista de clientes con estado de cuenta
  clientes.forEach(cliente => {
    console.log(`${cliente.razon_social} - Saldo: $${cliente.estado_cuenta.saldo}`)
  })
}

// 4. Seleccionar un cliente y ver catálogo
const clienteSeleccionado = clientes[0]
const catalogoResponse = await fetch(
  `${ERP_URL}/api/precios/catalogo?cliente_id=${clienteSeleccionado.id}`
)
const { productos } = await catalogoResponse.json()

// 5. Crear pedido
const carrito = [
  { articulo_id: productos[0].id, cantidad: 2, es_bulto: true },
  { articulo_id: productos[1].id, cantidad: 10, es_bulto: false }
]

const pedidoResponse = await fetch(`${ERP_URL}/api/pedidos`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    cliente_id: clienteSeleccionado.id,
    vendedor_id: usuarioCRM.vendedor_id,
    items: carrito,
    observaciones: 'Entregar por la mañana'
  })
})

const { success, pedido } = await pedidoResponse.json()

if (success) {
  console.log(`Pedido #${pedido.numero_pedido} creado exitosamente!`)
}

// 6. Registrar un pago
const pagoResponse = await fetch(`${ERP_URL}/api/pagos`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    cliente_id: clienteSeleccionado.id,
    vendedor_id: usuarioCRM.vendedor_id,
    monto: 10000,
    forma_pago: 'efectivo',
    comprobante: 'REC-001'
  })
})

const { success: pagoSuccess, pago } = await pagoResponse.json()

if (pagoSuccess) {
  console.log(`Pago registrado. Estado: ${pago.estado} (pendiente de confirmación)`)
}
\`\`\`

---

## 10. NOTAS IMPORTANTES

1. **Todos los pagos y devoluciones registrados desde el CRM quedan en estado "pendiente"** hasta que el ERP los confirme.

2. **El stock se reserva al crear el pedido**, no al agregar al carrito.

3. **Los precios son dinámicos** y se calculan en tiempo real según el cliente.

4. **Cachear los datos** en el dispositivo por 1 hora para mejor performance.

5. **Validar stock antes de confirmar pedido** para evitar errores.

6. **Las condiciones temporales** (dirección, razón social) solo aplican para ese pedido específico, no modifican los datos del cliente en la BD.

---

**¿Dudas o necesitas más ejemplos? Avisame y te ayudo.**
