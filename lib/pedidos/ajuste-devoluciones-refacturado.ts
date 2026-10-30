import type { SupabaseClient } from "@supabase/supabase-js"
import { alicuotaIIBBVigente, origenesDeRenglones } from "@/lib/cobranzas/origen-devolucion"
import { emitirComprobanteAjuste } from "@/lib/comprobantes/emitir-ajuste"
import { insertarKardex } from "@/lib/kardex/insertar-kardex"
import { ahoraISO, moneda } from "@/lib/formato"
import { nowArgentina } from "@/lib/utils"
import { descontarDevuelto, neutralizacionDevolucion, tipoNeutralizacion, type Neutralizacion, type RenglonDevuelto } from "./ajuste-devoluciones"
import { MOTIVO_AJUSTE_DEVOLUCION } from "./devolucion-en-anulaciones"

// P2-43 (regla de Juan 31/10/2026, 2ª versión): la refacturación sale SIN los
// artículos devueltos (lib/pedidos/ajuste-devoluciones.ts).
//  - Cantidad a facturar = lo preparado − lo devuelto contra los comprobantes
//    ANULADOS de este pedido (generar/route.ts y el kardex, con
//    aplicarDevueltoAlDetalle).
//  - El crédito de esa parte de la devolución se neutraliza con un débito (PRES
//    si fue REV, ND con CAE si fue NC) que cubre el crédito de la anulación (lo
//    devuelto vive ahí): refacturar.ts lo imputa primero a estos débitos.
//  - Lo devuelto de otros comprobantes o del sistema viejo queda aparte.
//  - Stock: la devolución ya reingresó lo vendible y la anulación vuelve a
//    reingresar todo el comprobante anulado; como el nuevo no lo descuenta, la
//    neutralización saca lo vendible devuelto (stock y kardex).

const VENTAS = ["FA", "FB", "FC", "PRES"]
const CREDITOS = ["NCA", "NCB", "NCC", "REV"]
const CLIENTE_COLS = "id, cuit, condicion_iva, exento_iva, exento_iibb, provincia, percepcion_iibb, metodo_facturacion, metodo_limpieza, metodo_perf0, metodo_perf_plus"
const prefijo = (numero: string) => `Neutraliza devolución ${numero}`

interface CompRef {
  id: string
  tipo_comprobante: string
  numero_comprobante: string
}

interface RenglonBase {
  id: string
  devolucion_id: string
  numero: string
  articulo_id: string
  descripcion: string | null
  cantidad: number
  precio: number
  comprobante_venta_id: string
  es_vendible: boolean
  estado_dev: string
}

/** Renglones de devoluciones aceptadas contra los comprobantes ANULADOS de este pedido. */
async function renglonesDevueltosDelPedido(supabase: SupabaseClient, pedidoId: string, estados: string[]) {
  const { data: comps } = await supabase
    .from("comprobantes_venta")
    .select("id, tipo_comprobante, numero_comprobante, anulado_en, cliente_id")
    .eq("pedido_id", pedidoId)
    .in("tipo_comprobante", VENTAS)
  const anulados = ((comps || []) as any[]).filter((c) => c.anulado_en)
  if (!anulados.length) return { renglones: [] as RenglonBase[], clienteId: null as string | null }
  const { data: det } = await supabase
    .from("devoluciones_detalle")
    .select("id, devolucion_id, articulo_id, cantidad, precio_venta_original, estado_renglon, es_vendible, comprobante_venta_id, articulo:articulos!devoluciones_detalle_articulo_id_fkey(descripcion), devolucion:devoluciones!inner(id, numero_devolucion, estado)")
    .in("comprobante_venta_id", anulados.map((c) => c.id))
  const renglones: RenglonBase[] = []
  for (const d of (det || []) as any[]) {
    const dev = Array.isArray(d.devolucion) ? d.devolucion[0] : d.devolucion
    if (!estados.includes(dev?.estado) || d.estado_renglon === "rechazado" || !(Number(d.cantidad) > 0)) continue
    const art = Array.isArray(d.articulo) ? d.articulo[0] : d.articulo
    renglones.push({
      id: d.id,
      devolucion_id: d.devolucion_id,
      numero: dev?.numero_devolucion || d.devolucion_id,
      articulo_id: d.articulo_id,
      descripcion: art?.descripcion ?? null,
      cantidad: Number(d.cantidad) || 0,
      precio: Number(d.precio_venta_original) || 0,
      comprobante_venta_id: d.comprobante_venta_id,
      es_vendible: d.es_vendible !== false,
      estado_dev: dev?.estado,
    })
  }
  return { renglones, clienteId: (anulados[0] as any).cliente_id as string }
}

/** Artículo → cantidad devuelta (devoluciones facturadas) contra los comprobantes anulados del pedido. */
export async function devueltoDelPedidoPorArticulo(supabase: SupabaseClient, pedidoId: string): Promise<Map<string, number>> {
  const { renglones } = await renglonesDevueltosDelPedido(supabase, pedidoId, ["facturado"])
  const out = new Map<string, number>()
  for (const r of renglones) out.set(r.articulo_id, (out.get(r.articulo_id) ?? 0) + r.cantidad)
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

export interface NeutralizacionPlaneada extends Neutralizacion {
  tipo: string
  /** La NC/REV de la devolución que se neutraliza (asociado de la ND) */
  credito: CompRef | null
  /** Ya emitida (un refacturar anterior): no se repite */
  ya: boolean
}

export interface PlanDevolucion {
  devolucion_id: string
  numero: string
  cliente_id: string
  /** Artículos que salen del comprobante nuevo */
  articulos: Array<{ articulo_id: string; descripcion: string | null; cantidad: number; es_vendible: boolean; fiscal: boolean }>
  neutralizaciones: NeutralizacionPlaneada[]
  /** La devolución también trae mercadería de otros comprobantes o del sistema viejo (queda aparte) */
  con_parte_aparte: boolean
  alicuota_iibb: number
  texto: string
}

/** Qué sale del comprobante nuevo y qué se neutraliza, por devolución. */
export async function planNeutralizacion(supabase: SupabaseClient, pedidoId: string): Promise<PlanDevolucion[]> {
  const { renglones, clienteId } = await renglonesDevueltosDelPedido(supabase, pedidoId, ["facturado"])
  if (!renglones.length || !clienteId) return []
  const { data: cliente } = await supabase.from("clientes").select(CLIENTE_COLS).eq("id", clienteId).single()

  const devIds = [...new Set(renglones.map((r) => r.devolucion_id))]
  const numeros = [...new Set(renglones.map((r) => r.numero))]
  const [origenes, alicuota, creditos, yaHechas, todosRenglones] = await Promise.all([
    origenesDeRenglones(
      supabase,
      clienteId,
      renglones.map((r) => ({ articulo_id: r.articulo_id, comprobante_venta_id: r.comprobante_venta_id, precio_venta_original: r.precio })),
      cliente as any,
    ),
    alicuotaIIBBVigente(supabase, (cliente || {}) as any),
    creditosDeDevoluciones(supabase, clienteId, numeros),
    neutralizacionesHechas(supabase, clienteId, numeros),
    supabase.from("devoluciones_detalle").select("id, devolucion_id, estado_renglon, cantidad").in("devolucion_id", devIds),
  ])
  const propios = new Set(renglones.map((r) => r.id))
  const conAparte = new Set(
    ((todosRenglones.data || []) as any[])
      .filter((d) => !propios.has(d.id) && d.estado_renglon !== "rechazado" && Number(d.cantidad) > 0)
      .map((d) => d.devolucion_id),
  )

  const out: PlanDevolucion[] = []
  for (const devId of devIds) {
    const idx = renglones.map((r, i) => (r.devolucion_id === devId ? i : -1)).filter((i) => i >= 0)
    const numero = renglones[idx[0]].numero
    const items: RenglonDevuelto[] = idx.map((i) => {
      // El 10 % con que se acreditó: la anulación ya bajó la NC/REV del contado, se toma de la emisión
      const cr = creditos.get(`${numero}|${origenes[i].fiscal}`)
      return {
        id: renglones[i].id,
        articulo_id: renglones[i].articulo_id,
        descripcion: renglones[i].descripcion,
        cantidad: renglones[i].cantidad,
        precio: renglones[i].precio,
        origen: { ...origenes[i], bonificado_contado: cr?.contado ?? origenes[i].bonificado_contado },
      }
    })
    const neutralizaciones: NeutralizacionPlaneada[] = neutralizacionDevolucion(items, alicuota).map((n) => {
      const cr = creditos.get(`${numero}|${n.fiscal}`) ?? null
      return {
        ...n,
        tipo: tipoNeutralizacion(n.fiscal, cr?.tipo_comprobante),
        credito: cr ? { id: cr.id, tipo_comprobante: cr.tipo_comprobante, numero_comprobante: cr.numero_comprobante } : null,
        ya: yaHechas.has(`${numero}|${n.fiscal}`),
      }
    })
    const articulos = idx.map((i, k) => ({
      articulo_id: renglones[i].articulo_id,
      descripcion: renglones[i].descripcion,
      cantidad: renglones[i].cantidad,
      es_vendible: renglones[i].es_vendible,
      fiscal: items[k].origen.fiscal,
    }))
    out.push({
      devolucion_id: devId,
      numero,
      cliente_id: clienteId,
      articulos,
      neutralizaciones,
      con_parte_aparte: conAparte.has(devId),
      alicuota_iibb: alicuota,
      texto: textoPlan(numero, articulos, neutralizaciones, conAparte.has(devId)),
    })
  }
  return out
}

function textoPlan(numero: string, articulos: PlanDevolucion["articulos"], ns: NeutralizacionPlaneada[], aparte: boolean): string {
  const arts = articulos.map((a) => `${a.cantidad} ${a.descripcion || "artículo"}`).join(", ")
  const pendientes = ns.filter((n) => !n.ya)
  const neut = pendientes.length
    ? ` Se neutraliza ${pendientes.map((n) => `${n.credito ? `la ${n.credito.tipo_comprobante} ${n.credito.numero_comprobante}` : "el crédito"} por ${moneda(n.total)} con ${n.fiscal ? `una ${n.tipo} (con CAE en ARCA)` : "un PRES"}`).join(" y ")}.`
    : ""
  const resto = aparte ? ` Lo que la devolución ${numero} trae de otros comprobantes o del sistema viejo queda aparte y sigue acreditado.` : ""
  return `Salen del comprobante nuevo por estar devueltos (${numero}): ${arts}.${neut}${resto}`
}

/** NC/REV emitidas por cada devolución (la que se neutraliza) y si salieron con el 10 % contado. Clave numero|fiscal. */
async function creditosDeDevoluciones(supabase: SupabaseClient, clienteId: string, numeros: string[]) {
  const out = new Map<string, CompRef & { contado: boolean }>()
  for (const numero of numeros) {
    const { data } = await supabase
      .from("comprobantes_venta")
      .select("id, tipo_comprobante, numero_comprobante, observaciones")
      .eq("cliente_id", clienteId)
      .in("tipo_comprobante", CREDITOS)
      .is("anulado_en", null)
      .ilike("observaciones", `Devolución ${numero}%`)
    for (const c of (data || []) as any[]) {
      const obs = String(c.observaciones || "")
      if (obs !== `Devolución ${numero}` && !obs.startsWith(`Devolución ${numero} `)) continue
      const clave = `${numero}|${c.tipo_comprobante !== "REV"}`
      if (!out.has(clave)) out.set(clave, { id: c.id, tipo_comprobante: c.tipo_comprobante, numero_comprobante: c.numero_comprobante, contado: obs.includes("bonificados 10% contado") })
    }
  }
  return out
}

/** Neutralizaciones ya emitidas (vivas). Clave numero|fiscal. */
async function neutralizacionesHechas(supabase: SupabaseClient, clienteId: string, numeros: string[]) {
  const out = new Set<string>()
  if (!numeros.length) return out
  const { data } = await supabase
    .from("comprobantes_venta")
    .select("tipo_comprobante, observaciones")
    .eq("cliente_id", clienteId)
    .eq("motivo_ajuste", MOTIVO_AJUSTE_DEVOLUCION)
    .is("anulado_en", null)
  for (const c of (data || []) as any[]) {
    const obs = String(c.observaciones || "")
    for (const n of numeros) if (obs === prefijo(n) || obs.startsWith(prefijo(n) + " ")) out.add(`${n}|${c.tipo_comprobante !== "PRES"}`)
  }
  return out
}

export interface ResultadoNeutralizacion {
  emitidos: Array<{ devolucion: string; id: string; tipo: string; numero: string; total: number }>
  /** Débitos de neutralización: los cubre el crédito de la anulación (refacturar.ts) */
  debitosIds: string[]
  textos: string[]
  advertencias: string[]
}

/** Al emitir el comprobante nuevo de un pedido refacturado: neutraliza el crédito de lo devuelto de este pedido. */
export async function neutralizarDevolucionesRefacturadas(supabase: SupabaseClient, pedidoId: string, usuarioId: string): Promise<ResultadoNeutralizacion> {
  const res: ResultadoNeutralizacion = { emitidos: [], debitosIds: [], textos: [], advertencias: [] }
  const plan = await planNeutralizacion(supabase, pedidoId)
  for (const p of plan) {
    res.textos.push(p.texto)
    // Fiscal primero (si ARCA falla, no queda un PRES suelto de una neutralización a medias)
    for (const n of [...p.neutralizaciones].sort((x, y) => Number(y.fiscal) - Number(x.fiscal))) {
      if (n.ya) continue
      try {
        const em = await emitirComprobanteAjuste(supabase, {
          tipo: n.tipo,
          clienteId: p.cliente_id,
          neto: n.neto,
          iva: n.iva,
          baseIva: n.baseIva,
          percepcionIva: n.percepcionIva,
          percepcionIibb: n.percepcionIibb,
          alicuotaIIBB: p.alicuota_iibb,
          detalle: n.detalle.map((d) => ({ articulo_id: d.articulo_id, descripcion: `${d.descripcion || "Artículo"} — devuelto, sale del pedido refacturado`, cantidad: d.cantidad, neto: d.neto })),
          asociado: n.credito,
          observaciones: `${prefijo(p.numero)} — parte del pedido refacturado${n.credito ? ` (${n.credito.tipo_comprobante} ${n.credito.numero_comprobante})` : ""}`,
          motivo: MOTIVO_AJUSTE_DEVOLUCION,
          usuarioId,
        })
        res.emitidos.push({ devolucion: p.numero, id: em.id, tipo: em.tipo, numero: em.numero, total: em.total })
        res.debitosIds.push(em.id)
        res.advertencias.push(...em.advertencias)
        res.advertencias.push(...(await sacarStockDevuelto(supabase, p, n.fiscal, em, usuarioId)))
      } catch (e: any) {
        res.advertencias.push(`No se pudo neutralizar la devolución ${p.numero} (${n.tipo} por ${moneda(n.total)}): ${e?.message || e}. Emitilo a mano.`)
        break
      }
    }
  }
  return res
}

/** La anulación reingresó lo que la devolución ya había reingresado: se saca lo vendible (stock y kardex). */
async function sacarStockDevuelto(supabase: SupabaseClient, p: PlanDevolucion, fiscal: boolean, em: { id: string; tipo: string; numero: string }, usuarioId: string): Promise<string[]> {
  const avisos: string[] = []
  const arts = p.articulos.filter((a) => a.fiscal === fiscal && a.es_vendible && a.cantidad > 0)
  if (!arts.length) return avisos
  const { data: info } = await supabase.from("articulos").select("id, sku, descripcion, categoria, marca_id, proveedor_id, iva_compras, iva_ventas").in("id", arts.map((a) => a.articulo_id))
  const infoDe = new Map(((info || []) as any[]).map((a) => [a.id, a]))
  for (const a of arts) {
    try {
      await supabase.rpc("increment_stock_actual", { p_articulo_id: a.articulo_id, p_cantidad: -a.cantidad })
      await supabase.from("movimientos_stock").insert({
        articulo_id: a.articulo_id,
        tipo_movimiento: "salida",
        cantidad: a.cantidad,
        precio_unitario: 0,
        fecha_movimiento: nowArgentina(),
        observaciones: `Neutraliza devolución ${p.numero} (${em.tipo} ${em.numero}): la anulación del comprobante ya lo había reingresado`,
      })
      const art = infoDe.get(a.articulo_id) || {}
      await insertarKardex(
        supabase,
        {
          tipo_movimiento: "ajuste_salida",
          fecha: ahoraISO(),
          articulo_id: a.articulo_id,
          cantidad: a.cantidad,
          precio_lista: 0,
          precio_unitario_final: 0,
          iva_porcentaje: 0,
          iva_monto_unitario: 0,
          iva_incluido: !fiscal,
          subtotal_neto: 0,
          subtotal_iva: 0,
          subtotal_total: 0,
          cliente_id: p.cliente_id,
          comprobante_venta_id: em.id,
          tipo_comprobante: em.tipo,
          numero_comprobante: em.numero,
          metodo_facturacion: fiscal ? "Factura" : "Presupuesto",
          color_dinero: fiscal ? "BLANCO" : "NEGRO",
          operador_id: usuarioId,
        } as any,
        art,
      )
    } catch (e: any) {
      avisos.push(`Stock de ${a.descripcion || a.articulo_id} sin corregir (${e?.message || e}): sacá ${a.cantidad} a mano.`)
    }
  }
  return avisos
}

/** Para el diálogo de anular: devoluciones contra los comprobantes VIVOS del pedido (lo que va a salir del comprobante nuevo). */
export async function devolucionesDelPedido(supabase: SupabaseClient, pedidoId: string): Promise<Array<{ numero: string; articulos: string; aparte: boolean; fiscal: boolean; sin_nc: boolean }>> {
  const { data: comps } = await supabase
    .from("comprobantes_venta")
    .select("id, tipo_comprobante")
    .eq("pedido_id", pedidoId)
    .in("tipo_comprobante", VENTAS)
    .is("anulado_en", null)
  const fiscalDe = new Map(((comps || []) as any[]).map((c) => [c.id, c.tipo_comprobante !== "PRES"]))
  if (!fiscalDe.size) return []
  const { data } = await supabase
    .from("devoluciones_detalle")
    .select("devolucion_id, comprobante_venta_id, cantidad, estado_renglon, articulo:articulos!devoluciones_detalle_articulo_id_fkey(descripcion), devolucion:devoluciones!inner(numero_devolucion, estado)")
    .in("comprobante_venta_id", [...fiscalDe.keys()])
  const porDev = new Map<string, { numero: string; arts: string[]; fiscal: boolean; sin_nc: boolean }>()
  for (const d of (data || []) as any[]) {
    const dev = Array.isArray(d.devolucion) ? d.devolucion[0] : d.devolucion
    if (!["facturado", "confirmado"].includes(dev?.estado) || d.estado_renglon === "rechazado" || !(Number(d.cantidad) > 0)) continue
    const art = Array.isArray(d.articulo) ? d.articulo[0] : d.articulo
    const g = porDev.get(d.devolucion_id) || { numero: dev.numero_devolucion, arts: [] as string[], fiscal: false, sin_nc: dev.estado !== "facturado" }
    g.arts.push(`${Number(d.cantidad)} ${art?.descripcion || "artículo"}`)
    g.fiscal = g.fiscal || !!fiscalDe.get(d.comprobante_venta_id)
    porDev.set(d.devolucion_id, g)
  }
  if (!porDev.size) return []
  const { data: todos } = await supabase.from("devoluciones_detalle").select("devolucion_id, comprobante_venta_id, cantidad, estado_renglon").in("devolucion_id", [...porDev.keys()])
  const aparte = new Set(((todos || []) as any[]).filter((d) => !fiscalDe.has(d.comprobante_venta_id) && d.estado_renglon !== "rechazado" && Number(d.cantidad) > 0).map((d) => d.devolucion_id))
  return [...porDev.entries()].map(([id, g]) => ({ numero: g.numero, articulos: g.arts.join(", "), aparte: aparte.has(id), fiscal: g.fiscal, sin_nc: g.sin_nc }))
}
