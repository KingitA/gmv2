# API de Precios para CRM

## Endpoint: Catálogo de Precios por Cliente

**URL:** `/api/precios/catalogo`

**Método:** `GET`

**Parámetros:**
- `cliente_id` (requerido): UUID del cliente

**Ejemplo de uso:**
\`\`\`
GET /api/precios/catalogo?cliente_id=123e4567-e89b-12d3-a456-426614174000
\`\`\`

**Respuesta exitosa (200):**
\`\`\`json
{
  "success": true,
  "data": [
    {
      "articulo_id": "abc123...",
      "descripcion": "PULVERIZADOR MULTIUSO x750CC MAKE",
      "categoria": "PLASTICOS VARIOS",
      "precio_final": 1250,
      "desglose": {
        "precio_lista": 1000,
        "descuento1_monto": 100,
        "descuento2_monto": 45,
        "descuento3_monto": 25.65,
        "descuento4_monto": 16.59,
        "costo_bruto": 812.76,
        "iva_compras_monto": 170.68,
        "flete_compra_monto": 0,
        "costo_final": 983.44,
        "ganancia_monto": 162.55,
        "gastos_operativos_monto": 24.38,
        "precio_base": 999.69,
        "flete_venta_monto": 29.99,
        "recargo_puntaje_monto": 0,
        "precio_antes_comision": 1029.68,
        "comision_vendedor_monto": 65.62,
        "precio_venta_neto": 1095.30,
        "impuestos_monto": 229.01,
        "precio_final": 1324.31,
        "precio_final_redondeado": 1324
      }
    }
  ],
  "total": 150,
  "fecha_calculo": "2025-01-11T10:30:00.000Z"
}
\`\`\`

**Respuesta de error (400):**
\`\`\`json
{
  "error": "cliente_id es requerido"
}
\`\`\`

**Respuesta de error (500):**
\`\`\`json
{
  "error": "Error calculando precios"
}
\`\`\`

## Flujo de Cálculo de Precios

El sistema calcula el precio final en 5 pasos:

### 1. COSTO BRUTO
- Precio de lista del proveedor
- Aplicación de descuentos (cascada o sobre lista)
- Descuento fuera de factura

### 2. COSTO FINAL
- Costo bruto
- + IVA de compras (21%)
- + Percepciones y retenciones del proveedor
- + Flete de compra (si aplica)

### 3. PRECIO BASE
- Costo bruto
- + Ganancia del artículo (%)
- + Gastos operativos (3%)

### 4. PRECIO VENTA
- Precio base
- + Flete de venta (según zona del cliente)
- + Recargo por puntaje del cliente:
  - PREMIUM: 0% (flete bonificado)
  - REGULAR: 0%
  - RIESGO: +5%
  - CRITICO: +15%
- ÷ (1 - comisión vendedor) para incluir comisión

### 5. PRECIO FINAL
- Precio venta neto
- + Impuestos según matriz IVA:
  - Factura → Factura: +21% IVA discriminado
  - Factura → Presupuesto: +21% IVA incluido
  - Adquisición → Factura: +21% IVA discriminado
  - Adquisición → Presupuesto: Sin impuestos
  - Mixto → Factura: +21% IVA discriminado
  - Mixto → Presupuesto: +10.5% IVA incluido
- Redondeo al entero más cercano

## Consideraciones Importantes

1. **Flete de venta**: Se obtiene de la zona del cliente (tabla `zonas`)
   - Si `tipo_flete = "transporte"`: Se usa el % del transporte asignado
   - Si `tipo_flete = "propio"`: Se usa el % manual de la zona
   - Si `cliente.retira_en_deposito = true`: Flete = 0%

2. **Comisión del vendedor**: Varía según categoría del artículo
   - PERFUMERIA: `vendedor.comision_perfumeria`
   - Otras: `vendedor.comision_bazar_limpieza`

3. **Impuestos**: Dependen de:
   - Tipo de IVA en compras del artículo
   - Tipo de IVA en ventas del artículo
   - Si el cliente está exento de IVA o IIBB

4. **Performance**: El endpoint calcula todos los precios del catálogo
   - Puede tardar 2-3 segundos con catálogos grandes
   - Se recomienda cachear los resultados en el CRM
   - Recalcular solo cuando el cliente vuelva a ingresar

## Integración con CRM

### Flujo recomendado:

1. Usuario (cliente) inicia sesión en el CRM
2. CRM obtiene el `cliente_id` del usuario autenticado
3. CRM llama al endpoint: `GET /api/precios/catalogo?cliente_id={id}`
4. CRM muestra loading mientras calcula (2-3 segundos)
5. CRM cachea los precios en memoria/localStorage
6. Usuario navega por el catálogo con precios ya calculados
7. Al cerrar sesión o refrescar, se recalculan los precios

### Ejemplo de código (CRM):

\`\`\`typescript
// En el login del cliente
async function cargarCatalogoPreciosCliente(clienteId: string) {
  try {
    const response = await fetch(
      `https://tu-erp.vercel.app/api/precios/catalogo?cliente_id=${clienteId}`
    )
    const data = await response.json()
    
    if (data.success) {
      // Guardar en estado global o localStorage
      localStorage.setItem('catalogo_precios', JSON.stringify(data.data))
      localStorage.setItem('catalogo_fecha', data.fecha_calculo)
      return data.data
    }
  } catch (error) {
    console.error('Error cargando precios:', error)
  }
}

// Al mostrar un producto
function obtenerPrecioProducto(articuloId: string) {
  const catalogo = JSON.parse(localStorage.getItem('catalogo_precios') || '[]')
  const producto = catalogo.find(p => p.articulo_id === articuloId)
  return producto?.precio_final || 0
}
\`\`\`

## Autenticación

El endpoint está protegido por Supabase RLS (Row Level Security).

Para acceder desde el CRM, debes:
1. Autenticar al usuario con Supabase Auth
2. Incluir el token de autenticación en las peticiones
3. El usuario debe tener permisos de lectura en las tablas necesarias

## Soporte

Para dudas o problemas con la integración, contactar al equipo de desarrollo del ERP.
