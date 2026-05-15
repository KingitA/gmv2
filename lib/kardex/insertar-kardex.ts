import { nowArgentina } from '@/lib/utils'

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
 *   'nota_credito_venta' → signo +1 (mercadería vuelve al stock, solo vendible)
 *   'nota_debito_venta'  → signo -1 (cargo financiero, sin impacto en stock físico)
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
  precio_lista: number                  // precio base sin IVA ni descuentos de venta
  precio_unitario_final: number         // lo que se cobra/paga
  subtotal_neto: number                 // cantidad × precio_lista
  subtotal_total: number                // subtotal_neto + subtotal_iva

  // ── Precios / márgenes ─────────────────────────────────────────────────────
  precio_costo?: number | null
  iva_porcentaje?: number               // 0, 10.5 o 21
  iva_monto_unitario?: number
  iva_incluido?: boolean
  subtotal_iva?: number

  // ── Descuentos ─────────────────────────────────────────────────────────────
  descuentos_json?: DescuentoKardex[]
  descuento_cliente_pct?: number
  // Columnas individuales por tipo (para filtros SQL directos en reportes)
  descuento_mercaderia_pct?: number | null
  descuento_mercaderia_monto?: number | null
  descuento_general_pct?: number | null
  descuento_general_monto?: number | null
  descuento_viajante_pct?: number | null
  descuento_viajante_monto?: number | null
  descuento_financiero_pct?: number | null
  descuento_financiero_monto?: number | null

  // ── Partes involucradas ────────────────────────────────────────────────────
  cliente_id?: string | null
  proveedor_id?: string | null
  vendedor_id?: string | null

  // ── Referencias a entidades originales ────────────────────────────────────
  pedido_id?: string | null
  numero_pedido?: string | null
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
  percepcion_iva_pct?: number
  percepcion_iva_monto?: number
  percepcion_iibb_pct?: number
  percepcion_iibb_monto?: number
  percepcion_ganancias_pct?: number
  percepcion_ganancias_monto?: number
  provincia_destino?: string | null     // zona del cliente al momento de la venta

  // ── Descuentos de proveedor (solo tipo_movimiento = 'compra') ──────────────
  descuento_proveedor_pct?: number | null
  descuento_proveedor_monto?: number | null
  descuento_proveedor_financiero_pct?: number | null
  descuento_proveedor_financiero_monto?: number | null
  descuento_proveedor_comercial_pct?: number | null
  descuento_proveedor_comercial_monto?: number | null

  // ── Comisión del viajante (solo tipo_movimiento = 'venta') ─────────────────
  // Calculado con getComisionPorcentaje(vendedor, segmento_precio, iva_ventas)
  comision_viajante_pct?: number | null
  comision_viajante_monto?: number | null

  // ── Stock snapshot ─────────────────────────────────────────────────────────
  stock_antes?: number | null
  stock_despues?: number | null

  // ── Actores responsables del proceso ──────────────────────────────────────
  operador_id?: string | null             // user.id de quien registró el movimiento
  comprador_id?: string | null            // creó la OC
  receptor_id?: string | null             // recibió en depósito
  controlador_id?: string | null          // controló la recepción
  pagador_id?: string | null              // pagó la OC
  preparadores_ids?: string[] | null      // array: puede haber múltiples preparadores
  facturador_id?: string | null           // generó el comprobante de venta
  entregador_id?: string | null           // entregó al cliente
  cobrador_id?: string | null             // cobró del cliente
  modificador_deposito_id?: string | null // hizo ajuste de stock en depósito

  // ── Comisiones (para auto-insertar registro en tabla comisiones) ───────────
  // Si se provee viajante_id_comision y comision_viajante_monto > 0,
  // se inserta automáticamente una fila en comisiones con pagado=false
  viajante_id_comision?: string | null
}

// Tipos que reducen stock (signo -1)
const TIPOS_SALIDA: TipoMovimientoKardex[] = [
  'venta', 'devolucion_compra', 'ajuste_salida',
  'nota_debito_venta',
]
// nota_credito_venta tiene signo +1: la mercadería vuelve al stock (si es vendible)
// Para no-vendible, generar-nc-reversa directamente no crea entrada en kardex

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
    margen_unitario = round2(input.precio_lista - input.precio_costo)
    if (input.precio_lista > 0) {
      margen_porcentaje = round2((margen_unitario / input.precio_lista) * 100)
    }
  }

  const { data: kardexData, error } = await supabase.from('kardex').insert({
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
    precio_lista: input.precio_lista,
    precio_unitario_final: input.precio_unitario_final,

    iva_porcentaje: input.iva_porcentaje ?? 0,
    iva_monto_unitario: input.iva_monto_unitario ?? 0,
    iva_incluido: input.iva_incluido ?? false,

    descuentos_json: input.descuentos_json ?? null,
    descuento_cliente_pct: input.descuento_cliente_pct ?? 0,
    descuento_mercaderia_pct: input.descuento_mercaderia_pct ?? null,
    descuento_mercaderia_monto: input.descuento_mercaderia_monto ?? null,
    descuento_general_pct: input.descuento_general_pct ?? null,
    descuento_general_monto: input.descuento_general_monto ?? null,
    descuento_viajante_pct: input.descuento_viajante_pct ?? null,
    descuento_viajante_monto: input.descuento_viajante_monto ?? null,
    descuento_financiero_pct: input.descuento_financiero_pct ?? null,
    descuento_financiero_monto: input.descuento_financiero_monto ?? null,

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

    percepcion_iva_pct: input.percepcion_iva_pct ?? 0,
    percepcion_iva_monto: input.percepcion_iva_monto ?? 0,
    percepcion_iibb_pct: input.percepcion_iibb_pct ?? 0,
    percepcion_iibb_monto: input.percepcion_iibb_monto ?? 0,
    percepcion_ganancias_pct: input.percepcion_ganancias_pct ?? 0,
    percepcion_ganancias_monto: input.percepcion_ganancias_monto ?? 0,
    provincia_destino: input.provincia_destino ?? null,

    descuento_proveedor_pct: input.descuento_proveedor_pct ?? null,
    descuento_proveedor_monto: input.descuento_proveedor_monto ?? null,
    descuento_proveedor_financiero_pct: input.descuento_proveedor_financiero_pct ?? null,
    descuento_proveedor_financiero_monto: input.descuento_proveedor_financiero_monto ?? null,
    descuento_proveedor_comercial_pct: input.descuento_proveedor_comercial_pct ?? null,
    descuento_proveedor_comercial_monto: input.descuento_proveedor_comercial_monto ?? null,

    comision_viajante_pct: input.comision_viajante_pct ?? null,
    comision_viajante_monto: input.comision_viajante_monto ?? null,

    comprobante_venta_id: input.comprobante_venta_id ?? null,
    comprobante_compra_id: input.comprobante_compra_id ?? null,
    pedido_id: input.pedido_id ?? null,
    numero_pedido: input.numero_pedido ?? null,
    recepcion_id: input.recepcion_id ?? null,
    orden_compra_id: input.orden_compra_id ?? null,
    lista_precio_id: input.lista_precio_id ?? null,

    stock_antes: input.stock_antes ?? null,
    stock_despues: input.stock_despues ?? null,

    operador_id: input.operador_id ?? null,
    comprador_id: input.comprador_id ?? null,
    receptor_id: input.receptor_id ?? null,
    controlador_id: input.controlador_id ?? null,
    pagador_id: input.pagador_id ?? null,
    preparadores_ids: input.preparadores_ids ?? null,
    facturador_id: input.facturador_id ?? null,
    entregador_id: input.entregador_id ?? null,
    cobrador_id: input.cobrador_id ?? null,
    modificador_deposito_id: input.modificador_deposito_id ?? null,
  }).select('id').single()

  if (error) {
    // No-throw: el kardex no debe romper el flujo principal
    console.error('[Kardex] Error insertando movimiento:', {
      tipo: input.tipo_movimiento,
      articulo_id: input.articulo_id,
      error: error.message,
    })
    return
  }

  // Auto-insertar en comisiones si hay comisión del viajante
  if (kardexData?.id && input.comision_viajante_monto && input.comision_viajante_monto > 0 && input.viajante_id_comision) {
    const { error: comErr } = await supabase.from('comisiones').insert({
      kardex_id: kardexData.id,
      viajante_id: input.viajante_id_comision,
      pedido_id: input.pedido_id ?? null,
      comprobante_venta_id: input.comprobante_venta_id ?? null,
      monto: round2(input.comision_viajante_monto),
      porcentaje: input.comision_viajante_pct ?? 0,
      pagado: false,
      comprobante_cobrado: false,
      tipo: 'vendida',
      articulo_id: input.articulo_id,
      cantidad: input.cantidad,
      precio_neto_unitario: input.precio_lista ?? null,
    })
    if (comErr) {
      console.error('[Kardex] Error insertando comisión:', comErr.message)
    }
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
  facturador_id?: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('kardex')
    .update({
      comprobante_venta_id,
      tipo_comprobante,
      numero_comprobante,
      metodo_facturacion,
      color_dinero,
      fecha: nowArgentina(),
      ...(facturador_id ? { facturador_id } : {}),
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

/**
 * Marca el descuento financiero (10% pago contado) en los ítems de kardex
 * asociados a los comprobantes incluidos en la bonificación.
 * Se llama después de crear la NC/REV de bonificación contado.
 */
export async function actualizarDescuentoFinancieroKardex(
  supabase: any,
  comprobante_ids: string[],
): Promise<void> {
  if (!comprobante_ids.length) return

  const { data: items, error } = await supabase
    .from('kardex')
    .select('id, precio_lista')
    .in('comprobante_venta_id', comprobante_ids)
    .eq('tipo_movimiento', 'venta')

  if (error || !items?.length) return

  for (const item of items) {
    const monto = round2(Number(item.precio_lista) * 0.10)
    const { error: updErr } = await supabase
      .from('kardex')
      .update({
        descuento_financiero_pct: 10,
        descuento_financiero_monto: monto,
      })
      .eq('id', item.id)
    if (updErr) console.error('[Kardex] Error actualizando descuento financiero:', updErr.message)
  }
}
