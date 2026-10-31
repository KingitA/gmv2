/**
 * Revisión de devoluciones — compartida por /api/deposito/devoluciones (web de
 * depósito), PATCH /api/devoluciones/[id]/confirmar (oficina) y el handler
 * `devolucion.recibir` del outbox de la app Depósito.
 *
 * Regla del dueño (16/10/2026): la devolución queda PENDIENTE hasta que alguien
 * revisa la mercadería. Al revisar se acepta o rechaza cada renglón, se puede
 * bajar la cantidad aceptada y cambiar la condición (vendible / no vendible).
 *  - Solo lo aceptado y vendible vuelve al stock.
 *  - `subtotal` y `monto_total` quedan con lo aceptado (el saldo del cliente se
 *    corrige solo: lib/cobranzas/valorar-devoluciones.ts suma `subtotal`).
 *    Un renglón rechazado queda con cantidad 0 (la original se guarda aparte).
 *  - Todo rechazado → estado `rechazado`; si no → `confirmado` (lista para que
 *    la oficina emita la NC/REV a mano; el sistema nunca la emite solo).
 *  - Queda quién (uuid + nombre), cuándo y los valores originales.
 *
 * P2-43 (Juan 1/11): si ya se aplicó en la refacturación del pedido por lo
 * declarado (`[declarada]`), la revisión sigue siendo para lo físico (stock),
 * pero NO deja nada para NC/REV: lo aplicado queda `facturado` (o `confirmado`
 * si trae renglones de otros comprobantes, por esa parte) y, si se acepta menos
 * de lo declarado, la diferencia se le cobra al cliente
 * (lib/pedidos/diferencia-devolucion-aplicada.ts).
 *
 * Solo desde `pendiente`: una segunda llamada da 409 y no toca stock. Cada
 * reingreso de stock se guarda contra su movimiento (`Devolución #<id>`), así
 * una revisión interrumpida se puede reintentar sin duplicar stock.
 */

import { ahoraISO, redondear } from "@/lib/formato"
import { comprobantesAplicados, esAplicadaDeclarada } from "@/lib/pedidos/ajuste-devoluciones"
import { ErrorDeposito } from "./picking"

export interface ItemDevolucionConfirmado {
  detalle_id: string
  articulo_id: string
  cantidad_recibida: number
  es_vendible: boolean
}

export type CondicionDevolucion = "vendible" | "no_vendible"

export interface RenglonRevision {
  /** devoluciones_detalle.id */
  id: string
  aceptar: boolean
  /** Cantidad aceptada (no más que lo devuelto). Omitida = la cargada. */
  cantidad_aceptada?: number | null
  es_vendible?: boolean
  condicion?: string | null
  motivo?: string | null
}

export interface RevisarDevolucionInput {
  devolucionId: string
  usuarioId: string | null
  usuarioNombre: string
  /** Renglones que no vienen se aceptan tal cual se cargaron */
  renglones?: RenglonRevision[] | null
  motivoGeneral?: string | null
  /** Instante de la decisión (la app manda cuándo la capturó). Default: ahora. */
  fecha?: string | null
}

export interface RenglonRevisado {
  id: string
  articulo_id: string
  estado_renglon: "aceptado" | "rechazado"
  cantidad_original: number
  cantidad: number
  es_vendible: boolean
  condicion: CondicionDevolucion
  subtotal: number
  stock_sumado: number
}

export interface ResultadoRevision {
  ok: true
  devolucion_id: string
  estado: "confirmado" | "rechazado" | "facturado"
  /** Ya aplicada en la refacturación del pedido: no emite NC/REV por esa parte */
  aplicada?: boolean
  /** Lo que no volvió de una aplicada, cobrado al cliente (PRES/ND) */
  diferencia?: { emitidos: Array<{ id: string; tipo: string; numero: string; total: number }>; textos: string[]; advertencias: string[] }
  monto_original: number
  monto_total: number
  aceptados: number
  rechazados: number
  /** Σ devoluciones_descuentos: lo ya descontado dentro de cobros del cliente */
  descontado: number
  /** Rechazada con algo ya descontado: esa plata no se mueve sola (la ve la oficina) */
  descontado_de_mas: number
  renglones: RenglonRevisado[]
}

const CONDICIONES = new Set<string>(["vendible", "no_vendible"])
const esGenerada = (e: any) => e?.code === "428C9" || /generated column/i.test(e?.message || "")

const COMO_ESTA: Record<string, string> = {
  confirmado: "ya fue aceptada",
  rechazado: "ya fue rechazada",
  facturado: "ya tiene la NC/REV emitida",
}

export async function revisarDevolucion(supabase: any, input: RevisarDevolucionInput): Promise<ResultadoRevision> {
  const { devolucionId, usuarioId, usuarioNombre } = input
  if (!devolucionId) throw new ErrorDeposito("devolucion_id requerido", 400)

  const { data: dev, error: devErr } = await supabase
    .from("devoluciones")
    .select("id, estado, numero_devolucion, monto_total, observaciones")
    .eq("id", devolucionId)
    .maybeSingle()
  if (devErr) throw devErr
  if (!dev) throw new ErrorDeposito("Devolución no encontrada", 404)
  if (dev.estado !== "pendiente") {
    const nombre = dev.numero_devolucion ? `La devolución ${dev.numero_devolucion}` : "La devolución"
    throw new ErrorDeposito(
      `${nombre} ${COMO_ESTA[dev.estado] || `está ${dev.estado}`}: solo se revisa una devolución pendiente.`,
      409,
      { codigo: "devolucion_no_pendiente", estado: dev.estado },
    )
  }

  const { data: detalle, error: detErr } = await supabase
    .from("devoluciones_detalle")
    .select("id, articulo_id, cantidad, precio_venta_original, es_vendible, condicion, cantidad_original, condicion_original, es_vendible_original, comprobante_venta_id")
    .eq("devolucion_id", devolucionId)
  if (detErr) throw detErr
  if (!detalle?.length) throw new ErrorDeposito("La devolución no tiene renglones.", 422)

  const pedidos = new Map<string, RenglonRevision>()
  for (const r of input.renglones || []) {
    if (!r?.id) continue
    if (!detalle.some((d: any) => d.id === r.id)) {
      throw new ErrorDeposito("Hay un renglón que no pertenece a esta devolución.", 400, { detalle_id: r.id })
    }
    pedidos.set(r.id, r)
  }

  const ahora = input.fecha || ahoraISO()

  // ── Decisión por renglón (se valida todo antes de escribir nada) ──
  const decisiones = detalle.map((d: any) => {
    const r = pedidos.get(d.id)
    const cargada = Number(d.cantidad) || 0
    const original = d.cantidad_original != null ? Number(d.cantidad_original) : cargada
    let cantidad = r ? (r.aceptar === false ? 0 : r.cantidad_aceptada != null ? Number(r.cantidad_aceptada) : cargada) : cargada
    if (!Number.isFinite(cantidad) || cantidad < 0) {
      throw new ErrorDeposito("Cantidad aceptada inválida.", 400, { detalle_id: d.id })
    }
    const tope = Math.max(original, cargada)
    if (cantidad > tope) {
      throw new ErrorDeposito(`No se puede aceptar más de lo devuelto (${tope}).`, 400, { detalle_id: d.id })
    }
    cantidad = redondear(cantidad, 3)
    const aceptado = cantidad > 0

    let condicion: string
    if (r?.condicion) condicion = r.condicion
    else if (r?.es_vendible !== undefined) condicion = r.es_vendible ? "vendible" : "no_vendible"
    else condicion = d.condicion && CONDICIONES.has(d.condicion) ? d.condicion : d.es_vendible === false ? "no_vendible" : "vendible"
    if (!CONDICIONES.has(condicion)) {
      throw new ErrorDeposito("Condición inválida: usá vendible o no vendible.", 400, { detalle_id: d.id })
    }
    const es_vendible = condicion === "vendible"
    const subtotal = aceptado ? redondear(cantidad * Number(d.precio_venta_original || 0)) : 0
    return { d, r, original, cantidad, aceptado, condicion: condicion as CondicionDevolucion, es_vendible, subtotal }
  })

  const aceptados = decisiones.filter((x: any) => x.aceptado)
  // Aplicada en la refacturación: lo aceptado contra esos comprobantes no va a NC/REV
  const aplicados = esAplicadaDeclarada(dev.observaciones) ? comprobantesAplicados(dev.observaciones) : new Set<string>()
  const aplicada = aplicados.size > 0
  const estadoFinal: ResultadoRevision["estado"] = !aceptados.length
    ? "rechazado"
    : aplicada && aceptados.every((x: any) => aplicados.has(x.d.comprobante_venta_id))
      ? "facturado"
      : "confirmado"

  // ── Renglones: valores nuevos + originales (solo la primera vez) ──
  for (const x of decisiones) {
    const { d, r } = x
    const cambios: Record<string, any> = {
      cantidad: x.cantidad,
      subtotal: x.subtotal,
      es_vendible: x.es_vendible,
      condicion: x.condicion,
      estado_renglon: x.aceptado ? "aceptado" : "rechazado",
      motivo_revision: r?.motivo?.trim() || null,
      revisado_por: usuarioId,
      revisado_at: ahora,
    }
    if (d.cantidad_original == null) cambios.cantidad_original = x.original
    if (d.condicion_original == null) cambios.condicion_original = d.condicion ?? (d.es_vendible === false ? "no_vendible" : "vendible")
    if (d.es_vendible_original == null) cambios.es_vendible_original = d.es_vendible !== false

    let { error } = await supabase.from("devoluciones_detalle").update(cambios).eq("id", d.id)
    if (error && esGenerada(error)) {
      // subtotal generado en la base (cantidad × precio): se recalcula solo
      delete cambios.subtotal
      ;({ error } = await supabase.from("devoluciones_detalle").update(cambios).eq("id", d.id))
    }
    if (error) throw error
  }

  // ── Stock: solo lo aceptado y vendible. `hechos` = reingresos de un intento
  // anterior interrumpido (por artículo, en unidades: no se repiten). ──
  const marca = `Devolución #${devolucionId} — mercadería vendible`
  const { data: previos } = await supabase.from("movimientos_stock").select("articulo_id, cantidad").eq("observaciones", marca)
  const hechos = new Map<string, number>()
  for (const m of previos || []) hechos.set(m.articulo_id, (hechos.get(m.articulo_id) || 0) + (Number(m.cantidad) || 0))

  const sumado = new Map<string, number>()
  for (const x of aceptados) {
    if (!x.es_vendible) continue
    const ya = hechos.get(x.d.articulo_id) || 0
    const usar = Math.min(ya, x.cantidad)
    hechos.set(x.d.articulo_id, ya - usar)
    const falta = redondear(x.cantidad - usar, 3)
    sumado.set(x.d.id, x.cantidad)
    if (falta <= 0) continue
    const { data: art } = await supabase.from("articulos").select("stock_actual").eq("id", x.d.articulo_id).single()
    const { error: stErr } = await supabase
      .from("articulos")
      .update({ stock_actual: (Number(art?.stock_actual) || 0) + falta })
      .eq("id", x.d.articulo_id)
    if (stErr) throw stErr
    await supabase.from("movimientos_stock").insert({
      articulo_id: x.d.articulo_id,
      tipo_movimiento: "entrada",
      cantidad: falta,
      observaciones: marca,
    })
  }

  // ── Cabecera ──
  const montoTotal = redondear(aceptados.reduce((s: number, x: any) => s + x.subtotal, 0))
  const motivoRechazo =
    estadoFinal === "rechazado"
      ? input.motivoGeneral?.trim() ||
        decisiones.map((x: any) => x.r?.motivo?.trim()).filter(Boolean).join(" · ") ||
        "Rechazada en la revisión"
      : input.motivoGeneral?.trim() || null
  const cabecera: Record<string, any> = {
    estado: estadoFinal,
    monto_total: montoTotal,
    revisado_por: usuarioId,
    confirmado_por: usuarioNombre,
    fecha_confirmacion: ahora,
  }
  if (motivoRechazo) cabecera.motivo_rechazo = motivoRechazo

  const { data: cerrada, error: cabErr } = await supabase
    .from("devoluciones")
    .update(cabecera)
    .eq("id", devolucionId)
    .eq("estado", "pendiente")
    .select("id")
  if (cabErr) throw cabErr
  if (!cerrada?.length) {
    throw new ErrorDeposito("Otra persona revisó esta devolución al mismo tiempo. Actualizá la pantalla.", 409, {
      codigo: "devolucion_no_pendiente",
    })
  }

  // Lo ya descontado en cobros no se toca acá (regla del dueño): solo se informa
  const { data: descs } = await supabase.from("devoluciones_descuentos").select("monto").eq("devolucion_id", devolucionId)
  const descontado = redondear((descs || []).reduce((s: number, x: any) => s + (Number(x.monto) || 0), 0))

  // Aplicada: lo que no volvió se le cobra al cliente (si falla, queda el aviso; la revisión ya quedó hecha)
  let diferencia: ResultadoRevision["diferencia"]
  if (aplicada) {
    try {
      const { cobrarDiferenciaDevolucionAplicada } = await import("@/lib/pedidos/diferencia-devolucion-aplicada")
      diferencia = await cobrarDiferenciaDevolucionAplicada(supabase, devolucionId, usuarioId)
    } catch (e: any) {
      diferencia = { emitidos: [], textos: [], advertencias: [`No se pudo cobrar lo que no volvió de la devolución: ${e?.message || e}. Cobralo a mano.`] }
    }
  }

  return {
    ok: true,
    devolucion_id: devolucionId,
    estado: estadoFinal,
    ...(aplicada ? { aplicada, diferencia } : {}),
    monto_original: Number(dev.monto_total) || 0,
    monto_total: montoTotal,
    aceptados: aceptados.length,
    rechazados: decisiones.length - aceptados.length,
    descontado,
    descontado_de_mas: estadoFinal === "rechazado" ? descontado : 0,
    renglones: decisiones.map((x: any) => ({
      id: x.d.id,
      articulo_id: x.d.articulo_id,
      estado_renglon: x.aceptado ? "aceptado" : "rechazado",
      cantidad_original: x.original,
      cantidad: x.cantidad,
      es_vendible: x.es_vendible,
      condicion: x.condicion,
      subtotal: x.subtotal,
      stock_sumado: sumado.get(x.d.id) || 0,
    })),
  }
}

/**
 * Aceptar todo (contrato viejo de la app Depósito y la web): cada ítem con su
 * cantidad recibida y si es vendible; un ítem con cantidad 0 queda rechazado.
 * Idempotente para los reintentos del outbox: si la devolución ya está
 * aceptada devuelve `ya_confirmada` sin tocar nada.
 */
export async function confirmarDevolucion(
  supabase: any,
  devolucion_id: string,
  items_confirmados: ItemDevolucionConfirmado[],
  userName: string,
  fecha?: string,
  usuarioId?: string | null,
) {
  if (!devolucion_id) throw new ErrorDeposito("devolucion_id requerido", 400)
  const { data: dev } = await supabase.from("devoluciones").select("id, estado").eq("id", devolucion_id).maybeSingle()
  if (!dev) throw new ErrorDeposito("Devolución no encontrada", 404)
  // "facturado": una aplicada en la refacturación ya revisada (reintento del outbox)
  if (dev.estado === "confirmado" || dev.estado === "facturado") return { ok: true, ya_confirmada: true }

  let uid = usuarioId ?? null
  if (!uid) {
    const { data } = await supabase.auth.getUser()
    uid = data?.user?.id ?? null
  }

  const renglones: RenglonRevision[] = (items_confirmados || [])
    .filter((i) => i?.detalle_id)
    .map((i) => {
      const cant = i.cantidad_recibida == null ? null : Number(i.cantidad_recibida)
      return {
        id: i.detalle_id,
        aceptar: cant == null || cant > 0,
        cantidad_aceptada: cant,
        es_vendible: i.es_vendible,
      }
    })

  return revisarDevolucion(supabase, {
    devolucionId: devolucion_id,
    usuarioId: uid,
    usuarioNombre: userName,
    renglones,
    fecha,
  })
}
