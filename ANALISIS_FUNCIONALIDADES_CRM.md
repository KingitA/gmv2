# ANÁLISIS COMPLETO - FUNCIONALIDADES CRM

## 📋 RESUMEN EJECUTIVO

Este documento analiza punto por punto las funcionalidades solicitadas para el CRM y determina qué endpoints y desarrollos faltan en el ERP.

---

## 1️⃣ PANTALLA PRINCIPAL DEL VENDEDOR

### Lo que necesita el CRM:
- ✅ Botón "Realizar pedido"
- ✅ Botón "Mis ventas"
- ✅ Planilla de clientes con filtros (zona, dirección, nombre)
- ✅ Estado de cuenta corriente (libre de deuda, pago pendiente, pago vencido)
- ✅ Botón para acceder a cuenta corriente de cada cliente

### Datos necesarios del ERP:
- Lista de clientes del vendedor con estado de cuenta
- Saldo actual, pagos pendientes, pagos vencidos por cliente

### ❌ FALTA DESARROLLAR EN EL ERP:

**Endpoint: `GET /api/clientes?vendedor_id=xxx`**

Debe retornar:
\`\`\`json
{
  "clientes": [
    {
      "id": "uuid",
      "nombre": "SUPERMERCADO LA ESQUINA",
      "direccion": "Av. Libertador 1234",
      "localidad": "San Miguel de Tucumán",
      "zona": "Zona Norte",
      "estado_cuenta": "pago_pendiente",
      "saldo_actual": -15000,
      "facturas_vencidas": 2,
      "dias_mora": 15
    }
  ]
}
\`\`\`

**Estados de cuenta:**
- `libre_deuda`: Saldo = 0
- `pago_pendiente`: Saldo < 0 pero sin facturas vencidas
- `pago_vencido`: Tiene facturas vencidas

---

## 2️⃣ CUENTA CORRIENTE DEL CLIENTE

### Lo que necesita el CRM:
- ✅ Ver pedidos del cliente
- ✅ Ver comprobantes del cliente
- ✅ Ver pagos del cliente
- ✅ Ingresar nuevos pagos
- ✅ Generar devoluciones
- ✅ Consultar mercadería vendida (filtros: fecha, pedido, artículo)

### ❌ FALTA DESARROLLAR EN EL ERP:

#### **Endpoint: `GET /api/cuenta-corriente?cliente_id=xxx`**

Debe retornar:
\`\`\`json
{
  "cliente": {
    "id": "uuid",
    "nombre": "SUPERMERCADO LA ESQUINA",
    "saldo_actual": -15000
  },
  "movimientos": [
    {
      "id": "uuid",
      "fecha": "2025-01-15",
      "tipo": "factura",
      "numero": "0001-00001234",
      "debe": 15000,
      "haber": 0,
      "saldo": -15000,
      "estado": "pendiente",
      "fecha_vencimiento": "2025-02-15"
    },
    {
      "id": "uuid",
      "fecha": "2025-01-10",
      "tipo": "pago",
      "numero": "REC-0042",
      "debe": 0,
      "haber": 10000,
      "saldo": 0,
      "estado": "aplicado"
    }
  ],
  "resumen": {
    "total_debe": 15000,
    "total_haber": 10000,
    "saldo_actual": -15000,
    "facturas_pendientes": 1,
    "facturas_vencidas": 0
  }
}
\`\`\`

#### **Endpoint: `POST /api/pagos`**

Debe recibir:
\`\`\`json
{
  "cliente_id": "uuid",
  "fecha_pago": "2025-01-20",
  "monto_total": 15000,
  "observaciones": "Pago en efectivo",
  "detalles": [
    {
      "tipo_pago": "efectivo",
      "monto": 10000
    },
    {
      "tipo_pago": "cheque",
      "monto": 5000,
      "numero_cheque": "12345678",
      "banco": "Banco Macro",
      "fecha_cheque": "2025-01-25"
    }
  ],
  "imputaciones": [
    {
      "comprobante_id": "uuid",
      "monto_imputado": 15000
    }
  ]
}
\`\`\`

Debe retornar:
\`\`\`json
{
  "success": true,
  "pago": {
    "id": "uuid",
    "numero_recibo": "REC-0043",
    "monto_total": 15000
  }
}
\`\`\`

#### **Endpoint: `GET /api/mercaderia-vendida?cliente_id=xxx&fecha_desde=xxx&fecha_hasta=xxx&articulo=xxx`**

Debe retornar:
\`\`\`json
{
  "ventas": [
    {
      "fecha": "2024-12-15",
      "comprobante": "0001-00001200",
      "pedido": "0035",
      "articulo": {
        "id": "uuid",
        "sku": "062483",
        "descripcion": "SHAMPOO DOVE 400ML"
      },
      "cantidad": 12,
      "precio_unitario": 100,
      "subtotal": 1200
    }
  ]
}
\`\`\`

---

## 3️⃣ REALIZAR PEDIDO

### Lo que necesita el CRM:
- ✅ Buscar entre clientes del vendedor
- ✅ Botón "Cliente nuevo"
- ✅ Cambiar condiciones de venta (facturación, dirección, razón social)
- ✅ Opción: guardar cambios permanentes o solo para este pedido
- ✅ Buscar artículos con precio y unidades por bulto
- ✅ Ingresar cantidad (unidades o bultos)
- ✅ Ver total del pedido en tiempo real

### ✅ YA EXISTE:
- `GET /api/precios/catalogo?cliente_id=xxx` (catálogo con precios)
- `POST /api/pedidos` (crear pedido)

### ❌ FALTA DESARROLLAR EN EL ERP:

#### **Endpoint: `POST /api/clientes`**

Debe recibir:
\`\`\`json
{
  "vendedor_id": "uuid",
  "nombre": "NUEVO CLIENTE S.A.",
  "cuit": "20-12345678-9",
  "razon_social": "NUEVO CLIENTE SOCIEDAD ANONIMA",
  "direccion": "Calle Falsa 123",
  "localidad_id": "uuid",
  "telefono": "381-1234567",
  "mail": "cliente@email.com",
  "condicion_iva": "responsable_inscripto",
  "condicion_pago": "cuenta_corriente",
  "metodo_facturacion": "factura_a"
}
\`\`\`

Debe retornar:
\`\`\`json
{
  "success": true,
  "cliente": {
    "id": "uuid",
    "nombre": "NUEVO CLIENTE S.A."
  }
}
\`\`\`

#### **Endpoint: `PATCH /api/clientes/:id`**

Debe recibir:
\`\`\`json
{
  "direccion": "Nueva Dirección 456",
  "razon_social": "NUEVA RAZON SOCIAL",
  "metodo_facturacion": "remito"
}
\`\`\`

Debe retornar:
\`\`\`json
{
  "success": true,
  "cliente": {
    "id": "uuid",
    "nombre": "CLIENTE ACTUALIZADO"
  }
}
\`\`\`

#### **Modificar: `POST /api/pedidos`**

Agregar soporte para condiciones temporales:
\`\`\`json
{
  "cliente_id": "uuid",
  "vendedor_id": "uuid",
  "items": [...],
  "condiciones_temporales": {
    "direccion": "Dirección temporal solo para este pedido",
    "razon_social": "Razón social temporal",
    "metodo_facturacion": "remito"
  }
}
\`\`\`

### ✅ YA EXISTE EN LA BD:
- Campo `unidades_por_bulto` en tabla `articulos`

---

## 4️⃣ GESTIONAR DEVOLUCIONES

### Lo que necesita el CRM:
- ✅ Buscar artículos facturados previamente al cliente
- ✅ Ver fecha de facturación y precio de venta
- ✅ Seleccionar artículo y cantidad a devolver
- ✅ Indicar si lo retira el viajante o se queda en el cliente
- ✅ Generar orden de devolución

### ❌ FALTA DESARROLLAR EN EL ERP:

#### **Endpoint: `GET /api/articulos-vendidos?cliente_id=xxx&busqueda=xxx`**

Debe retornar:
\`\`\`json
{
  "articulos_vendidos": [
    {
      "articulo": {
        "id": "uuid",
        "sku": "062483",
        "descripcion": "SHAMPOO DOVE 400ML"
      },
      "ultima_venta": {
        "fecha": "2024-12-15",
        "comprobante": "0001-00001200",
        "cantidad": 12,
        "precio_unitario": 100
      },
      "total_vendido_6_meses": 120
    }
  ]
}
\`\`\`

#### **Endpoint: `POST /api/devoluciones`**

Debe recibir:
\`\`\`json
{
  "cliente_id": "uuid",
  "vendedor_id": "uuid",
  "items": [
    {
      "articulo_id": "uuid",
      "cantidad": 12,
      "precio_unitario": 100,
      "comprobante_referencia": "0001-00001200"
    }
  ],
  "ubicacion_mercaderia": "viajante",
  "motivo": "Producto vencido",
  "observaciones": "Retirado por el viajante"
}
\`\`\`

Debe retornar:
\`\`\`json
{
  "success": true,
  "devolucion": {
    "id": "uuid",
    "numero": "DEV-0042",
    "total": 1200
  }
}
\`\`\`

### ✅ YA EXISTE EN LA BD:
- Tabla `reclamos_devoluciones`

---

## 5️⃣ MIS VENTAS

### Lo que necesita el CRM:
- ✅ Ver pedidos pendientes del vendedor
- ✅ Ver historial de pedidos enviados

### ❌ FALTA DESARROLLAR EN EL ERP:

#### **Endpoint: `GET /api/pedidos?vendedor_id=xxx&estado=xxx`**

Debe retornar:
\`\`\`json
{
  "pedidos": [
    {
      "id": "uuid",
      "numero_pedido": "0042",
      "fecha": "2025-01-20",
      "cliente": {
        "id": "uuid",
        "nombre": "SUPERMERCADO LA ESQUINA"
      },
      "estado": "pendiente",
      "total": 15750,
      "items_count": 15
    }
  ]
}
\`\`\`

**Estados posibles:**
- `pendiente`: Recién creado desde CRM
- `en_preparacion`: Enviado a depósito
- `listo`: Preparado para envío
- `en_viaje`: Asignado a un viaje
- `entregado`: Entregado al cliente
- `cancelado`: Cancelado

---

## 📊 RESUMEN DE ENDPOINTS A CREAR

| Endpoint | Método | Descripción | Prioridad |
|----------|--------|-------------|-----------|
| `/api/clientes?vendedor_id=xxx` | GET | Lista de clientes con estado de cuenta | 🔴 ALTA |
| `/api/clientes` | POST | Crear nuevo cliente | 🔴 ALTA |
| `/api/clientes/:id` | PATCH | Actualizar datos del cliente | 🟡 MEDIA |
| `/api/cuenta-corriente?cliente_id=xxx` | GET | Movimientos y saldo de cuenta corriente | 🔴 ALTA |
| `/api/pagos` | POST | Registrar nuevo pago | 🔴 ALTA |
| `/api/pedidos?vendedor_id=xxx` | GET | Lista de pedidos del vendedor | 🔴 ALTA |
| `/api/mercaderia-vendida?cliente_id=xxx` | GET | Historial de mercadería vendida | 🟡 MEDIA |
| `/api/articulos-vendidos?cliente_id=xxx` | GET | Artículos vendidos para devoluciones | 🟡 MEDIA |
| `/api/devoluciones` | POST | Crear orden de devolución | 🟡 MEDIA |

---

## 🗄️ CAMBIOS EN BASE DE DATOS

### ✅ YA EXISTEN:
- Tabla `articulos` con campo `unidades_por_bulto`
- Tabla `reclamos_devoluciones`
- Tabla `comprobantes_venta`
- Tabla `pagos_detalle`
- Tabla `imputaciones`

### ❌ FALTA CREAR:

#### **Tabla `pagos_clientes`**

\`\`\`sql
CREATE TABLE pagos_clientes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cliente_id UUID REFERENCES clientes(id),
  fecha_pago DATE NOT NULL,
  monto_total NUMERIC(10,2) NOT NULL,
  numero_recibo VARCHAR(50),
  observaciones TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
\`\`\`

#### **Agregar campos a `pedidos`**

\`\`\`sql
ALTER TABLE pedidos ADD COLUMN direccion_temporal TEXT;
ALTER TABLE pedidos ADD COLUMN razon_social_temporal VARCHAR(255);
ALTER TABLE pedidos ADD COLUMN metodo_facturacion_temporal VARCHAR(50);
\`\`\`

---

## 🎯 PLAN DE DESARROLLO RECOMENDADO

### FASE 1 - FUNCIONALIDADES CRÍTICAS (Prioridad ALTA)
1. ✅ Crear endpoint `GET /api/clientes?vendedor_id=xxx`
2. ✅ Crear endpoint `GET /api/cuenta-corriente?cliente_id=xxx`
3. ✅ Crear endpoint `POST /api/pagos`
4. ✅ Crear endpoint `GET /api/pedidos?vendedor_id=xxx`
5. ✅ Crear endpoint `POST /api/clientes`

### FASE 2 - FUNCIONALIDADES SECUNDARIAS (Prioridad MEDIA)
6. ✅ Crear endpoint `PATCH /api/clientes/:id`
7. ✅ Crear endpoint `GET /api/mercaderia-vendida?cliente_id=xxx`
8. ✅ Crear endpoint `GET /api/articulos-vendidos?cliente_id=xxx`
9. ✅ Crear endpoint `POST /api/devoluciones`
10. ✅ Modificar `POST /api/pedidos` para soportar condiciones temporales

---

## ✅ CHECKLIST FINAL

- [ ] Crear tabla `pagos_clientes`
- [ ] Agregar campos temporales a tabla `pedidos`
- [ ] Crear 9 endpoints nuevos
- [ ] Modificar endpoint `POST /api/pedidos`
- [ ] Documentar todos los endpoints para el CRM
- [ ] Probar integración completa

---

**Tiempo estimado de desarrollo:** 8-12 horas
**Complejidad:** Media-Alta
