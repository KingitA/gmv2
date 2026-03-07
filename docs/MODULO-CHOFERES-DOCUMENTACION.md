# DOCUMENTACIÓN COMPLETA - MÓDULO DE CHOFERES

## 1. INFORMACIÓN GENERAL

### URL Base del ERP
\`\`\`
https://v0-inventory-and-sales-system-five.vercel.app
\`\`\`

Variable de entorno: `NEXT_PUBLIC_ERP_URL`

---

## 2. ESTRUCTURA DE BASE DE DATOS

### Tabla: `viajes`
**Ubicación**: Supabase - Tabla `viajes`

**Columnas principales**:
- `id` (uuid) - Identificador único del viaje
- `nombre` (varchar) - Nombre del viaje (ej: "Olavarria 13/11")
- `fecha` (date) - Fecha de salida/entrega
- `chofer_id` (uuid) - FK a tabla `profiles` (usuario asignado como chofer)
- `chofer` (varchar) - Nombre del chofer (legacy, se mantiene por compatibilidad)
- `vehiculo` (varchar) - Patente o identificación del vehículo
- `estado` (varchar) - Estados: "pendiente", "en_viaje", "finalizado"
- `zona_id` (uuid) - FK a tabla `zonas`
- `transporte_id` (uuid) - FK a tabla `transportes` (si es transporte externo)
- `tipo_transporte` (varchar) - "propio" o "externo"
- `dinero_nafta` (numeric) - Dinero entregado al chofer para nafta
- `gastos_peon` (numeric) - Gastos de peón/ayudante
- `gastos_hotel` (numeric) - Gastos de pernoctada/hotel
- `gastos_adicionales` (numeric) - Otros gastos del viaje
- `porcentaje_flete` (numeric) - % de flete aplicado en este viaje
- `observaciones` (text) - Notas del viaje
- `created_at` (timestamp) - Fecha de creación

**Relaciones**:
- `chofer_id` → `profiles.id` (usuario del chofer)
- `zona_id` → `zonas.id` (zona de entrega)
- `transporte_id` → `transportes.id` (si es externo)

---

### Tabla: `pedidos`
**Ubicación**: Supabase - Tabla `pedidos`

**Columnas relevantes para viajes**:
- `id` (uuid) - Identificador del pedido
- `numero_pedido` (varchar) - Número legible (ej: "0001", "0002")
- `cliente_id` (uuid) - FK a `clientes`
- `viaje_id` (uuid) - FK a `viajes` (NULL si no está asignado)
- `vendedor_id` (uuid) - FK a `vendedores`
- `fecha` (date) - Fecha del pedido
- `estado` (varchar) - "pendiente", "preparado", "en_viaje", "entregado", "devuelto"
- `total` (numeric) - Total del pedido
- `subtotal` (numeric) - Subtotal sin impuestos
- `total_flete` (numeric) - Monto de flete
- `total_comision` (numeric) - Comisión del vendedor
- `total_impuestos` (numeric) - Impuestos calculados
- `prioridad` (integer) - Orden de preparación (1 es el próximo)
- `observaciones` (text) - Notas del pedido
- `usar_datos_temporales` (boolean) - Si usa dirección/razón social temporal
- `direccion_temp` (text) - Dirección de entrega temporal
- `razon_social_temp` (varchar) - Razón social temporal para facturación
- `forma_facturacion_temp` (varchar) - Forma de facturación temporal

**Relaciones**:
- `cliente_id` → `clientes.id`
- `viaje_id` → `viajes.id`
- `vendedor_id` → `vendedores.id`

---

### Tabla: `pedidos_detalle`
**Ubicación**: Supabase - Tabla `pedidos_detalle`

**Columnas**:
- `id` (uuid) - Identificador
- `pedido_id` (uuid) - FK a `pedidos`
- `articulo_id` (uuid) - FK a `articulos`
- `cantidad` (numeric) - Cantidad pedida
- `cantidad_preparada` (numeric) - Cantidad preparada en depósito
- `precio_final` (numeric) - Precio unitario final
- `subtotal` (numeric) - cantidad × precio_final
- `estado_item` (varchar) - Estado del item específico

**Para calcular bultos**:
- JOIN con `articulos.unidades_por_bulto`
- Bultos = `cantidad / unidades_por_bulto`

---

### Tabla: `clientes`
**Ubicación**: Supabase - Tabla `clientes`

**Columnas relevantes**:
- `id` (uuid) - Identificador
- `razon_social` (varchar) - Razón social
- `nombre` (varchar) - Nombre comercial
- `direccion` (text) - Dirección de entrega
- `localidad` (varchar) - Localidad (legacy)
- `localidad_id` (uuid) - FK a `localidades`
- `cuit` (varchar) - CUIT
- `activo` (boolean) - Si está activo

**Para obtener saldo del cliente**:
- Consultar tabla `comprobantes_venta` WHERE `cliente_id` = X
- **Saldo anterior**: Sumar `saldo_pendiente` de facturas con `fecha < fecha_pedido`
- **Saldo actual**: `total` del pedido del viaje actual

---

### Tabla: `comprobantes_venta`
**Ubicación**: Supabase - Tabla `comprobantes_venta`

**Columnas**:
- `id` (uuid)
- `cliente_id` (uuid) - FK a `clientes`
- `pedido_id` (uuid) - FK a `pedidos` (NULL si no hay pedido asociado)
- `numero_comprobante` (varchar) - Número de factura
- `fecha` (date) - Fecha de emisión
- `total_factura` (numeric) - Monto total
- `saldo_pendiente` (numeric) - Lo que falta pagar
- `estado_pago` (varchar) - "pendiente", "parcial", "pagado"
- `tipo_comprobante` (varchar) - "factura_a", "factura_b", "nota_credito"

---

### Tabla: `viajes_pagos`
**Ubicación**: Supabase - Tabla `viajes_pagos`

**Columnas**:
- `id` (uuid)
- `viaje_id` (uuid) - FK a `viajes`
- `pedido_id` (uuid) - FK a `pedidos` (opcional, para saber a qué pedido corresponde)
- `cliente_id` (uuid) - FK a `clientes`
- `forma_pago` (varchar) - "efectivo", "cheque", "transferencia"
- `monto` (numeric) - Monto del pago
- `fecha` (timestamp) - Fecha/hora del registro
- `banco` (varchar) - Nombre del banco (si es cheque o transferencia)
- `numero_cheque` (varchar) - Número de cheque
- `fecha_cheque` (date) - Fecha del cheque
- `referencia_transferencia` (varchar) - Referencia de la transferencia
- `registrado_por` (uuid) - FK a `profiles` (chofer que registró el pago)
- `observaciones` (text) - Notas
- `created_at` (timestamp)
- `updated_at` (timestamp)

**Uso**: Los choferes registran pagos aquí durante el viaje. Luego desde el ERP se confirman/imputan.

---

### Tabla: `devoluciones`
**Ubicación**: Supabase - Tabla `devoluciones`

**Columnas**:
- `id` (uuid)
- `pedido_id` (uuid) - FK a `pedidos`
- `cliente_id` (uuid) - FK a `clientes`
- `vendedor_id` (uuid) - FK a `vendedores`
- `estado` (varchar) - "pendiente", "confirmado", "rechazado"
- `fecha_confirmacion` (timestamp)
- `confirmado_por` (varchar) - Usuario que confirmó
- `monto_total` (numeric) - Total de la devolución
- `retira_viajante` (boolean) - Si el chofer retira la mercadería
- `observaciones` (text)
- `motivo_rechazo` (text) - Si fue rechazada
- `created_at` (timestamp)

---

### Tabla: `devoluciones_detalle`
**Ubicación**: Supabase - Tabla `devoluciones_detalle`

**Columnas**:
- `id` (uuid)
- `devolucion_id` (uuid) - FK a `devoluciones`
- `articulo_id` (uuid) - FK a `articulos`
- `cantidad` (numeric) - Cantidad devuelta
- `precio_venta_original` (numeric) - Precio al que se vendió
- `subtotal` (numeric) - cantidad × precio
- `fecha_venta_original` (date) - Fecha de la venta original
- `comprobante_venta_id` (uuid) - FK a `comprobantes_venta`

---

## 3. ENDPOINTS DEL API

### ⚠️ IMPORTANTE: NO EXISTEN ENDPOINTS PARA VIAJES

**Necesitás crear los siguientes endpoints**:

#### 1. GET `/api/viajes?chofer_id=X`
**Descripción**: Obtener viajes asignados a un chofer
**Parámetros**: `chofer_id` (query)
**Respuesta esperada**:
\`\`\`json
[
  {
    "id": "uuid",
    "nombre": "Olavarria 13/11",
    "fecha": "2025-01-13",
    "estado": "en_viaje",
    "vehiculo": "ABC123",
    "dinero_nafta": 50000,
    "zona": {
      "nombre": "Olavarria",
      "costo_nafta": 80000,
      "costo_pernoctada": 25000
    },
    "pedidos_count": 5,
    "total_facturado": 350000
  }
]
\`\`\`

#### 2. GET `/api/viajes/[id]`
**Descripción**: Obtener detalle completo de un viaje con sus pedidos
**Respuesta esperada**:
\`\`\`json
{
  "id": "uuid",
  "nombre": "Olavarria 13/11",
  "fecha": "2025-01-13",
  "estado": "en_viaje",
  "vehiculo": "ABC123",
  "chofer_id": "uuid",
  "pedidos": [
    {
      "id": "uuid",
      "numero": "0001",
      "cliente": {
        "nombre": "CARDOZO JORGE",
        "direccion": "Av. Principal 123",
        "cuit": "30-71022924-0"
      },
      "bultos": 15,
      "saldo_anterior": 50000,
      "saldo_actual": 125000,
      "estado": "pendiente"
    }
  ],
  "resumen_pagos": {
    "efectivo": 120000,
    "cheques": 2,
    "transferencias": 1
  }
}
\`\`\`

#### 3. POST `/api/viajes/[id]/pagos`
**Descripción**: Registrar un pago durante el viaje
**Body**:
\`\`\`json
{
  "pedido_id": "uuid",
  "cliente_id": "uuid",
  "forma_pago": "efectivo",
  "monto": 50000,
  "banco": "Banco Nación",
  "numero_cheque": "12345678",
  "fecha_cheque": "2025-01-20",
  "observaciones": "Pago parcial"
}
\`\`\`

#### 4. POST `/api/viajes/[id]/devoluciones`
**Descripción**: Registrar una devolución durante el viaje
**Body**:
\`\`\`json
{
  "pedido_id": "uuid",
  "cliente_id": "uuid",
  "items": [
    {
      "articulo_id": "uuid",
      "cantidad": 5,
      "motivo": "Vencido"
    }
  ],
  "observaciones": "Cliente rechazó por vencimiento"
}
\`\`\`

#### 5. PATCH `/api/viajes/[id]/pedidos/[pedido_id]/estado`
**Descripción**: Actualizar estado de un pedido (cuando lo entrega el chofer)
**Body**:
\`\`\`json
{
  "estado": "entregado",
  "observaciones": "Entregado sin novedades"
}
\`\`\`

---

## 4. ENDPOINTS EXISTENTES QUE PODÉS USAR

### GET `/api/pedidos/[id]`
**Ubicación**: `app/api/pedidos/[id]/route.ts`
**Uso**: Obtener detalle completo de un pedido

### PUT `/api/pedidos/[id]`
**Ubicación**: `app/api/pedidos/[id]/route.ts`
**Uso**: Modificar un pedido pendiente (solo antes de asignarlo a viaje)

### GET `/api/cuenta-corriente?cliente_id=X`
**Ubicación**: `app/api/cuenta-corriente/route.ts`
**Uso**: Obtener saldo completo del cliente (comprobantes + pagos + pedidos)

### GET `/api/pedidos/[id]/facturas`
**Ubicación**: `app/api/pedidos/[id]/facturas/route.ts`
**Uso**: Obtener facturas asociadas a un pedido con sus pagos imputados

---

## 5. CÁLCULOS IMPORTANTES

### Cálculo de Bultos por Pedido
\`\`\`sql
SELECT 
  pd.pedido_id,
  SUM(CEILING(pd.cantidad / COALESCE(a.unidades_por_bulto, 1))) as total_bultos
FROM pedidos_detalle pd
JOIN articulos a ON a.id = pd.articulo_id
WHERE pd.pedido_id = 'X'
GROUP BY pd.pedido_id
\`\`\`

### Cálculo de Saldo Anterior del Cliente
\`\`\`sql
SELECT 
  COALESCE(SUM(saldo_pendiente), 0) as saldo_anterior
FROM comprobantes_venta
WHERE 
  cliente_id = 'X'
  AND fecha < (SELECT fecha FROM pedidos WHERE id = 'pedido_id')
\`\`\`

### Cálculo de Saldo Actual
\`\`\`sql
SELECT total FROM pedidos WHERE id = 'pedido_id'
\`\`\`

### Resumen de Pagos del Viaje
\`\`\`sql
SELECT 
  forma_pago,
  COUNT(*) as cantidad,
  SUM(monto) as total
FROM viajes_pagos
WHERE viaje_id = 'X'
GROUP BY forma_pago
\`\`\`

---

## 6. FLUJO DEL MÓDULO DE CHOFERES

### 1. Login del Chofer
- El chofer entra con su usuario (tabla `profiles`)
- El sistema busca su `chofer_id` vinculado

### 2. Ver Viajes Asignados
- GET `/api/viajes?chofer_id=X`
- Muestra lista de viajes: nombre, fecha, estado, cantidad de pedidos

### 3. Entrar a un Viaje
- GET `/api/viajes/[id]`
- Muestra:
  - Lista de pedidos con cliente, dirección, bultos, saldos
  - Resumen de pagos acumulados
  - Botón para registrar pagos
  - Botón para registrar devoluciones
  - Marcar pedido como entregado

### 4. Registrar Pago
- POST `/api/viajes/[id]/pagos`
- Formulario: cliente, monto, forma de pago, datos de cheque/transferencia
- Se guarda en `viajes_pagos` (pendiente de confirmación en ERP)

### 5. Registrar Devolución
- POST `/api/viajes/[id]/devoluciones`
- Selecciona pedido y artículos a devolver
- Se guarda en `devoluciones` y `devoluciones_detalle`

### 6. Marcar Pedido como Entregado
- PATCH `/api/viajes/[id]/pedidos/[pedido_id]/estado`
- Cambia estado de "en_viaje" a "entregado"

### 7. Ver Estadísticas (Filtrado por Fecha)
- GET `/api/choferes/estadisticas?chofer_id=X&mes=2025-01`
- Devuelve:
  - Total de viajes
  - Kilómetros recorridos (calculado por zonas)
  - Pernoctadas (basado en `gastos_hotel` > 0)
  - Total facturado entregado
  - Cantidad de pedidos entregados

---

## 7. ESTRUCTURA SUGERIDA PARA EL MÓDULO

\`\`\`
/app-choferes
  /login - Autenticación
  /dashboard - Resumen general
  /viajes - Lista de viajes asignados
  /viajes/[id] - Detalle del viaje con pedidos
  /viajes/[id]/pago - Registrar pago
  /viajes/[id]/devolucion - Registrar devolución
  /estadisticas - Estadísticas filtradas por fecha
\`\`\`

---

## 8. DATOS ADICIONALES

### Estados de Pedidos
- `pendiente` - Creado, no preparado
- `preparado` - Listo en depósito
- `en_viaje` - Asignado a viaje, en camino
- `entregado` - Entregado al cliente
- `devuelto` - Devuelto por el cliente

### Estados de Viajes
- `pendiente` - Creado, no salió
- `en_viaje` - En ruta
- `finalizado` - Completado, todo entregado

### Formas de Pago
- `efectivo`
- `cheque`
- `transferencia`
- `cuenta_corriente` (no se cobra en el viaje)

---

## 9. CONSIDERACIONES IMPORTANTES

1. **El chofer NO puede modificar pedidos**, solo registrar pagos, devoluciones y entregas
2. **Los pagos se confirman desde el ERP**, el chofer solo los registra
3. **Las devoluciones se confirman desde el ERP**, el chofer solo las registra
4. **El saldo anterior NO incluye el pedido actual**, solo facturas anteriores
5. **Los bultos se calculan dividiendo cantidad por unidades_por_bulto** del artículo
6. **El módulo debe funcionar OFFLINE** y sincronizar cuando haya conexión (considerar esto en el diseño)

---

## 10. PRÓXIMOS PASOS

1. Crear los endpoints faltantes de viajes
2. Crear autenticación para choferes (puede usar la misma de Supabase)
3. Diseñar UI mobile-first (los choferes usan celular/tablet)
4. Implementar sincronización offline (Progressive Web App)
5. Agregar escaneo de código de barras para confirmar entregas
6. Implementar notificaciones push para el ERP cuando se registren pagos/devoluciones

---

**Documento creado**: 2025-01-11  
**Versión**: 1.0  
**Autor**: v0 AI Assistant
