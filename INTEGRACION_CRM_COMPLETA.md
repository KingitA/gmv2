# 🔗 INTEGRACIÓN CRM - SISTEMA DE PRECIOS

## 📋 RESUMEN EJECUTIVO

El ERP calcula **TODOS** los precios y el CRM solo los consume y muestra. Esto garantiza:
- ✅ Una sola fuente de verdad
- ✅ Consistencia total de precios
- ✅ CRM más liviano y rápido
- ✅ Funciona perfecto en móviles con conexión limitada
- ✅ Fácil mantenimiento (cambios solo en el ERP)

---

## 🌐 ENDPOINT PRINCIPAL

### URL Base
\`\`\`
https://tu-dominio.vercel.app/api/precios/catalogo
\`\`\`

### Autenticación
El CRM y el ERP comparten la misma base de datos de Supabase, por lo que la autenticación es transparente.

---

## 👤 PARA CLIENTES

### Petición
\`\`\`http
GET /api/precios/catalogo?cliente_id={CLIENTE_ID}
\`\`\`

### Ejemplo de uso
\`\`\`javascript
// En el CRM, cuando el cliente inicia sesión
const clienteId = usuario.cliente_id // Obtenido de usuarios_crm

const response = await fetch(
  `https://tu-dominio.vercel.app/api/precios/catalogo?cliente_id=${clienteId}`
)

const data = await response.json()

// data.productos contiene TODOS los artículos con precio final calculado
console.log(data.productos)
\`\`\`

### Respuesta
\`\`\`json
{
  "success": true,
  "cliente_id": "uuid-del-cliente",
  "productos": [
    {
      "articulo_id": "uuid",
      "sku": "062483",
      "descripcion": "BARREHOJAS 40CM MAKE",
      "categoria": "PLASTICOS VARIOS",
      "proveedor": "YASH S.A.",
      "precio_final": 1250,
      "stock_disponible": 45,
      "activo": true
    }
    // ... más productos
  ],
  "total_productos": 150,
  "fecha_calculo": "2025-01-15T10:30:00.000Z"
}
\`\`\`

---

## 🚗 PARA VENDEDORES/VIAJANTES

### Petición
\`\`\`http
GET /api/precios/catalogo?vendedor_id={VENDEDOR_ID}
\`\`\`

### Ejemplo de uso
\`\`\`javascript
// En el CRM, cuando el vendedor inicia sesión
const vendedorId = usuario.vendedor_id // Obtenido de usuarios_crm

const response = await fetch(
  `https://tu-dominio.vercel.app/api/precios/catalogo?vendedor_id=${vendedorId}`
)

const data = await response.json()

// data.clientes contiene todos los clientes del vendedor con sus precios
console.log(data.clientes)
\`\`\`

### Respuesta
\`\`\`json
{
  "success": true,
  "vendedor_id": "uuid-del-vendedor",
  "clientes": [
    {
      "cliente_id": "uuid-cliente-1",
      "productos": [
        {
          "articulo_id": "uuid",
          "sku": "062483",
          "descripcion": "BARREHOJAS 40CM MAKE",
          "precio_final": 1250,
          "stock_disponible": 45
        }
        // ... más productos
      ]
    },
    {
      "cliente_id": "uuid-cliente-2",
      "productos": [...]
    }
  ],
  "total_clientes": 25,
  "fecha_calculo": "2025-01-15T10:30:00.000Z"
}
\`\`\`

---

## 🔍 MODO DEBUG (Opcional)

Si necesitás ver el desglose completo del cálculo de precios (para debugging o transparencia):

### Petición
\`\`\`http
GET /api/precios/catalogo?cliente_id={CLIENTE_ID}&incluir_desglose=true
\`\`\`

### Respuesta con desglose
\`\`\`json
{
  "articulo_id": "uuid",
  "sku": "062483",
  "descripcion": "BARREHOJAS 40CM MAKE",
  "precio_final": 1250,
  "desglose": {
    "paso1_costo_bruto": 850.50,
    "paso2_costo_final": 1029.11,
    "paso3_precio_base": 1050.62,
    "paso4_precio_venta": 1150.25,
    "paso5_precio_final": 1250,
    "descuentos": { "d1": 10, "d2": 5, "d3": 3, "d4": 2 },
    "tipo_descuento": "cascada",
    "ganancia_porcentaje": 20,
    "flete_venta_porcentaje": 3,
    "recargo_puntaje_porcentaje": 0,
    "comision_vendedor_porcentaje": 6,
    "impuestos_aplicados": "IVA 21% + Ret 3% + Perc 2%",
    "retira_deposito": false,
    "zona": "ZONA NORTE"
  }
}
\`\`\`

---

## 💾 RECOMENDACIONES DE CACHE

Para mejorar la experiencia en móviles:

### 1. Cache en el dispositivo
\`\`\`javascript
// Guardar en localStorage o AsyncStorage
const CACHE_KEY = `precios_${clienteId}`
const CACHE_DURATION = 1000 * 60 * 60 // 1 hora

async function obtenerPrecios(clienteId) {
  // Verificar cache
  const cached = localStorage.getItem(CACHE_KEY)
  if (cached) {
    const { data, timestamp } = JSON.parse(cached)
    if (Date.now() - timestamp < CACHE_DURATION) {
      return data
    }
  }

  // Si no hay cache o expiró, hacer petición
  const response = await fetch(`/api/precios/catalogo?cliente_id=${clienteId}`)
  const data = await response.json()

  // Guardar en cache
  localStorage.setItem(CACHE_KEY, JSON.stringify({
    data,
    timestamp: Date.now()
  }))

  return data
}
\`\`\`

### 2. Actualización en background
\`\`\`javascript
// Actualizar cache en background cuando hay conexión
if (navigator.onLine) {
  fetch(`/api/precios/catalogo?cliente_id=${clienteId}`)
    .then(res => res.json())
    .then(data => {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        data,
        timestamp: Date.now()
      }))
    })
}
\`\`\`

---

## 🎯 CASOS ESPECIALES

### Cliente retira en depósito
El precio ya viene calculado sin flete de venta (0%).

### Cliente con puntaje RIESGO o CRÍTICO
El precio ya incluye el recargo correspondiente (5% o 15%).

### Artículos sin stock
El campo `stock_disponible` indica la cantidad disponible. El CRM debe mostrar los artículos sin stock pero haciendolo notar con un cartel que diga "SIN STOCK".

### Precios con IVA incluido vs discriminado
El campo `impuestos_aplicados` (en modo debug) indica cómo se aplicaron los impuestos.

---

## 🔐 AUTENTICACIÓN Y VINCULACIÓN

### Flujo completo:

1. **Usuario se registra en el CRM** → Se crea en `usuarios_crm` con estado `pendiente_aprobacion`
2. **Administrador aprueba en el ERP** → Asigna rol (cliente/vendedor) y vincula con `cliente_id` o `vendedor_id`
3. **Usuario inicia sesión en el CRM** → Obtiene su `cliente_id` o `vendedor_id` de `usuarios_crm`
4. **CRM consulta precios** → Usa el ID vinculado para obtener precios del endpoint

### Tabla usuarios_crm:
\`\`\`sql
CREATE TABLE usuarios_crm (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  rol TEXT NOT NULL, -- 'vendedor' | 'cliente' | 'pendiente'
  estado TEXT NOT NULL, -- 'activo' | 'pendiente_aprobacion' | 'rechazado'
  cliente_id UUID REFERENCES clientes(id),
  vendedor_id UUID REFERENCES vendedores(id),
  fecha_registro TIMESTAMP DEFAULT NOW()
)
\`\`\`

---

## ✅ CHECKLIST DE INTEGRACIÓN

- [ ] Configurar URL del endpoint en el CRM
- [ ] Implementar autenticación con Supabase compartido
- [ ] Crear pantalla de catálogo de productos para clientes
- [ ] Crear pantalla de catálogo por cliente para vendedores
- [ ] Implementar cache local de precios
- [ ] Implementar actualización en background
- [ ] Agregar indicador de stock disponible
- [ ] Agregar búsqueda y filtros de productos
- [ ] Implementar carrito de compras
- [ ] Implementar creación de pedidos
- [ ] Probar con conexión lenta/intermitente
- [ ] Probar con diferentes tipos de clientes (premium, regular, riesgo, crítico)

---

## 🚀 PRÓXIMOS PASOS

1. **Crear pedidos**: Una vez que el cliente selecciona productos, el CRM debe enviar el pedido al ERP
2. **Sincronización de stock**: Considerar WebSockets o polling para actualizar stock en tiempo real
3. **Notificaciones**: Alertas cuando cambian precios o hay nuevos productos

---

## 📞 SOPORTE

Si tenés dudas sobre la integración, revisá:
1. Este documento
2. El código del endpoint en `app/api/precios/catalogo/route.ts`
3. La librería de cálculo en `lib/pricing.ts`
