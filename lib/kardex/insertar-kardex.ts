/**
 * Helper central para insertar movimientos en el kardex unificado.
 * No recalcula precios — consume datos ya calculados por el pricing engine.
 *
 * Tipos de movimiento:
 *   'venta'            → signo -1 (reduce stock)
 *   'compra'           → signo +1 (incrementa stock)
 *   'devolucion_venta' → signo +1
 *   'devolucion_compra'→ signo -1
 *   'ajuste_entrada'   → signo +1
 *   'ajuste_salida'    → signo -1
 *   'nota_credito_venta' → signo -1 (reversa de venta)
 *   'nota_debito_venta'  → signo -1
 */

export type TipoMovimientoKardex =
  | 'venta'
  | 'compra'
  | 'devolucion_venta'
  | 'devolucion_compra'
  | 'ajuste_entrada'
  | 'ajuste_salida'
  | 'nota_credito_venta'
  | 'nota_debito_venta'

export interface DescuentoKardex {
  tipo: 'oferta' | 'general' | 'viajante' | 'mercaderia' | 'comercial' | 'financiero' | 'promocional'
  porcentaje: number
  monto_unitario: number
}

export interface ArticuloInfoKardex {
  sku?: string | null
  descripcion?: string | null
  categoria?: string | null
  marca_id?: string | null
  proveedor_id?: string | null
  iva_compras?: string | null
  iva_ventas?: string | null
}

export interface KardexMovimientoInput {
  // ── Obligatorios ───────────────────────────────────────────────────────────
  tipo_movimiento: TipoMovimientoKardex
  fecha: string                         // ISO string
  articulo_id: string
  cantidad: number                      // siempre positivo
  precio_unitario_neto: number          // sin IVA
  precio_unitario_final: number         // lo que se cobra/paga
  subtotal_neto: number                 // cantidad × precio_unitario_neto
  subtotal_total: number                // subtotal_neto + subtotal_iva

  // ── Precios / márgenes ─────────────────────────────────────────────────────
  precio_costo?: number | null
  iva_porcentaje?: number               // 0, 10.5 o 21
  iva_monto_unitario?: number
  iva_incluido?: boolean
  subtotal_iva?: number

  // ── Descuentos ─────────────────────────────────────────────────────────────
  precio_unitario_bruto?: number | null  // precio antes de descuento_propio y descuento_cliente
  descuentos_json?: DescuentoKardex[]
  descuento_cliente_pct?: number

  // ── Partes involucradas ────────────────────────────────────────────────────
  cliente_id?: string | null
  proveedor_id?: string | null
  vendedor_id?: string | null

  // ── Referencias a entidades originales ────────────────────────────────────
  pedido_id?: string | null
  recepcion_id?: string | null
  orden_compra_id?: string | null
  comprobante_venta_id?: string | null
  comprobante_compra_id?: string | null
  lista_precio_id?: string | null

  // ── Comprobante ────────────────────────────────────────────────────────────
  tipo_comprobante?: string | null      // 'FA','FB','FC','PRES','NCA', etc.
  numero_comprobante?: string | null
  metodo_facturacion?: string | null    // 'Factura' | 'Presupuesto' | 'Final'
  color_dinero?: string | null          // 'BLANCO' | 'NEGRO'
  va_en_comprobante?: string | null     // 'factura' | 'presupuesto'

  // ── Impuestos extra (para reporte IVA del contador) ───────────────────────
  percepcion_iva_monto?: number
  percepcion_iibb_monto?: number
  percepcion_ganancias_monto?: number
  provincia_destino?: string | null     // zona del cliente al momento de la venta

  // ── Stock snapshot ─────────────────────────────────────────────────────────
  stock_antes?: number | null
  stock_despues?: number | null

  // ── Auditoría ──────────────────────────────────────────────────────────────
  operador_id?: string | null             // user.id de quien registró el movimiento
}

// Tipos que reducen stock (signo -1)
const TIPOS_SALIDA: TipoMovimientoKardex[] = [
  'venta', 'devolucion_compra', 'ajuste_salida',
  'nota_credito_venta', 'nota_debito_venta',
]

function round2(n: number) {
  return Math.round(n * 100) / 100
}

export async function insertarKardex(
  supabase: any,
  input: KardexMovimientoInput,
  articuloInfo?: ArticuloInfoKardex,
): Promise<void> {
  const signo = TIPOS_SALIDA.includes(input.tipo_movimiento) ? -1 : 1

  // Calcular margen solo en ventas donde tenemos precio_costo
  let margen_unitario: number | null = null
  let margen_porcentaje: number | null = null
  if (input.precio_costo != null && input.precio_costo > 0 && signo === -1) {
    margen_unitario = round2(input.precio_unitario_neto - input.precio_costo)
    if (input.precio_unitario_neto > 0) {
      margen_porcentaje = round2((margen_unitario / input.precio_unitario_neto) * 100)
    }
  }

  const { error } = await supabase.from('kardex').insert({
    fecha: input.fecha,
    tipo_movimiento: input.tipo_movimiento,
    signo,

    articulo_id: input.articulo_id,
    articulo_sku: articuloInfo?.sku ?? null,
    articulo_descripcion: articuloInfo?.descripcion ?? null,
    articulo_categoria: articuloInfo?.categoria ?? null,
    articulo_marca_id: articuloInfo?.marca_id ?? null,
    articulo_proveedor_id: articuloInfo?.proveedor_id ?? null,
    articulo_iva_compras: articuloInfo?.iva_compras ?? null,
    articulo_iva_ventas: articuloInfo?.iva_ventas ?? null,

    cantidad: input.cantidad,

    cliente_id: input.cliente_id ?? null,
    proveedor_id: input.proveedor_id ?? null,
    vendedor_id: input.vendedor_id ?? null,

    precio_costo: input.precio_costo ?? null,
    precio_unitario_bruto: input.precio_unitario_bruto ?? null,
    precio_unitario_neto: input.precio_unitario_neto,
    precio_unitario_final: input.precio_unitario_final,

    iva_porcentaje: input.iva_porcentaje ?? 0,
    iva_monto_unitario: input.iva_monto_unitario ?? 0,
    iva_incluido: input.iva_incluido ?? false,

    descuentos_json: input.descuentos_json ?? null,
    descuento_cliente_pct: input.descuento_cliente_pct ?? 0,

    subtotal_neto: input.subtotal_neto,
    subtotal_iva: input.subtotal_iva ?? 0,
    subtotal_total: input.subtotal_total,

    margen_unitario,
    margen_porcentaje,

    tipo_comprobante: input.tipo_comprobante ?? null,
    numero_comprobante: input.numero_comprobante ?? null,
    metodo_facturacion: input.metodo_facturacion ?? null,
    color_dinero: input.color_dinero ?? null,
    va_en_comprobante: input.va_en_comprobante ?? null,

    percepcion_iva_monto: input.percepcion_iva_monto ?? 0,
    percepcion_iibb_monto: input.percepcion_iibb_monto ?? 0,
    percepcion_ganancias_monto: input.percepcion_ganancias_monto ?? 0,
    provincia_destino: input.provincia_destino ?? null,

    comprobante_venta_id: input.comprobante_venta_id ?? null,
    comprobante_compra_id: input.comprobante_compra_id ?? null,
    pedido_id: input.pedido_id ?? null,
    recepcion_id: input.recepcion_id ?? null,
    orden_compra_id: input.orden_compra_id ?? null,
    lista_precio_id: input.lista_precio_id ?? null,

    stock_antes: input.stock_antes ?? null,
    stock_despues: input.stock_despues ?? null,

    operador_id: input.operador_id ?? null,
  })

  if (error) {
    // No-throw: el kardex no debe romper el flujo principal
    console.error('[Kardex] Error insertando movimiento:', {
      tipo: input.tipo_movimiento,
      articulo_id: input.articulo_id,
      error: error.message,
    })
  }
}

/**
 * Vincula registros de kardex existentes (de un pedido) al comprobante generado.
 * Se llama después de crear el comprobante de venta.
 */
export async function vincularKardexAComprobante(
  supabase: any,
  pedido_id: string,
  comprobante_venta_id: string,
  tipo_comprobante: string,
  numero_comprobante: string,
  metodo_facturacion: string,
  color_dinero: string,
): Promise<void> {
  const { error } = await supabase
    .from('kardex')
    .update({
      comprobante_venta_id,
      tipo_comprobante,
      numero_comprobante,
      metodo_facturacion,
      color_dinero,
    })
    .eq('pedido_id', pedido_id)
    .is('comprobante_venta_id', null)

  if (error) {
    console.error('[Kardex] Error vinculando comprobante:', error.message)
  }
}

/**
 * Distribuye percepciones del comprobante (IVA, IIBB) pro-rata entre
 * los ítems del kardex del pedido, una vez generado el comprobante.
 */
export async function distribuirPercepcionesKardex(
  supabase: any,
  pedido_id: string,
  percepcion_iva_total: number,
  percepcion_iibb_total: number,
): Promise<void> {
  if (percepcion_iva_total === 0 && percepcion_iibb_total === 0) return

  // Obtener ítems del kardex de este pedido con sus subtotales
  const { data: items, error: fetchErr } = await supabase
    .from('kardex')
    .select('id, subtotal_total')
    .eq('pedido_id', pedido_id)
    .eq('tipo_movimiento', 'venta')

  if (fetchErr || !items || items.length === 0) return

  const totalBase = items.reduce((s: number, i: any) => s + (i.subtotal_total || 0), 0)
  if (totalBase === 0) return

  for (const item of items) {
    const ratio = (item.subtotal_total || 0) / totalBase
    const { error } = await supabase
      .from('kardex')
      .update({
        percepcion_iva_monto: round2(percepcion_iva_total * ratio),
        percepcion_iibb_monto: round2(percepcion_iibb_total * ratio),
      })
      .eq('id', item.id)

    if (error) console.error('[Kardex] Error distribuyendo percepciones:', error.message)
  }
}
