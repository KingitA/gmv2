/**
 * Lógica central para generar NC/REV por pago contado (10% de descuento).
 *
 * Flujo:
 * - Los PRESUPUESTOS (PRES) generan UNA REVERSA (REV) con una línea por comprobante.
 *   Monto = 10% del total_factura del presupuesto. Sin IVA discriminado.
 *
 * - Las FACTURAS (FA→NCA, FB→NCB, FC→NCC) generan UNA NOTA DE CRÉDITO por tipo IVA,
 *   con una línea por factura. Monto neto = 10% del total_neto de cada factura.
 *   IVA = 21% sobre ese neto. Total NC = neto + IVA.
 *
 * Si se provee un pago_id, las NC/REV generadas se imputarán automáticamente a ese pago.
 */

import { SupabaseClient } from "@supabase/supabase-js"
import { getBonificacionArticuloId } from "@/lib/articulos/bonificacion"
import { todayArgentina } from "@/lib/utils"

const DESCUENTO_CONTADO_PCT = 10
const IVA_PCT = 0.21
const PUNTO_VENTA = "0001"

function r2(n: number): number {
  return Math.round(n * 100) / 100
}

interface ComprobanteInput {
  id: string
  tipo_comprobante: string
  numero_comprobante: string
  total_neto: number
  total_iva: number
  total_factura: number
}

interface ComprobanteGenerado {
  id: string
  tipo: string
  numero: string
  total_neto: number
  total_iva: number
  total_factura: number
}

export interface ResultadoBonificacion {
  total_bonificacion: number
  comprobantes_generados: ComprobanteGenerado[]
}

export interface ParamsBonificacion {
  cliente_id: string
  comprobante_ids: string[]
  /** Si se provee, se crean imputaciones ligando las NC/REV a este pago */
  pago_id?: string
}

async function getNextNumero(
  supabase: SupabaseClient,
  tipo: string,
): Promise<{ numero: string; puntoVenta: string; nextNum: number }> {
  const { data: num } = await supabase
    .from("numeracion_comprobantes")
    .select("*")
    .eq("tipo_comprobante", tipo)
    .eq("punto_venta", PUNTO_VENTA)
    .single()

  if (!num) throw new Error(`Numeración no encontrada para tipo ${tipo}`)
  const nextNum = num.ultimo_numero + 1
  const numero = `${num.punto_venta}-${nextNum.toString().padStart(8, "0")}`
  return { numero, puntoVenta: num.punto_venta, nextNum }
}

async function avanzarNumeracion(
  supabase: SupabaseClient,
  tipo: string,
  nextNum: number,
): Promise<void> {
  await supabase
    .from("numeracion_comprobantes")
    .update({ ultimo_numero: nextNum })
    .eq("tipo_comprobante", tipo)
    .eq("punto_venta", PUNTO_VENTA)
}

async function crearComprobante(
  supabase: SupabaseClient,
  params: {
    tipo: string
    numero: string
    puntoVenta: string
    cliente_id: string
    total_neto: number
    total_iva: number
    total_factura: number
    observaciones?: string
  },
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("comprobantes_venta")
    .insert({
      tipo_comprobante: params.tipo,
      numero_comprobante: params.numero,
      punto_venta: params.puntoVenta,
      fecha: todayArgentina(),
      cliente_id: params.cliente_id,
      total_neto: -Math.abs(params.total_neto),
      total_iva: -Math.abs(params.total_iva),
      total_factura: -Math.abs(params.total_factura),
      saldo_pendiente: -Math.abs(params.total_factura),
      estado_pago: "pendiente",
      observaciones: params.observaciones || "Bonificación pago contado 10%",
    })
    .select("id")
    .single()

  if (error || !data) {
    throw new Error(`Error creando comprobante ${params.tipo}: ${error?.message}`)
  }
  return data
}

async function crearDetalle(
  supabase: SupabaseClient,
  comprobante_id: string,
  bonificacion_articulo_id: string,
  lineas: Array<{
    descripcion: string
    precio_neto: number
  }>,
): Promise<void> {
  const inserts = lineas.map(l => ({
    comprobante_id,
    articulo_id: bonificacion_articulo_id,
    descripcion: l.descripcion,
    cantidad: 1,
    precio_unitario: -Math.abs(l.precio_neto),
    precio_total: -Math.abs(l.precio_neto),
  }))

  const { error } = await supabase.from("comprobantes_venta_detalle").insert(inserts)
  if (error) throw new Error(`Error creando detalle: ${error.message}`)
}

async function crearImputacion(
  supabase: SupabaseClient,
  pago_id: string,
  comprobante_id: string,
  monto: number,
): Promise<void> {
  await supabase.from("imputaciones").insert({
    pago_id,
    comprobante_id,
    monto_imputado: Math.abs(monto),
    tipo_comprobante: "venta",
    estado: "pendiente",
  })
}

export async function generarBonificacionContado(
  supabase: SupabaseClient,
  params: ParamsBonificacion,
): Promise<ResultadoBonificacion> {
  const { cliente_id, comprobante_ids, pago_id } = params

  if (!comprobante_ids || comprobante_ids.length === 0) {
    return { total_bonificacion: 0, comprobantes_generados: [] }
  }

  // Cargar comprobantes
  const { data: comprobantes, error: compError } = await supabase
    .from("comprobantes_venta")
    .select("id, tipo_comprobante, numero_comprobante, total_neto, total_iva, total_factura")
    .in("id", comprobante_ids)

  if (compError || !comprobantes) {
    throw new Error(`Error cargando comprobantes: ${compError?.message}`)
  }

  const bonificacionId = await getBonificacionArticuloId(supabase)

  // Separar por tipo
  const presupuestos: ComprobanteInput[] = comprobantes.filter(c => c.tipo_comprobante === "PRES")
  const facturasA: ComprobanteInput[] = comprobantes.filter(c => c.tipo_comprobante === "FA")
  const facturasB: ComprobanteInput[] = comprobantes.filter(c => c.tipo_comprobante === "FB")
  const facturasC: ComprobanteInput[] = comprobantes.filter(c => c.tipo_comprobante === "FC")

  const comprobantesGenerados: ComprobanteGenerado[] = []
  let totalBonificacion = 0

  // ─── PRESUPUESTOS → REV ───────────────────────────────────────────────────
  if (presupuestos.length > 0) {
    const { numero, puntoVenta, nextNum } = await getNextNumero(supabase, "REV")

    const lineas = presupuestos.map(c => ({
      descripcion: `BONIF. ${DESCUENTO_CONTADO_PCT}% ${c.tipo_comprobante} ${c.numero_comprobante}`,
      precio_neto: r2(Math.abs(c.total_factura) * DESCUENTO_CONTADO_PCT / 100),
    }))

    const totalNeto = r2(lineas.reduce((s, l) => s + l.precio_neto, 0))

    const { id } = await crearComprobante(supabase, {
      tipo: "REV",
      numero,
      puntoVenta,
      cliente_id,
      total_neto: totalNeto,
      total_iva: 0,
      total_factura: totalNeto,
      observaciones: `Bonificación contado 10% — presupuestos ${presupuestos.map(c => c.numero_comprobante).join(", ")}`,
    })

    await crearDetalle(supabase, id, bonificacionId, lineas)
    await avanzarNumeracion(supabase, "REV", nextNum)

    if (pago_id) await crearImputacion(supabase, pago_id, id, totalNeto)

    comprobantesGenerados.push({ id, tipo: "REV", numero, total_neto: totalNeto, total_iva: 0, total_factura: totalNeto })
    totalBonificacion += totalNeto
  }

  // ─── Función genérica para NC (FA→NCA, FB→NCB, FC→NCC) ──────────────────
  async function procesarFacturas(facturas: ComprobanteInput[], tipoNC: string) {
    if (facturas.length === 0) return

    const { numero, puntoVenta, nextNum } = await getNextNumero(supabase, tipoNC)

    const lineas = facturas.map(c => ({
      descripcion: `BONIF. ${DESCUENTO_CONTADO_PCT}% ${c.tipo_comprobante} ${c.numero_comprobante}`,
      // Para facturas: la bonificación se calcula sobre total_neto (sin IVA)
      precio_neto: r2(Math.abs(c.total_neto) * DESCUENTO_CONTADO_PCT / 100),
    }))

    const totalNeto = r2(lineas.reduce((s, l) => s + l.precio_neto, 0))
    const totalIva = r2(totalNeto * IVA_PCT)
    const totalFactura = r2(totalNeto + totalIva)

    const { id } = await crearComprobante(supabase, {
      tipo: tipoNC,
      numero,
      puntoVenta,
      cliente_id,
      total_neto: totalNeto,
      total_iva: totalIva,
      total_factura: totalFactura,
      observaciones: `Bonificación contado 10% — facturas ${facturas.map(c => c.numero_comprobante).join(", ")}`,
    })

    await crearDetalle(supabase, id, bonificacionId, lineas)
    await avanzarNumeracion(supabase, tipoNC, nextNum)

    if (pago_id) await crearImputacion(supabase, pago_id, id, totalFactura)

    comprobantesGenerados.push({ id, tipo: tipoNC, numero, total_neto: totalNeto, total_iva: totalIva, total_factura: totalFactura })
    totalBonificacion += totalFactura
  }

  await procesarFacturas(facturasA, "NCA")
  await procesarFacturas(facturasB, "NCB")
  await procesarFacturas(facturasC, "NCC")

  return {
    total_bonificacion: r2(totalBonificacion),
    comprobantes_generados: comprobantesGenerados,
  }
}
