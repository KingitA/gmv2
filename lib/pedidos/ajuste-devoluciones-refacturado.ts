import type { SupabaseClient } from "@supabase/supabase-js"
import { insertarKardex } from "@/lib/kardex/insertar-kardex"
import { ahoraISO } from "@/lib/formato"
import { descontarDevuelto } from "./ajuste-devoluciones"

// P2-43 (regla DEFINITIVA de Juan, 31/10/2026 — ver lib/pedidos/ajuste-devoluciones.ts):
// al ANULAR un comprobante de venta (refacturar o anular de a uno), sus
// devoluciones se aplican y la mercadería devuelta sale del pedido.
//  - Caso 2: devolución con su REV/NC ya emitida e imputada al comprobante → la
//    REV/NC es INTOCABLE; la anulación es solo por lo que falta cancelar
//    (total − devoluciones imputadas). Si lo cubren todo, no hay inverso.
//  - Caso 1: devolución aceptada sin REV/NC → se cierra sin emitirla ("facturado").
//  - Devolución que depósito todavía no revisó → no se refactura hasta revisarla
//    (lib/pedidos/anulacion-pedido.ts).
// La devolución queda marcada `[aplicada:<comprobante>]` en sus observaciones; al
// volver a generar, lo devuelto de esos comprobantes no se factura
// (aplicarDevueltoAlDetalle, en generar y en el kardex).

const CREDITOS = ["NCA", "NCB", "NCC", "REV"]
const VENTAS = ["FA", "FB", "FC", "PRES"]
const r2 = (n: number) => Math.round(n * 100) / 100
const marca = (compId: string) => `[aplicada:${compId}]`

interface RenglonDev {
  id: string
  devolucion_id: string
  numero: string
  estado: string
  observaciones: string
  articulo_id: string
  descripcion: string | null
  cantidad: number
  precio: number
  comprobante_venta_id: string
  es_vendible: boolean
}

async function renglonesContra(supabase: SupabaseClient, compIds: string[], estados: string[]): Promise<RenglonDev[]> {
  if (!compIds.length) return []
  const { data } = await supabase
    .from("devoluciones_detalle")
    .select("id, devolucion_id, articulo_id, cantidad, precio_venta_original, estado_renglon, es_vendible, comprobante_venta_id, articulo:articulos!devoluciones_detalle_articulo_id_fkey(descripcion), devolucion:devoluciones!inner(id, numero_devolucion, estado, observaciones)")
    .in("comprobante_venta_id", compIds)
  const out: RenglonDev[] = []
  for (const d of (data || []) as any[]) {
    const dev = Array.isArray(d.devolucion) ? d.devolucion[0] : d.devolucion
    if (!estados.includes(dev?.estado) || d.estado_renglon === "rechazado" || !(Number(d.cantidad) > 0)) continue
    const art = Array.isArray(d.articulo) ? d.articulo[0] : d.articulo
    out.push({
      id: d.id,
      devolucion_id: d.devolucion_id,
      numero: dev?.numero_devolucion || d.devolucion_id,
      estado: dev?.estado,
      observaciones: dev?.observaciones || "",
      articulo_id: d.articulo_id,
      descripcion: art?.descripcion ?? null,
      cantidad: Number(d.cantidad) || 0,
      precio: Number(d.precio_venta_original) || 0,
      comprobante_venta_id: d.comprobante_venta_id,
      es_vendible: d.es_vendible !== false,
    })
  }
  return out
}

/** Artículo → cantidad devuelta y APLICADA en la refacturación, contra los comprobantes anulados del pedido. */
export async function devueltoDelPedidoPorArticulo(supabase: SupabaseClient, pedidoId: string): Promise<Map<string, number>> {
  const { data: comps } = await supabase
    .from("comprobantes_venta")
    .select("id")
    .eq("pedido_id", pedidoId)
    .in("tipo_comprobante", VENTAS)
    .not("anulado_en", "is", null)
  const ids = ((comps || []) as any[]).map((c) => c.id)
  const renglones = await renglonesContra(supabase, ids, ["facturado"])
  const out = new Map<string, number>()
  // Solo lo aplicado al anular (los anulados antes de este cambio siguen con su REV viva)
  for (const r of renglones) if (r.observaciones.includes(marca(r.comprobante_venta_id))) out.set(r.articulo_id, (out.get(r.articulo_id) ?? 0) + r.cantidad)
  return out
}

/**
 * Descuenta lo devuelto de los renglones del pedido EN MEMORIA, para que
 * cantidadAFacturar dé lo que va al comprobante nuevo (generar y kardex usan la
 * misma función). Un renglón con algo devuelto queda como PARCIAL por lo que
 * resta; si no resta nada, como FALTANTE. No graba nada.
 */
export async function aplicarDevueltoAlDetalle(
  supabase: SupabaseClient,
  pedidoId: string,
  detalle: any[],
  cantidadAFacturar: (d: any) => number,
): Promise<Map<string, number>> {
  const devuelto = await devueltoDelPedidoPorArticulo(supabase, pedidoId)
  if (!devuelto.size) return devuelto
  const cantidades = descontarDevuelto(
    detalle.map((d) => ({ id: d.id, articulo_id: d.articulo_id, cantidad: cantidadAFacturar(d), es_bonificado: d.es_bonificado })),
    devuelto,
  )
  for (const d of detalle) {
    const nueva = cantidades.get(d.id)
    if (nueva == null || nueva === cantidadAFacturar(d)) continue
    if (nueva <= 0) d.estado_item = "FALTANTE"
    else {
      d.estado_item = "PARCIAL"
      d.cantidad_preparada = nueva
    }
  }
  return devuelto
}

export interface DevolucionesAplicadas {
  /** Lo que ya cancelaron las REV/NC de devolución imputadas al comprobante (la anulación es por total − esto) */
  menos: number
  /** Artículo → cantidad devuelta (no reingresa stock con la anulación) */
  devuelto: Map<string, number>
  /** Las REV/NC de devolución que ya cancelaron parte (para el detalle y el aviso) */
  creditos: string[]
  textos: string[]
  advertencias: string[]
}

/**
 * Antes de emitir el inverso de un FA/FB/FC/PRES: aplica sus devoluciones. No
 * toca ninguna REV/NC emitida: devuelve cuánto ya cancelaron (`menos`). Se
 * puede repetir: lo ya marcado no se marca de nuevo.
 */
export async function aplicarDevolucionesAlAnular(
  supabase: SupabaseClient,
  original: { id: string; tipo_comprobante: string; numero_comprobante: string; cliente_id: string; pedido_id: string | null },
  usuarioId: string,
): Promise<DevolucionesAplicadas> {
  const res: DevolucionesAplicadas = { menos: 0, devuelto: new Map(), creditos: [], textos: [], advertencias: [] }
  if (!VENTAS.includes(original.tipo_comprobante)) return res

  // Caso 2: REV/NC de devolución imputadas a este comprobante (por P2-41, solo su parte)
  const { data: imps } = await supabase
    .from("imputaciones")
    .select("monto_imputado, credito:comprobantes_venta!imputaciones_credito_comprobante_id_fkey(tipo_comprobante, numero_comprobante, observaciones, anulado_en, estado_pago)")
    .eq("comprobante_id", original.id)
    .eq("estado", "confirmado")
    .not("credito_comprobante_id", "is", null)
  for (const i of (imps || []) as any[]) {
    const cr = Array.isArray(i.credito) ? i.credito[0] : i.credito
    if (!cr || cr.anulado_en || cr.estado_pago === "anulado" || !CREDITOS.includes(cr.tipo_comprobante)) continue
    if (!String(cr.observaciones || "").startsWith("Devolución")) continue
    res.menos = r2(res.menos + (Number(i.monto_imputado) || 0))
    const nombre = `${cr.tipo_comprobante} ${cr.numero_comprobante}`
    if (!res.creditos.includes(nombre)) res.creditos.push(nombre)
  }

  const renglones = await renglonesContra(supabase, [original.id], ["confirmado", "facturado"])
  for (const r of renglones) res.devuelto.set(r.articulo_id, (res.devuelto.get(r.articulo_id) ?? 0) + r.cantidad)
  if (!renglones.length) return res

  let refPedido = `${original.tipo_comprobante} ${original.numero_comprobante}`
  if (original.pedido_id) {
    const { data: p } = await supabase.from("pedidos").select("numero_pedido").eq("id", original.pedido_id).maybeSingle()
    if (p?.numero_pedido) refPedido = `pedido ${p.numero_pedido}`
  }
  const leyenda = `Aplicada en la refacturación del ${refPedido} ${marca(original.id)}`

  const porDev = new Map<string, RenglonDev[]>()
  for (const r of renglones) porDev.set(r.devolucion_id, [...(porDev.get(r.devolucion_id) || []), r])
  for (const [devId, rs] of porDev) {
    const numero = rs[0].numero
    const arts = rs.map((r) => `${r.cantidad} ${r.descripcion || "artículo"}`).join(", ")
    const conCredito = rs[0].estado === "facturado"
    if (!rs[0].observaciones.includes(marca(original.id))) {
      // Caso 1: aceptada sin REV/NC → se cierra sin emitir. Caso 2: queda como está, marcada.
      const obs = [rs[0].observaciones, leyenda].filter(Boolean).join(" · ")
      const { error } = await supabase.from("devoluciones").update({ estado: "facturado", observaciones: obs }).eq("id", devId)
      if (error) res.advertencias.push(`No se pudo marcar la devolución ${numero} como aplicada (${error.message}).`)
      // Kardex: lo vendible que su REV/NC reingresó sale (la venta refacturada ya no lo incluye)
      if (conCredito) res.advertencias.push(...(await kardexSalida(supabase, original, rs, numero, usuarioId)))
    }
    res.textos.push(conCredito
      ? `${arts} (${numero}) salen del comprobante nuevo por estar devueltos; la REV/NC de la devolución queda como está.`
      : `${arts} (${numero}) salen del comprobante nuevo por estar devueltos; la devolución se cierra sin emitir REV/NC (aplicada en la refacturación).`)
  }
  if (res.menos > 0.005) res.textos.push(`La anulación es por lo que falta cancelar: ${res.creditos.join(", ")} ya canceló parte del ${original.tipo_comprobante} ${original.numero_comprobante}.`)
  return res
}

/** Lo vendible devuelto que la NC/REV había reingresado al kardex sale (la venta refacturada ya no lo incluye). */
async function kardexSalida(supabase: SupabaseClient, original: { id: string; tipo_comprobante: string; numero_comprobante: string; cliente_id: string; pedido_id: string | null }, rs: RenglonDev[], numero: string, usuarioId: string): Promise<string[]> {
  const vendibles = rs.filter((r) => r.es_vendible)
  if (!vendibles.length) return []
  const { data: info } = await supabase.from("articulos").select("id, sku, descripcion, categoria, marca_id, proveedor_id, iva_compras, iva_ventas").in("id", vendibles.map((r) => r.articulo_id))
  const infoDe = new Map(((info || []) as any[]).map((a) => [a.id, a]))
  const fiscal = original.tipo_comprobante !== "PRES"
  const avisos: string[] = []
  for (const r of vendibles) {
    try {
      await insertarKardex(supabase, {
        tipo_movimiento: "ajuste_salida",
        fecha: ahoraISO(),
        articulo_id: r.articulo_id,
        cantidad: r.cantidad,
        precio_lista: 0,
        precio_unitario_final: 0,
        iva_porcentaje: 0,
        iva_monto_unitario: 0,
        iva_incluido: !fiscal,
        subtotal_neto: 0,
        subtotal_iva: 0,
        subtotal_total: 0,
        cliente_id: original.cliente_id,
        pedido_id: original.pedido_id,
        comprobante_venta_id: original.id,
        tipo_comprobante: original.tipo_comprobante,
        numero_comprobante: original.numero_comprobante,
        metodo_facturacion: fiscal ? "Factura" : "Presupuesto",
        color_dinero: fiscal ? "BLANCO" : "NEGRO",
        operador_id: usuarioId,
      } as any, infoDe.get(r.articulo_id) || {})
    } catch (e: any) {
      avisos.push(`Kardex de ${r.descripcion || r.articulo_id} (${numero}) sin corregir: ${e?.message || e}.`)
    }
  }
  return avisos
}

/** Para el diálogo de anular y la confirmación de Generar: devoluciones de los comprobantes del pedido. */
export async function devolucionesDelPedido(supabase: SupabaseClient, pedidoId: string, opts: { anulados?: boolean } = {}): Promise<Array<{ numero: string; articulos: string; aparte: boolean; fiscal: boolean; sin_credito: boolean; texto: string }>> {
  let q = supabase.from("comprobantes_venta").select("id, tipo_comprobante").eq("pedido_id", pedidoId).in("tipo_comprobante", VENTAS)
  q = opts.anulados ? q.not("anulado_en", "is", null) : q.is("anulado_en", null)
  const { data: comps } = await q
  const tipoDe = new Map(((comps || []) as any[]).map((c) => [c.id, c.tipo_comprobante as string]))
  if (!tipoDe.size) return []
  let renglones = await renglonesContra(supabase, [...tipoDe.keys()], opts.anulados ? ["facturado"] : ["pendiente", "confirmado", "facturado"])
  if (opts.anulados) renglones = renglones.filter((r) => r.observaciones.includes(marca(r.comprobante_venta_id)))
  if (!renglones.length) return []
  const devIds = [...new Set(renglones.map((r) => r.devolucion_id))]
  const { data: todos } = await supabase.from("devoluciones_detalle").select("devolucion_id, comprobante_venta_id, cantidad, estado_renglon").in("devolucion_id", devIds)
  const aparte = new Set(((todos || []) as any[]).filter((d) => !tipoDe.has(d.comprobante_venta_id) && d.estado_renglon !== "rechazado" && Number(d.cantidad) > 0).map((d) => d.devolucion_id))
  return devIds.map((id) => {
    const rs = renglones.filter((r) => r.devolucion_id === id)
    const fiscal = rs.some((r) => tipoDe.get(r.comprobante_venta_id) !== "PRES")
    const sinCredito = rs[0].estado === "confirmado"
    const articulos = rs.map((r) => `${r.cantidad} ${r.descripcion || "artículo"}`).join(", ")
    const texto = `${articulos} (${rs[0].numero}) ${opts.anulados ? "no van" : "salen"} del comprobante nuevo` +
      (opts.anulados
        ? " (devueltos, aplicados en la refacturación)."
        : rs[0].estado === "pendiente"
          ? ": depósito todavía no la revisó. Revisala antes de refacturar."
          : sinCredito
            ? " por estar devueltos; la devolución se cierra sin emitir REV/NC."
            : ` por estar devueltos; la anulación es por lo que falta cancelar (la ${fiscal ? "NC" : "REV"} de la devolución ya canceló su parte y queda como está).`) +
      (aparte.has(id) ? " Lo que trae de otros comprobantes o del sistema viejo queda aparte, acreditado." : "")
    return { numero: rs[0].numero, articulos, aparte: aparte.has(id), fiscal, sin_credito: sinCredito, texto }
  })
}
