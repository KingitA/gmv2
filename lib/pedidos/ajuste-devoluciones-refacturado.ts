import type { SupabaseClient } from "@supabase/supabase-js"
import { origenesDeRenglones } from "@/lib/cobranzas/origen-devolucion"
import { valorDevolucionConOrigen } from "@/lib/cobranzas/valor-devolucion"
import { insertarKardex } from "@/lib/kardex/insertar-kardex"
import { postearLibroConAviso } from "@/lib/cuenta-corriente/postear-libro"
import { ahoraISO, moneda } from "@/lib/formato"
import { nowArgentina } from "@/lib/utils"
import { descontarDevuelto, revSinEfecto } from "./ajuste-devoluciones"

// P2-43 (flujo de Juan 31/10/2026, definitivo — ver lib/pedidos/ajuste-devoluciones.ts):
// al ANULAR un comprobante de venta (refacturar o anular de a uno), las
// devoluciones de ESE comprobante se aplican: salen del pedido.
//  - REV de devolución: su parte de este comprobante queda SIN EFECTO (imputación
//    liberada, asiento revertido, anulada si es toda de acá). Sin documento nuevo.
//  - NC con CAE: no se puede: la anulación de la factura es por total − NC (sin ND).
//  - Devolución aceptada sin REV/NC: ya no se emite (pasa a "facturado").
// La devolución queda marcada `[aplicada:<comprobante>]` en sus observaciones; al
// volver a generar, lo devuelto de esos comprobantes no se factura
// (aplicarDevueltoAlDetalle, en generar y en el kardex).

const CREDITOS = ["NCA", "NCB", "NCC", "REV"]
const VENTAS = ["FA", "FB", "FC", "PRES"]
const CLIENTE_COLS = "id, cuit, condicion_iva, exento_iva, exento_iibb, provincia, percepcion_iibb, metodo_facturacion, metodo_limpieza, metodo_perf0, metodo_perf_plus"
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
  /** FISCAL: NC de devolución imputada al comprobante (la anulación es por total − esto) */
  menos: number
  /** Artículo → cantidad devuelta (no reingresa stock con la anulación) */
  devuelto: Map<string, number>
  /** Para el detalle del inverso fiscal */
  ncs: string[]
  textos: string[]
  advertencias: string[]
}

/**
 * Antes de emitir el inverso de un FA/FB/FC/PRES: aplica sus devoluciones
 * (REV sin efecto, pendientes marcadas, NC fiscal descontada del monto). Se
 * puede repetir: lo ya aplicado no se toca de nuevo.
 */
export async function aplicarDevolucionesAlAnular(
  supabase: SupabaseClient,
  original: { id: string; tipo_comprobante: string; numero_comprobante: string; cliente_id: string; pedido_id: string | null },
  usuarioId: string,
): Promise<DevolucionesAplicadas> {
  const res: DevolucionesAplicadas = { menos: 0, devuelto: new Map(), ncs: [], textos: [], advertencias: [] }
  if (!VENTAS.includes(original.tipo_comprobante)) return res
  const renglones = await renglonesContra(supabase, [original.id], ["confirmado", "facturado"])
  if (!renglones.length) return res
  for (const r of renglones) res.devuelto.set(r.articulo_id, (res.devuelto.get(r.articulo_id) ?? 0) + r.cantidad)

  let refPedido = `${original.tipo_comprobante} ${original.numero_comprobante}`
  if (original.pedido_id) {
    const { data: p } = await supabase.from("pedidos").select("numero_pedido").eq("id", original.pedido_id).maybeSingle()
    if (p?.numero_pedido) refPedido = `pedido ${p.numero_pedido}`
  }
  const leyenda = `Aplicada en la refacturación del ${refPedido} ${marca(original.id)}`

  // NC/REV de devolución imputadas a este comprobante
  const { data: imps } = await supabase
    .from("imputaciones")
    .select("id, monto_imputado, credito_comprobante_id, credito:comprobantes_venta!imputaciones_credito_comprobante_id_fkey(id, tipo_comprobante, numero_comprobante, observaciones, total_factura, total_neto, saldo_pendiente, anulado_en, estado_pago)")
    .eq("comprobante_id", original.id)
    .eq("estado", "confirmado")
    .not("credito_comprobante_id", "is", null)

  const porDev = new Map<string, RenglonDev[]>()
  for (const r of renglones) porDev.set(r.devolucion_id, [...(porDev.get(r.devolucion_id) || []), r])

  for (const [devId, rs] of porDev) {
    const numero = rs[0].numero
    const arts = rs.map((r) => `${r.cantidad} ${r.descripcion || "artículo"}`).join(", ")
    const deEsta = ((imps || []) as any[]).filter((i) => {
      const cr = Array.isArray(i.credito) ? i.credito[0] : i.credito
      const obs = String(cr?.observaciones || "")
      return cr && !cr.anulado_en && CREDITOS.includes(cr.tipo_comprobante) && (obs === `Devolución ${numero}` || obs.startsWith(`Devolución ${numero} `))
    })

    if (!rs[0].observaciones.includes(marca(original.id))) {
      for (const i of deEsta) {
        const cr = Array.isArray(i.credito) ? i.credito[0] : i.credito
        if (cr.tipo_comprobante === "REV") {
          res.advertencias.push(...(await dejarRevSinEfecto(supabase, original, cr, i, rs, numero, refPedido, usuarioId)))
        }
      }
      // Pendiente sin REV/NC: ya no se emite. Facturado: queda marcada.
      const obs = [rs[0].observaciones, leyenda].filter(Boolean).join(" · ")
      const { error } = await supabase.from("devoluciones").update({ estado: "facturado", observaciones: obs }).eq("id", devId)
      if (error) res.advertencias.push(`No se pudo marcar la devolución ${numero} como aplicada (${error.message}).`)
      // Kardex: lo vendible que su NC/REV había reingresado sale (la venta nueva ya no lo incluye)
      if (deEsta.length) res.advertencias.push(...(await kardexSalida(supabase, original, rs, numero, usuarioId)))
    }

    // FISCAL: la NC con CAE queda; la anulación es por lo que falta acreditar
    for (const i of deEsta) {
      const cr = Array.isArray(i.credito) ? i.credito[0] : i.credito
      if (cr.tipo_comprobante === "REV") continue
      res.menos = r2(res.menos + (Number(i.monto_imputado) || 0))
      res.ncs.push(`${cr.tipo_comprobante} ${cr.numero_comprobante}`)
    }
    const fiscal = deEsta.some((i) => (Array.isArray(i.credito) ? i.credito[0] : i.credito).tipo_comprobante !== "REV")
    res.textos.push(
      fiscal
        ? `${arts} (${numero}) salen del pedido; la NC de la devolución queda y la factura se anula por lo que falta acreditar.`
        : deEsta.length
          ? `${arts} (${numero}) salen del pedido; la REV de la devolución queda sin efecto.`
          : `${arts} (${numero}) salen del pedido; la devolución queda aplicada en la refacturación (no se emite su REV/NC).`,
    )
  }
  return res
}

/** La parte de este comprobante de la REV de una devolución queda sin efecto: imputación liberada, importe y asiento revertidos. */
async function dejarRevSinEfecto(
  supabase: SupabaseClient,
  original: { id: string; cliente_id: string },
  rev: any,
  imp: any,
  rs: RenglonDev[],
  numero: string,
  refPedido: string,
  usuarioId: string,
): Promise<string[]> {
  const avisos: string[] = []
  // Lo que vale lo devuelto de ESTE comprobante (misma regla que emitió la REV)
  const { data: cliente } = await supabase.from("clientes").select(CLIENTE_COLS).eq("id", original.cliente_id).single()
  const origenes = await origenesDeRenglones(supabase, original.cliente_id, rs.map((r) => ({ articulo_id: r.articulo_id, comprobante_venta_id: r.comprobante_venta_id, precio_venta_original: r.precio })), cliente as any)
  const contado = String(rev.observaciones || "").includes("bonificados 10% contado")
  const v = valorDevolucionConOrigen(
    rs.map((r, i) => ({ cantidad: r.cantidad, precio_venta_original: r.precio, origen: { ...origenes[i], fiscal: false, bonificado_contado: contado || origenes[i].bonificado_contado } })),
    0,
  )
  const s = revSinEfecto(Number(rev.total_factura) || 0, Math.max(v.rev.total, Number(imp.monto_imputado) || 0))

  // 1. Imputación al comprobante: se libera (el comprobante vuelve a deber eso; lo cubre la anulación)
  const monto = Number(imp.monto_imputado) || 0
  const { error: e1 } = await supabase.from("imputaciones").update({ estado: "anulado" }).eq("id", imp.id)
  if (e1) return [`REV ${rev.numero_comprobante} de ${numero} sin dejar sin efecto (${e1.message}): revisala a mano.`]
  const { data: deb } = await supabase.from("comprobantes_venta").select("saldo_pendiente, total_factura").eq("id", original.id).single()
  const totalDeb = Math.abs(Number(deb?.total_factura) || 0)
  const nuevoSaldo = r2(Math.min(totalDeb, (Number(deb?.saldo_pendiente) || 0) + monto))
  await supabase.from("comprobantes_venta").update({
    saldo_pendiente: nuevoSaldo,
    estado_pago: nuevoSaldo <= 0.005 ? "pagado" : nuevoSaldo >= totalDeb - 0.005 ? "pendiente" : "parcial",
  }).eq("id", original.id)

  // 2. La REV: entera → anulada; mezclada → queda solo por lo de otros orígenes
  const obsRev = `${rev.observaciones || ""} · ${s.entera ? "Sin efecto" : `${moneda(s.parte)} sin efecto`}: aplicada en la refacturación del ${refPedido}`
  if (s.entera) {
    await supabase.from("comprobantes_venta").update({ estado_pago: "anulado", saldo_pendiente: 0, anulado_en: nowArgentina(), observaciones: obsRev }).eq("id", rev.id)
  } else {
    const { data: vivas } = await supabase.from("imputaciones").select("monto_imputado").eq("credito_comprobante_id", rev.id).eq("estado", "confirmado")
    const imputado = ((vivas || []) as any[]).reduce((a, x) => a + (Number(x.monto_imputado) || 0), 0)
    const saldo = r2(-(s.queda - imputado))
    await supabase.from("comprobantes_venta").update({
      total_factura: -s.queda,
      total_neto: r2(Number(rev.total_neto || rev.total_factura) + s.parte),
      saldo_pendiente: Math.min(0, saldo),
      estado_pago: saldo >= -0.005 ? "pagado" : imputado > 0.005 ? "parcial" : "pendiente",
      observaciones: obsRev,
    }).eq("id", rev.id)
    // El detalle sigue sumando el neto: un renglón por la parte que quedó sin efecto
    await supabase.from("comprobantes_venta_detalle").insert({
      comprobante_id: rev.id,
      articulo_id: null,
      descripcion: `Sin efecto: ${rs.map((r) => `${r.cantidad} ${r.descripcion || "artículo"}`).join(", ")} (aplicado en la refacturación del ${refPedido})`,
      cantidad: 1,
      precio_unitario: s.parte,
      precio_total: s.parte,
    })
  }

  // 3. Asiento revertido (la REV había posteado un haber)
  const aviso = await postearLibroConAviso(supabase, {
    p_cliente_id: original.cliente_id,
    p_tipo_movimiento: "nota_credito",
    p_debe: s.parte,
    p_haber: 0,
    p_referencia_tipo: "comprobante_venta",
    p_referencia_id: rev.id,
    p_numero_comprobante: rev.numero_comprobante,
    p_observaciones: `REV ${rev.numero_comprobante} (${numero}) sin efecto${s.entera ? "" : ` por ${moneda(s.parte)}`}: aplicada en la refacturación del ${refPedido}`,
    p_usuario_id: usuarioId,
  }, `REV ${rev.numero_comprobante} sin efecto`)
  if (aviso) avisos.push(aviso)
  return avisos
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
  let renglones = await renglonesContra(supabase, [...tipoDe.keys()], ["confirmado", "facturado"])
  if (opts.anulados) renglones = renglones.filter((r) => r.observaciones.includes(marca(r.comprobante_venta_id)))
  if (!renglones.length) return []
  const devIds = [...new Set(renglones.map((r) => r.devolucion_id))]
  const { data: todos } = await supabase.from("devoluciones_detalle").select("devolucion_id, comprobante_venta_id, cantidad, estado_renglon").in("devolucion_id", devIds)
  const aparte = new Set(((todos || []) as any[]).filter((d) => !tipoDe.has(d.comprobante_venta_id) && d.estado_renglon !== "rechazado" && Number(d.cantidad) > 0).map((d) => d.devolucion_id))
  return devIds.map((id) => {
    const rs = renglones.filter((r) => r.devolucion_id === id)
    const fiscal = rs.some((r) => tipoDe.get(r.comprobante_venta_id) !== "PRES")
    const sinCredito = rs[0].estado !== "facturado"
    const articulos = rs.map((r) => `${r.cantidad} ${r.descripcion || "artículo"}`).join(", ")
    const texto = `${articulos} (${rs[0].numero}) ${opts.anulados ? "no van" : "salen"} del comprobante nuevo` +
      (opts.anulados
        ? " (devueltos, aplicados en la refacturación)."
        : sinCredito
          ? "; la devolución queda aplicada en la refacturación (no se emite su REV/NC)."
          : fiscal
            ? "; la NC de la devolución queda y la factura se anula por lo que falta acreditar (sin ND)."
            : "; la REV de la devolución queda sin efecto.") +
      (aparte.has(id) ? " Lo que trae de otros comprobantes o del sistema viejo queda aparte, acreditado." : "")
    return { numero: rs[0].numero, articulos, aparte: aparte.has(id), fiscal, sin_credito: sinCredito, texto }
  })
}
