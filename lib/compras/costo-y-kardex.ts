/**
 * Lo que la validación de una factura de compra le hace al COSTO y al KARDEX (E-23, E-98, E-31,
 * E-46). No mueve plata ni stock y es repetible: se puede correr dos veces sin duplicar nada.
 *
 * Una sola fuente por cosa:
 *   · Kardex de compra CONFIRMADO = el de la recepción (lo que entró al stock, cuando entró).
 *     Validar la factura lo VALORIZA con el precio facturado (lista, neto y costo por unidad).
 *   · Kardex de compra PENDIENTE = "mercadería en camino" de la orden (lo crea la orden de
 *     compra con fecha estimada; lo usa la sugerencia de compra). Antes validar lo pasaba a
 *     "confirmado" y quedaban DOS compras del mismo artículo (la de la recepción y esta, con
 *     fecha futura). Ahora el pendiente refleja solo lo que falta recibir: baja con cada
 *     entrega y desaparece cuando llegó todo o la orden se cierra.
 *     QUIÉN LO ESCRIBE (dos funciones que no se pisan):
 *       - Antes de la primera recepción: `oc_kardex_pendiente_sincronizar` (SQL, 20261117n), al
 *         crear, editar o cancelar la orden. Pone lo pedido completo; al cancelar lo borra.
 *       - Desde la primera recepción: `sincronizarKardexEnCamino` (acá), con cada entrega, cada
 *         validación y al finalizar. Lo baja a lo que falta recibir.
 *       Una orden con recepción ya no se puede editar ni cancelar (lo impiden oc_guardar y
 *       oc_cancelar), así que nunca corren las dos sobre la misma orden.
 *   · articulos.ultimo_costo = neto por unidad de la última factura validada, con el descuento
 *     al pie de la factura ya repartido. Cada cambio queda en precios_compra_historial.
 *     articulos.precio_compra (la lista) NO se toca acá: cambia SOLO cuando alguien elige "la
 *     empresa asume" al resolver una diferencia de precio (y también queda en el historial).
 */

import { netoCompra } from "./neto-compra"
import { faltaLaColumna } from "@/lib/utils/migracion-pendiente"
import { tipoDescuentoProveedor } from "./tipo-descuento-proveedor"
import { esComprobanteConPrecios } from "./finalizar-oc"
import { pendientesDeOrden } from "@/lib/deposito/recepciones"
import { unidadesPorBultoDe } from "@/lib/deposito/unidades"

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/**
 * Deja el kardex "en camino" (compra pendiente) de la orden igual a lo que falta recibir.
 * `cerrada`: la orden se finalizó o canceló ⇒ ya no hay nada en camino.
 */
export async function sincronizarKardexEnCamino(supabase: any, ordenId: string, opts: { cerrada?: boolean } = {}): Promise<{ borrados: number; ajustados: number }> {
  const { data: filas, error } = await supabase
    .from("kardex")
    .select("id, articulo_id, cantidad, precio_unitario_final")
    .eq("orden_compra_id", ordenId)
    .eq("tipo_movimiento", "compra")
    .eq("estado", "pendiente")
  if (error) throw error
  if (!filas || filas.length === 0) return { borrados: 0, ajustados: 0 }

  // Una orden finalizada o cancelada no tiene nada en camino, la llame quien la llame: quien
  // CANCELA una orden tiene que llamar a esta función después de cambiarle el estado.
  let cerrada = !!opts.cerrada
  if (!cerrada) {
    const { data: oc } = await supabase.from("ordenes_compra").select("estado").eq("id", ordenId).maybeSingle()
    cerrada = !oc || ["finalizada", "cancelada"].includes(oc.estado)
  }
  const pendientes = cerrada ? new Map<string, { base: number }>() : await pendientesDeOrden(supabase, ordenId)
  const borrar: string[] = []
  let ajustados = 0
  const vistos = new Set<string>()
  for (const k of filas) {
    const p = pendientes.get(k.articulo_id)
    // Sin nada pendiente, o fila repetida del mismo artículo: se va
    if (!p || vistos.has(k.articulo_id)) { borrar.push(k.id); continue }
    vistos.add(k.articulo_id)
    if (Math.abs(num(k.cantidad) - p.base) > 0.0001) {
      const subtotal = r2(num(k.precio_unitario_final) * p.base)
      const { error: updErr } = await supabase.from("kardex").update({ cantidad: p.base, subtotal_neto: subtotal, subtotal_total: subtotal }).eq("id", k.id)
      if (updErr) throw updErr
      ajustados++
    }
  }
  for (let i = 0; i < borrar.length; i += 200) {
    const { error: delErr } = await supabase.from("kardex").delete().in("id", borrar.slice(i, i + 200))
    if (delErr) throw delErr
  }
  return { borrados: borrar.length, ajustados }
}

export interface ResultadoCosto {
  /** Artículos a los que se les actualizó el último costo */
  costos_actualizados: number
  /** Movimientos de kardex de la recepción valorizados con esta factura */
  kardex_valorizados: number
  /** Cambios de último costo que NO se pudieron anotar en el historial (se avisa en pantalla) */
  historial_fallas: number
  /** Suma de los renglones (neto) y neto del comprobante, para avisar si no cierran (E-46) */
  neto_renglones: number
  neto_comprobante: number
}

/**
 * Al validar un comprobante CON precios de una orden: valoriza el kardex de la recepción con
 * lo facturado y deja el último costo de cada artículo. Las notas de crédito / débito y los
 * remitos no pasan por acá.
 */
/**
 * `soloArticulos`: recalcular solo esos artículos (cuando se resuelve una diferencia de precio
 * después de validada la factura).
 *
 * Diferencia de precio RECLAMADA al proveedor (queda una nota de crédito esperada): el costo del
 * artículo es el precio de la ORDEN, que es lo que se termina pagando. Aceptada por la empresa: el
 * precio facturado. Sin resolver todavía: el facturado, y se corrige solo cuando se resuelve.
 */
export async function aplicarCostoDeFactura(supabase: any, comprobante: any, ocId: string | null, soloArticulos?: readonly string[] | null): Promise<ResultadoCosto> {
  const { data: detalle, error: detErr } = await supabase
    .from("comprobantes_compra_detalle")
    .select("articulo_id, cantidad_facturada, precio_unitario, descuento1, descuento2, descuento3, descuento4, tipo_cantidad, recepcion_item_id, match_estado")
    .eq("comprobante_id", comprobante.id)
  if (detErr) throw detErr
  const lineas: any[] = detalle || []
  const descuentos = (l: any) => [l.descuento1, l.descuento2, l.descuento3, l.descuento4].map(num)
  // Los descuentos del renglón se aplican como dice la ficha del proveedor (en cascada o sobre la lista)
  const tipoDto = await tipoDescuentoProveedor(supabase, comprobante.proveedor_id)

  // E-46: lo que suman los renglones (todos, también flete y demás conceptos) contra el neto del comprobante
  const netoRenglones = r2(lineas.reduce((s, l) => s + r2(num(l.cantidad_facturada) * netoCompra(l.precio_unitario, descuentos(l), tipoDto)), 0))
  const netoComprobante = r2(
    num(comprobante.total_neto) > 0
      ? num(comprobante.total_neto)
      : num(comprobante.total_factura_declarado) - num(comprobante.total_iva) - num(comprobante.percepcion_iva_monto) - num(comprobante.percepcion_iibb_monto),
  )
  const resultado: ResultadoCosto = { costos_actualizados: 0, kardex_valorizados: 0, historial_fallas: 0, neto_renglones: netoRenglones, neto_comprobante: netoComprobante }
  if (!esComprobanteConPrecios(comprobante.tipo_comprobante)) return resultado

  const conArticulo = lineas.filter((l) => !!l.articulo_id)
  if (conArticulo.length === 0) return resultado
  const idsArt = [...new Set(conArticulo.map((l) => l.articulo_id as string))]

  // Factor de cada renglón por bulto: el que usó la lectura (línea de recepción) o las unidades por bulto
  const itemIds = [...new Set(conArticulo.filter((l) => l.tipo_cantidad === "bulto" && l.recepcion_item_id).map((l) => l.recepcion_item_id as string))]
  const factorItem = new Map<string, number>()
  if (itemIds.length > 0) {
    const { data: its } = await supabase.from("recepciones_items").select("id, factor_conversion").in("id", itemIds)
    for (const it of its || []) factorItem.set(it.id, num(it.factor_conversion))
  }
  const { data: arts, error: artErr } = await supabase.from("articulos").select("id, unidades_por_bulto, ultimo_costo, precio_compra, descuento1, descuento2, descuento3, descuento4").in("id", idsArt)
  if (artErr) throw artErr
  const art = new Map<string, any>((arts || []).map((a: any) => [a.id, a]))

  // Descuento al pie de la factura (un % sobre todos los renglones): también baja el costo. Se
  // reparte parejo, que es como lo aplica el proveedor. La lista del renglón no cambia.
  const dtoPie = num(comprobante.descuento_fuera_factura)
  const factorPie = dtoPie > 0 && dtoPie <= 100 ? 1 - dtoPie / 100 : 1

  // Precio por unidad de cada artículo: el primer renglón CON cargo (lo bonificado no baja el costo)
  const precio = new Map<string, { lista: number; neto: number; reclamado?: boolean }>()
  for (const l of conArticulo) {
    if (precio.has(l.articulo_id)) continue
    const neto = netoCompra(l.precio_unitario, descuentos(l), tipoDto) * factorPie
    if (!(neto > 0)) continue
    const f = l.tipo_cantidad === "bulto" ? ((factorItem.get(l.recepcion_item_id) || 0) > 1 ? factorItem.get(l.recepcion_item_id)! : unidadesPorBultoDe(art.get(l.articulo_id)?.unidades_por_bulto)) : 1
    precio.set(l.articulo_id, { lista: r4(num(l.precio_unitario) / f), neto: r4(neto / f) })
  }
  // Diferencias de precio de esta orden que se le RECLAMARON al proveedor: el costo de esos
  // artículos es el de la orden (lista y descuentos de la orden), no el facturado.
  if (ocId && precio.size > 0) {
    const { data: reclamos, error: recErr } = await supabase
      .from("recepciones_diferencias")
      .select("articulo_id")
      .eq("orden_compra_id", ocId)
      .eq("tipo", "precio")
      .in("destino", ["proveedor", "descuento_fuera_factura"])
    if (recErr) console.warn("[costo] no se pudieron leer los reclamos de precio de la orden:", recErr.message)
    const reclamados = [...new Set(((reclamos || []) as any[]).map((r) => r.articulo_id).filter((id) => id && precio.has(id)))] as string[]
    if (reclamados.length > 0) {
      const { data: ocDet } = await supabase
        .from("ordenes_compra_detalle")
        .select("articulo_id, precio_unitario, descuento1, descuento2, descuento3, descuento4")
        .eq("orden_compra_id", ocId)
        .in("articulo_id", reclamados)
      for (const d of (ocDet || []) as any[]) {
        const netoOC = netoCompra(d.precio_unitario, descuentos(d), tipoDto)
        // el precio de la orden es siempre por unidad; el primer renglón del artículo manda
        if (netoOC > 0 && precio.get(d.articulo_id)?.reclamado !== true) precio.set(d.articulo_id, { lista: r4(num(d.precio_unitario)), neto: r4(netoOC), reclamado: true })
      }
    }
  }
  if (soloArticulos) {
    const solo = new Set(soloArticulos)
    for (const id of [...precio.keys()]) if (!solo.has(id)) precio.delete(id)
  }
  if (precio.size === 0) return resultado

  // ── Último costo del artículo ──
  for (const [articuloId, p] of precio) {
    if (Math.abs(num(art.get(articuloId)?.ultimo_costo) - p.neto) < 0.00005) continue
    const { error } = await supabase.from("articulos").update({ ultimo_costo: p.neto }).eq("id", articuloId)
    if (error) throw error
    resultado.costos_actualizados++
    const a = art.get(articuloId)
    const anotado = await registrarCostoEnHistorial(supabase, {
      articulo_id: articuloId, proveedor_id: comprobante.proveedor_id ?? null,
      // la lista no cambió: se anota la que el artículo tiene, y el último costo nuevo al lado
      precio_compra: num(a?.precio_compra), descuentos: [a?.descuento1, a?.descuento2, a?.descuento3, a?.descuento4].map(num),
      ultimo_costo: p.neto, origen: "factura", comprobante_compra_id: comprobante.id, orden_compra_id: ocId,
    })
    if (!anotado) resultado.historial_fallas++
  }

  // ── Kardex de la recepción de esta orden: queda valorizado con lo facturado ──
  if (ocId) {
    const { data: recs } = await supabase.from("recepciones").select("id").eq("orden_compra_id", ocId).neq("estado", "cancelada")
    const recIds = (recs || []).map((r: any) => r.id)
    // Entregas que ESTA factura documenta, por artículo (por la línea de recepción a la que quedó
    // ligado cada renglón). Con dos facturas y dos entregas, cada una valoriza la suya.
    const entregasDe = new Map<string, Set<string>>()
    const ligados = [...new Set(conArticulo.filter((l) => l.recepcion_item_id).map((l) => l.recepcion_item_id as string))]
    if (ligados.length > 0) {
      const { data: its } = await supabase.from("recepciones_items").select("id, recepcion_id").in("id", ligados)
      const recDe = new Map<string, string>((its || []).map((i: any) => [i.id, i.recepcion_id]))
      for (const l of conArticulo) {
        const rid = l.recepcion_item_id ? recDe.get(l.recepcion_item_id) : null
        if (!rid) continue
        if (!entregasDe.has(l.articulo_id)) entregasDe.set(l.articulo_id, new Set())
        entregasDe.get(l.articulo_id)!.add(rid)
      }
    }
    if (recIds.length > 0) {
      const { data: movs, error: movErr } = await supabase
        .from("kardex")
        .select("id, articulo_id, cantidad, precio_unitario_final, precio_costo, comprobante_compra_id, recepcion_id")
        .in("recepcion_id", recIds)
        .eq("tipo_movimiento", "compra")
        .in("articulo_id", [...precio.keys()])
      if (movErr) throw movErr
      const esAdquisicion = comprobante.tipo_comprobante === "Adquisicion" || comprobante.tipo_comprobante === "ADQ"
      for (const k of movs || []) {
        const p = precio.get(k.articulo_id)!
        // Lo que ya valorizó OTRA factura de la misma orden no se pisa (la segunda factura no
        // revaloriza la mercadería de la primera)
        if (k.comprobante_compra_id && k.comprobante_compra_id !== comprobante.id) continue
        // Si la factura está ligada a entregas concretas, solo valoriza esas
        const entregas = entregasDe.get(k.articulo_id)
        if (entregas && entregas.size > 0 && k.recepcion_id && !entregas.has(k.recepcion_id)) continue
        // Ya valorizado por este mismo comprobante: no se toca
        if (k.comprobante_compra_id === comprobante.id && Math.abs(num(k.precio_unitario_final) - p.neto) < 0.00005 && Math.abs(num(k.precio_costo) - p.neto) < 0.00005) continue
        const subtotal = r2(p.neto * num(k.cantidad))
        const { error } = await supabase.from("kardex").update({
          precio_lista: p.lista,
          precio_unitario_final: p.neto,
          precio_costo: p.neto,
          subtotal_neto: subtotal,
          subtotal_total: subtotal,
          comprobante_compra_id: comprobante.id,
          proveedor_id: comprobante.proveedor_id ?? undefined,
          color_dinero: esAdquisicion ? "NEGRO" : "BLANCO",
        }).eq("id", k.id)
        if (error) throw error
        resultado.kardex_valorizados++
      }
    }
  }
  return resultado
}

/**
 * Deja registro de un cambio de costo en precios_compra_historial: de la LISTA (precio_compra y
 * descuentos) o solo del ÚLTIMO COSTO (`ultimo_costo` + `origen`, columnas de la migración
 * 20261117b). No frena la operación: devuelve false si no se pudo anotar, y quien llama lo
 * muestra en pantalla.
 */
export async function registrarCostoEnHistorial(supabase: any, p: {
  articulo_id: string; proveedor_id: string | null; precio_compra: number; descuentos: number[]
  ultimo_costo?: number | null; origen?: string | null; comprobante_compra_id?: string | null; orden_compra_id?: string | null; usuario_id?: string | null
}): Promise<boolean> {
  const [d1 = 0, d2 = 0, d3 = 0, d4 = 0] = p.descuentos
  // Columnas reales de la tabla (scripts/001): el insert viejo usaba otras y fallaba en silencio (E-21)
  const fila = {
    articulo_id: p.articulo_id,
    proveedor_id: p.proveedor_id,
    precio_compra: r2(p.precio_compra),
    descuento1: d1, descuento2: d2, descuento3: d3, descuento4: d4,
  }
  const conExtras = p.ultimo_costo != null || !!p.origen
  const extras = { ultimo_costo: p.ultimo_costo ?? null, origen: p.origen ?? null, comprobante_compra_id: p.comprobante_compra_id ?? null, orden_compra_id: p.orden_compra_id ?? null, usuario_id: p.usuario_id ?? null }
  const { error } = await supabase.from("precios_compra_historial").insert(conExtras ? { ...fila, ...extras } : fila)
  if (!error) return true
  if (conExtras && faltaLaColumna(error)) {
    // Migración 20261117b sin aplicar. Un cambio de LISTA se anota igual con las columnas de siempre;
    // un cambio de solo último costo no tiene dónde anotarse todavía (no es una falla de la operación).
    if (p.origen !== "factura" && p.origen !== "bonificado") {
      const viejo = await supabase.from("precios_compra_historial").insert(fila)
      if (!viejo.error) return true
      console.error("[costo] no se pudo guardar el historial de costo:", viejo.error.message)
      return false
    }
    console.warn("[costo] historial de último costo: falta la migración 20261117b")
    return true
  }
  console.error("[costo] no se pudo guardar el historial de costo:", error.message)
  return false
}
