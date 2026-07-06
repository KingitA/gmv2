# CONTRATO API — Módulo Viajantes (Cobranzas en la calle)

> **Para la sesión que desarrolla la UI del viajante.** Este documento es el contrato
> congelado de los endpoints backend. Los shapes de request/response NO van a cambiar;
> lo que puede cambiar es la fecha en que cada endpoint queda operativo (columna Estado).
> Fuente: plan aprobado "Sistema de Cobranzas + Cajas" (Fases C y E).
> Última actualización: 2026-07-06.

## Modelo mental

El viajante es el espejo del chofer, sin viaje:

1. Ve **sus clientes** con saldo real de cuenta corriente.
2. Abre un cliente y ve **los comprobantes con saldo** (FA/ND/PRES) para elegir cuáles afectar.
3. Registra un **cobro** (uno o varios métodos de pago; puede descontar una devolución
   en el momento; puede imputar UN pago físico a VARIOS clientes).
4. El cobro nace `pendiente_rendicion` y suma a su **billetera** (plata en la calle).
5. Puede **corregir o eliminar** un cobro mientras esté `pendiente_rendicion`.
6. **Rinde**: entrega efectivo y cheques físicos en oficina; la rendición confirma
   los pagos en lote (segunda firma), vacía la billetera y mueve el dinero a la caja.
   Transferencias/e-cheqs no entran a caja: van a conciliación bancaria (oficina).

### Doble verificación (visible SIEMPRE en la UI)

Todo pago tiene dos firmas:
- **Firma 1** (`creado_por`): el viajante que cobró.
- **Firma 2** (`verificado_por`): quien confirmó la rendición / concilió la transferencia.

La UI debe mostrar en todo momento el badge del pago:

| `estado` | `verificado` | Badge sugerido |
|---|---|---|
| `pendiente_rendicion` | `false` | 🟡 Sin rendir |
| `confirmado` | `false` | 🔵 Rendido, sin verificar (solo transferencias en conciliación) |
| `confirmado` | `true` | 🟢 Verificado |
| `rechazado` | — | 🔴 Rechazado |
| `anulado` | — | ⚫ Anulado |

## Autenticación y identidad

- Sesión Supabase normal (cookie); middleware ya protege las rutas.
- Rol requerido: `vendedor` (viajante). El backend **resuelve el viajante desde la
  sesión** — la UI NUNCA envía `viajante_id`; se infiere del usuario autenticado.
- Errores estándar: `401` sin sesión, `403` rol incorrecto, `404` recurso ajeno/inexistente,
  `400` validación (body `{ "error": string }`).

## Endpoints

### Estado de implementación

| # | Endpoint | Estado |
|---|---|---|
| 1 | `GET /api/viajante/clientes` | ⏳ Fase E |
| 2 | `GET /api/viajante/cliente/[id]/cc` | ⏳ Fase E |
| 3 | `POST /api/viajante/cobro` | ⏳ Fase E |
| 4 | `PATCH /api/viajante/cobro/[id]` | ⏳ Fase E |
| 5 | `DELETE /api/viajante/cobro/[id]` | ⏳ Fase E |
| 6 | `POST /api/viajante/devolucion` | ⏳ Fase E |
| 7 | `GET /api/viajante/billetera` | ✅ equivalente vivo hoy (`GET /api/chofer/billetera`), espejo en Fase E |
| 8 | `POST /api/viajante/rendir` | ⏳ Fase E (depende de `rendiciones`, Fase C) |
| 9 | `GET /api/viajante/rendiciones` | ⏳ Fase E |
| 10 | `POST /api/pagos-clientes/ocr` | ✅ vivo hoy (reusable tal cual) |

> La UI puede desarrollarse completa contra este contrato usando mocks;
> cuando Fase E se pushee, los endpoints responden con estos shapes exactos.

---

### 1. `GET /api/viajante/clientes`

Clientes asignados al viajante con su saldo real (libro mayor, `v_saldo_clientes`).

**Query params:** `?q=` (búsqueda opcional por nombre/cuit)

**Response 200:**
```json
{
  "clientes": [
    {
      "id": "uuid",
      "nombre": "string",
      "cuit": "string|null",
      "localidad": "string|null",
      "condicion_pago": "string|null",
      "saldo_actual": 123456.78,
      "pagos_sin_rendir": 2
    }
  ]
}
```
`saldo_actual` > 0 = el cliente debe. `pagos_sin_rendir` = pagos de este viajante en `pendiente_rendicion`.

---

### 2. `GET /api/viajante/cliente/[id]/cc`

Cuenta corriente del cliente para seleccionar comprobantes a afectar.

**Response 200:**
```json
{
  "cliente": { "id": "uuid", "nombre": "string", "saldo_actual": 123456.78 },
  "comprobantes": [
    {
      "id": "uuid",
      "tipo_comprobante": "FA|FB|ND|NDA|NDB|PRES",
      "numero_comprobante": "0007-00000123",
      "fecha": "2026-07-01",
      "total_factura": 100000.0,
      "saldo_pendiente": 40000.0,
      "estado_pago": "pendiente|parcial",
      "pedido_id": "uuid|null"
    }
  ],
  "pagos_recientes": [
    {
      "id": "uuid",
      "fecha_pago": "2026-07-01",
      "monto": 50000.0,
      "estado": "pendiente_rendicion|confirmado|anulado|rechazado",
      "verificado": false,
      "numero_recibo": "REC-0001-00000011|null"
    }
  ]
}
```
Solo lista comprobantes con `saldo_pendiente > 0`, ordenados por fecha (FIFO).

---

### 3. `POST /api/viajante/cobro`

Registra un cobro. **Un solo shape para cliente único y multi-cliente**: `clientes[]`
siempre es array (1 elemento = caso simple). Los métodos de pago son del cobro FÍSICO
total; las imputaciones dicen cómo se reparte entre clientes/comprobantes.

**Request:**
```json
{
  "clientes": [
    {
      "cliente_id": "uuid",
      "imputaciones": [
        { "comprobante_id": "uuid", "monto": 25000.0 }
      ],
      "pago_a_cuenta": 0,
      "devolucion": {
        "devolucion_id": "uuid",
        "monto_descontado": 5000.0
      }
    }
  ],
  "metodos": [
    {
      "tipo": "efectivo|cheque|transferencia",
      "monto": 25000.0,
      "banco": "string|null",
      "numero_cheque": "string|null",
      "fecha_cheque": "YYYY-MM-DD|null",
      "es_echeq": false,
      "color": "BLANCO|NEGRO|null",
      "referencia_transferencia": "string|null",
      "cuenta_bancaria_id": "uuid|null"
    }
  ],
  "comprobante_urls": ["https://...storage.../foto1.jpg"],
  "observaciones": "string|null"
}
```

Reglas de validación (las aplica el backend, la UI debe pre-validar):
- `Σ metodos.monto == Σ clientes(Σ imputaciones.monto + pago_a_cuenta − devolucion.monto_descontado)`
- `imputaciones.monto ≤ saldo_pendiente` del comprobante.
- `devolucion.devolucion_id` debe ser una devolución `pendiente` del mismo cliente
  (creada antes vía endpoint 6). El pago registra el neto; cuando depósito confirma
  la devolución, la NC se imputa automáticamente contra los comprobantes.
- `cheque` requiere `banco`, `numero_cheque`, `fecha_cheque`; `transferencia`
  requiere `cuenta_bancaria_id` (destino) y opcional `referencia_transferencia`.

**Response 201:**
```json
{
  "success": true,
  "cobranza_id": "uuid|null",
  "pagos": [
    { "pago_id": "uuid", "cliente_id": "uuid", "monto": 25000.0, "estado": "pendiente_rendicion" }
  ],
  "billetera_saldo": 275000.0
}
```
`cobranza_id` viene cuando hay más de un cliente (cabecera multi-cliente).
Todos los pagos nacen `pendiente_rendicion` y suman a la billetera del viajante.

---

### 4. `PATCH /api/viajante/cobro/[pagoId]`

Corrige un cobro propio **mientras esté `pendiente_rendicion`** y su rendición no
esté confirmada. Body: mismo shape que POST (solo los campos a modificar; el backend
reversa y re-registra internamente).

**Response 200:** igual a POST. **409** si ya fue rendido/confirmado.

### 5. `DELETE /api/viajante/cobro/[pagoId]`

Elimina (anula) un cobro propio `pendiente_rendicion`. Revierte billetera y cheques.

**Response 200:** `{ "success": true }`. **409** si ya fue rendido/confirmado.

---

### 6. `POST /api/viajante/devolucion`

Registra una devolución en la calle (queda `pendiente` hasta confirmación física de depósito).

**Request:**
```json
{
  "cliente_id": "uuid",
  "pedido_id": "uuid|null",
  "items": [
    {
      "articulo_id": "uuid",
      "cantidad": 2,
      "precio_venta_original": 1500.0,
      "comprobante_venta_id": "uuid|null",
      "motivo": "string",
      "condicion": "vendible|dañado|mal_uso|cambio"
    }
  ],
  "observaciones": "string|null"
}
```

**Response 201:**
```json
{
  "success": true,
  "devolucion_id": "uuid",
  "numero_devolucion": "DEV-00014",
  "monto_total": 3000.0,
  "estado": "pendiente"
}
```
El `devolucion_id` se puede usar en el mismo momento como descuento de un cobro (endpoint 3).

---

### 7. `GET /api/viajante/billetera`

Saldo y movimientos de la billetera del viajante autenticado.

**Response 200:**
```json
{
  "saldo": 275000.0,
  "desglose": {
    "efectivo": 200000.0,
    "cheques": 75000.0
  },
  "movimientos": [
    {
      "id": "uuid",
      "tipo": "cobro_cliente|retiro_comision|debito|credito",
      "medio": "efectivo|cheque|transferencia|null",
      "monto": 25000.0,
      "concepto": "string",
      "fecha": "ISO-8601",
      "referencia_tipo": "pago_cliente|rendicion|pago_anulacion|null",
      "referencia_id": "uuid|null"
    }
  ],
  "comisiones_pendientes": 45000.0
}
```

---

### 8. `POST /api/viajante/rendir`

Abre/presenta la rendición: declara el efectivo contado y lista los pagos a rendir.
La CONFIRMACIÓN la hace oficina (segunda firma) desde el ERP — el viajante solo declara.

**Request:**
```json
{
  "pago_ids": ["uuid"],
  "efectivo_declarado": 200000.0,
  "observaciones": "string|null"
}
```
Si `pago_ids` se omite → todos los `pendiente_rendicion` del viajante.

**Response 201:**
```json
{
  "success": true,
  "rendicion_id": "uuid",
  "estado": "abierta",
  "efectivo_registrado": 200000.0,
  "efectivo_declarado": 200000.0,
  "diferencia": 0.0,
  "items": [
    { "pago_id": "uuid", "cliente_nombre": "string", "monto": 25000.0, "metodo_resumen": "efectivo" }
  ]
}
```
Cuando oficina confirma (`rendicion_confirmar`, Fase C): cada pago pasa a
`confirmado` con `verificado_por` = confirmador, la billetera se descuenta,
el efectivo entra a la caja elegida (kardex `RENDICION_VIAJE`), los cheques quedan
en cartera de oficina y las transferencias pasan a conciliación.

### 9. `GET /api/viajante/rendiciones`

Historial: `{ "rendiciones": [{ "id", "fecha", "estado": "abierta|confirmada", "efectivo_declarado", "diferencia", "cantidad_pagos", "confirmado_at" }] }`

---

### 10. `POST /api/pagos-clientes/ocr` (vivo hoy)

Sube foto de cheque/transferencia y devuelve datos detectados por IA.
`multipart/form-data` con `files[]`. Response: `{ "resultados": [{ "tipo", "banco", "numero", "monto", "fecha", "url" }] }`.
Las URLs devueltas se pasan en `comprobante_urls` del cobro.

---

## Tablas involucradas (referencia backend)

| Concepto | Tabla | Nota |
|---|---|---|
| Pago | `pagos_clientes` | `cobrador_tipo='viajante'`, estados arriba |
| Detalle por método | `pagos_detalle` | 1 fila por método |
| Reparto a comprobantes | `imputaciones` | `estado` sigue al pago |
| Multi-cliente | `cobranzas` | cabecera, 1×N pagos |
| Billetera | `billetera_movimientos` + saldo en `saldos_financieros` (tipo BILLETERA) | Fase C |
| Rendición | `rendiciones` + `rendicion_items` | Fase C |
| Devolución | `devoluciones` + `devoluciones_detalle` | ya existe |
| Fotos | `pago_comprobantes` | ya existe |
| Cheques | `cheques` | nacen `EN_CARTERA` |
| Ledger maestro | `kardex_contable` | fuente de verdad, escribe el backend |

## Qué NO hace la UI del viajante

- No confirma pagos (eso es la segunda firma, oficina).
- No envía `viajante_id` (se infiere de la sesión).
- No calcula saldos: siempre los lee del backend (`v_saldo_clientes` / billetera).
- No toca kardex/cajas: todo movimiento de dinero lo registra el backend.
