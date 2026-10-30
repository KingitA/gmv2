import type { SupabaseClient } from "@supabase/supabase-js"
import type { OrigenDevolucion } from "@/lib/cobranzas/valor-devolucion"
import { alicuotaIIBBVigente, origenesDeRenglones } from "@/lib/cobranzas/origen-devolucion"
import { emitirComprobanteAjuste } from "@/lib/comprobantes/emitir-ajuste"
import { moneda } from "@/lib/formato"
import { calcularAjusteDevolucion, tipoAjuste, type AjusteClase, type RenglonAjuste } from "./ajuste-devoluciones"
import { MOTIVO_AJUSTE_DEVOLUCION } from "./devolucion-en-anulaciones"

// P2-43 (regla de Juan 31/10/2026): al refacturar un pedido, las devoluciones ya
// acreditadas contra su comprobante anulado se recalculan al precio del
// comprobante NUEVO y sale solo la diferencia (lib/pedidos/ajuste-devoluciones.ts):
// crédito extra (REV / NC) si subió, débito (PRES / ND) si bajó. Después cada
// renglón de la devolución queda apuntando al comprobante nuevo y a su precio:
// la devolución vale lo de la factura vigente (y un segundo refacturar compara
// contra este, no contra el primero).
//
// - Crédito: se imputa al comprobante nuevo de su clase.
// - Débito: lo cubre el crédito de la anulación (lo devuelto al precio viejo vive
//   ahí): refacturar.ts lo imputa primero a estos débitos.
// - Base del 10 % contado y comisión: lib/pedidos/devolucion-en-anulaciones.ts.

const VENTAS = ["FA", "FB", "FC", "PRES"]
const FISCALES = new Set(["FA", "FB", "FC"])
const r2 = (n: number) => Math.round(n * 100) / 100
const CLIENTE_COLS = "id, cuit, condicion_iva, exento_iva, exento_iibb, provincia, percepcion_iibb, metodo_facturacion, metodo_limpieza, metodo_perf0, metodo_perf_plus"

interface CompRef {
  id: string
  tipo_comprobante: string
  numero_comprobante: string
}

export interface AjustePlaneado extends AjusteClase {
  tipo: string
  /** Comprobante nuevo de esa clase (imputación del crédito y asociado fiscal); si no hay, el anulado */
  referencia: CompRef | null
}

export interface PlanDevolucion {
  devolucion_id: string
  numero: string
  cliente_id: string
  /** Lo acreditado (al precio del comprobante anulado) y lo que vale al precio nuevo */
  acreditado: number
  valor_nuevo: number
  /** Alícuota IIBB con la que se valuó (la vigente) */
  alicuota_iibb: number
  ajustes: AjustePlaneado[]
  /** A dónde pasa cada renglón (null en la estimación: el comprobante todavía no existe) */
  renglones: Array<{ id: string; comprobante_venta_id: string | null; precio_venta_original: number }>
  /** Artículos devueltos que no están en el comprobante nuevo (no se recalculan) */
  sin_comprobante: string[]
  texto: string
}

/**
 * Qué ajuste sale por cada devolución del pedido. Con `nuevosIds` (al emitir):
 * contra los comprobantes recién emitidos. Sin ellos (antes de Generar): una
 * estimación con los precios actuales del pedido.
 */
export async function planAjusteDevoluciones(
  supabase: SupabaseClient,
  pedidoId: string,
  opts: { nuevosIds?: string[] } = {},
): Promise<PlanDevolucion[]> {
  const { data: comps } = await supabase
    .from("comprobantes_venta")
    .select("id, tipo_comprobante, numero_comprobante, anulado_en, cliente_id")
    .eq("pedido_id", pedidoId)
    .in("tipo_comprobante", VENTAS)
  const anulados = ((comps || []) as any[]).filter((c) => c.anulado_en)
  if (!anulados.length) return []
  const anuladoDe = new Map<string, CompRef>(anulados.map((c) => [c.id, c]))

  const { data: det } = await supabase
    .from("devoluciones_detalle")
    .select("id, devolucion_id, articulo_id, cantidad, precio_venta_original, estado_renglon, comprobante_venta_id, articulo:articulos!devoluciones_detalle_articulo_id_fkey(descripcion, segmento_precio), devolucion:devoluciones!inner(id, numero_devolucion, estado, cliente_id)")
    .in("comprobante_venta_id", [...anuladoDe.keys()])
  const renglones = ((det || []) as any[]).filter((d) => {
    const dev = Array.isArray(d.devolucion) ? d.devolucion[0] : d.devolucion
    return dev?.estado === "facturado" && d.estado_renglon !== "rechazado" && Number(d.cantidad) > 0
  })
  if (!renglones.length) return []

  const clienteId = (anulados[0] as any).cliente_id as string
  const { data: cliente } = await supabase.from("clientes").select(CLIENTE_COLS).eq("id", clienteId).single()

  // Comprobantes nuevos con sus renglones
  const nuevos: Array<CompRef & { detalle: Array<{ articulo_id: string; precio_unitario: number }> }> = []
  if (opts.nuevosIds?.length) {
    const { data } = await supabase
      .from("comprobantes_venta")
      .select("id, tipo_comprobante, numero_comprobante, comprobantes_venta_detalle(articulo_id, precio_unitario, es_bonificado)")
      .in("id", opts.nuevosIds)
      .in("tipo_comprobante", VENTAS)
    for (const c of (data || []) as any[]) {
      nuevos.push({
        id: c.id,
        tipo_comprobante: c.tipo_comprobante,
        numero_comprobante: c.numero_comprobante,
        detalle: (c.comprobantes_venta_detalle || [])
          .filter((d: any) => d.es_bonificado !== true && Number(d.precio_unitario) > 0)
          .map((d: any) => ({ articulo_id: d.articulo_id, precio_unitario: Number(d.precio_unitario) })),
      })
    }
  }

  // Estimación: precios actuales del pedido (como los va a escribir Generar)
  const delPedido = new Map<string, { final: number; neto: number; perf: boolean }>()
  if (!opts.nuevosIds) {
    const { data } = await supabase
      .from("pedidos_detalle")
      .select("articulo_id, precio_final, precio_base, es_bonificado")
      .eq("pedido_id", pedidoId)
    for (const d of (data || []) as any[]) {
      if (d.es_bonificado === true || delPedido.has(d.articulo_id)) continue
      const final = Number(d.precio_final) || 0
      delPedido.set(d.articulo_id, { final, neto: Number(d.precio_base) > 0 ? Number(d.precio_base) : r2(final / 1.21), perf: false })
    }
    for (const d of renglones) {
      const p = delPedido.get(d.articulo_id)
      const art = Array.isArray(d.articulo) ? d.articulo[0] : d.articulo
      if (p) p.perf = art?.segmento_precio === "perfumeria"
    }
  }

  const [viejos, alicuota, notas10] = await Promise.all([
    origenesDeRenglones(
      supabase,
      clienteId,
      renglones.map((d) => ({ articulo_id: d.articulo_id, comprobante_venta_id: d.comprobante_venta_id, precio_venta_original: Number(d.precio_venta_original) || 0 })),
      cliente as any,
    ),
    alicuotaIIBBVigente(supabase, (cliente || {}) as any),
    notasContado(supabase, clienteId, renglones),
  ])

  // Destino de cada renglón: comprobante nuevo de la misma clase con el artículo (si no, de cualquiera)
  const destino = renglones.map((d, i) => {
    const fiscalViejo = viejos[i].fiscal
    if (opts.nuevosIds) {
      const con = nuevos.filter((c) => c.detalle.some((x) => x.articulo_id === d.articulo_id))
      const c = con.find((x) => FISCALES.has(x.tipo_comprobante) === fiscalViejo) ?? con[0]
      if (!c) return null
      return { comp: c as CompRef, precio: c.detalle.find((x) => x.articulo_id === d.articulo_id)!.precio_unitario }
    }
    const p = delPedido.get(d.articulo_id)
    if (!p || !(p.final > 0)) return null
    return { comp: null, precio: fiscalViejo ? p.neto : p.perf ? p.neto : p.final, iva: fiscalViejo ? r2(p.final - p.neto) : null }
  })

  // Origen nuevo: real (comprobante emitido) o estimado (mismo origen con el precio del pedido)
  const conDestino = renglones.map((d, i) => ({ d, i, dest: destino[i] })).filter((x) => x.dest)
  const nuevosOrigenes = opts.nuevosIds
    ? await origenesDeRenglones(
        supabase,
        clienteId,
        conDestino.map(({ d, dest }) => ({ articulo_id: d.articulo_id, comprobante_venta_id: dest!.comp!.id, precio_venta_original: dest!.precio })),
        cliente as any,
      )
    : conDestino.map(({ i, dest }) => ({
        ...viejos[i],
        comprobante_venta_id: null,
        exacto: true,
        precio: dest!.precio,
        iva_unitario: (dest as any).iva ?? null,
        bonificado_contado: false,
      }) as OrigenDevolucion)

  // Por devolución
  const porDev = new Map<string, { numero: string; items: RenglonAjuste[]; dest: Array<{ id: string; comp: CompRef | null; precio: number }>; sin: string[]; anulado: Map<boolean, CompRef> }>()
  renglones.forEach((d, i) => {
    const dev = Array.isArray(d.devolucion) ? d.devolucion[0] : d.devolucion
    const art = Array.isArray(d.articulo) ? d.articulo[0] : d.articulo
    if (!porDev.has(d.devolucion_id)) porDev.set(d.devolucion_id, { numero: dev?.numero_devolucion || d.devolucion_id, items: [], dest: [], sin: [], anulado: new Map() })
    const g = porDev.get(d.devolucion_id)!
    const k = conDestino.findIndex((x) => x.i === i)
    if (k < 0) {
      g.sin.push(art?.descripcion || d.articulo_id)
      return
    }
    // El 10 % con que se acreditó (la anulación ya bajó la NC/REV del contado: se toma de la emisión)
    const viejo = { ...viejos[i], bonificado_contado: notas10.get(`${d.devolucion_id}|${viejos[i].fiscal}`) ?? viejos[i].bonificado_contado }
    g.items.push({
      id: d.id,
      articulo_id: d.articulo_id,
      descripcion: art?.descripcion ?? null,
      cantidad: Number(d.cantidad) || 0,
      precio_viejo: Number(d.precio_venta_original) || 0,
      origen_viejo: viejo,
      precio_nuevo: conDestino[k].dest!.precio,
      origen_nuevo: nuevosOrigenes[k],
    })
    g.dest.push({ id: d.id, comp: conDestino[k].dest!.comp, precio: conDestino[k].dest!.precio })
    const an = anuladoDe.get(d.comprobante_venta_id)
    if (an && !g.anulado.has(viejo.fiscal)) g.anulado.set(viejo.fiscal, an)
  })

  const out: PlanDevolucion[] = []
  for (const [devId, g] of porDev) {
    const calc = calcularAjusteDevolucion(g.items, alicuota)
    const ajustes: AjustePlaneado[] = calc.ajustes.map((a) => {
      const nuevoDeClase = g.items
        .map((it, j) => (it.origen_nuevo.fiscal === a.fiscal ? g.dest[j].comp : null))
        .find(Boolean) as CompRef | undefined
      const referencia = nuevoDeClase ?? g.anulado.get(a.fiscal) ?? null
      const tipoRef = nuevoDeClase?.tipo_comprobante ?? g.anulado.get(a.fiscal)?.tipo_comprobante
        ?? (a.fiscal ? g.items.find((it) => it.origen_nuevo.fiscal)?.origen_nuevo.tipo_comprobante : null)
      return { ...a, tipo: tipoAjuste(a.fiscal, a.signo, tipoRef), referencia }
    })
    const acreditado = calc.viejo.total
    const valorNuevo = calc.nuevo.total
    out.push({
      devolucion_id: devId,
      numero: g.numero,
      cliente_id: clienteId,
      acreditado,
      valor_nuevo: valorNuevo,
      alicuota_iibb: alicuota,
      ajustes,
      renglones: g.dest.map((x) => ({ id: x.id, comprobante_venta_id: x.comp?.id ?? null, precio_venta_original: x.precio })),
      sin_comprobante: g.sin,
      texto: textoPlan(g.numero, acreditado, valorNuevo, ajustes, g.sin),
    })
  }
  return out
}

function textoPlan(numero: string, acreditado: number, valorNuevo: number, ajustes: AjustePlaneado[], sin: string[]): string {
  const base = ajustes.length
    ? `La devolución ${numero} se recalcula a ${moneda(valorNuevo)} (estaba acreditada en ${moneda(acreditado)}): sale ${ajustes.map((a) => `${a.tipo} por ${moneda(a.total)}`).join(" y ")}.`
    : `La devolución ${numero} queda igual (${moneda(acreditado)}).`
  return sin.length ? `${base} No están en el comprobante nuevo: ${sin.join(", ")}.` : base
}

/** ¿La NC/REV de cada devolución salió con el 10 % contado? (nota que deja generar-nc-reversa). Clave devolucion|fiscal. */
async function notasContado(supabase: SupabaseClient, clienteId: string, renglones: any[]): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>()
  const numeros = new Map<string, string>()
  for (const d of renglones) {
    const dev = Array.isArray(d.devolucion) ? d.devolucion[0] : d.devolucion
    if (dev?.numero_devolucion) numeros.set(d.devolucion_id, dev.numero_devolucion)
  }
  for (const [devId, numero] of numeros) {
    const { data } = await supabase
      .from("comprobantes_venta")
      .select("tipo_comprobante, observaciones")
      .eq("cliente_id", clienteId)
      .in("tipo_comprobante", ["NCA", "NCB", "NCC", "REV"])
      .is("anulado_en", null)
      .ilike("observaciones", `Devolución ${numero}%`)
    for (const c of (data || []) as any[]) {
      const obs = String(c.observaciones || "")
      if (obs !== `Devolución ${numero}` && !obs.startsWith(`Devolución ${numero} `)) continue
      const fiscal = c.tipo_comprobante !== "REV"
      if (obs.includes("bonificados 10% contado")) out.set(`${devId}|${fiscal}`, true)
      else if (!out.has(`${devId}|${fiscal}`)) out.set(`${devId}|${fiscal}`, false)
    }
  }
  return out
}

export interface ResultadoAjusteDevoluciones {
  emitidos: Array<{ devolucion: string; id: string; tipo: string; numero: string; total: number }>
  /** Débitos de ajuste: los cubre el crédito de la anulación (refacturar.ts) */
  debitosIds: string[]
  textos: string[]
  advertencias: string[]
}

/** Al emitir el comprobante nuevo de un pedido refacturado: emite los ajustes y pasa las devoluciones al comprobante nuevo. */
export async function ajustarDevolucionesRefacturadas(
  supabase: SupabaseClient,
  pedidoId: string,
  nuevosIds: string[],
  usuarioId: string,
): Promise<ResultadoAjusteDevoluciones> {
  const res: ResultadoAjusteDevoluciones = { emitidos: [], debitosIds: [], textos: [], advertencias: [] }
  if (!nuevosIds.length) return res
  const plan = await planAjusteDevoluciones(supabase, pedidoId, { nuevosIds })

  for (const p of plan) {
    const mixto = p.ajustes.find((a) => a.mixto)
    if (mixto) {
      res.advertencias.push(`${p.texto} No se emitió solo: el comprobante nuevo cambia las percepciones en sentido contrario al precio. Hacelo a mano.`)
      continue
    }
    let ok = true
    // Fiscal primero (si ARCA falla, no queda una REV suelta de un ajuste a medias)
    for (const a of [...p.ajustes].sort((x, y) => Number(y.fiscal) - Number(x.fiscal))) {
      try {
        const em = await emitirComprobanteAjuste(supabase, {
          tipo: a.tipo,
          clienteId: p.cliente_id,
          neto: a.neto,
          iva: a.iva,
          baseIva: a.baseIva,
          percepcionIva: a.percepcionIva,
          percepcionIibb: a.percepcionIibb,
          alicuotaIIBB: p.alicuota_iibb,
          detalle: a.detalle.map((d) => ({ articulo_id: d.articulo_id, descripcion: `${d.descripcion || "Artículo"} — diferencia de precio al refacturar`, cantidad: d.cantidad, neto: d.neto })),
          asociado: a.referencia,
          observaciones: `Devolución ${p.numero} — ajuste por refacturación${a.referencia ? ` (${a.referencia.tipo_comprobante} ${a.referencia.numero_comprobante})` : ""}: acreditada ${moneda(p.acreditado)} → ${moneda(p.valor_nuevo)}`,
          motivo: MOTIVO_AJUSTE_DEVOLUCION,
          usuarioId,
        })
        res.emitidos.push({ devolucion: p.numero, id: em.id, tipo: em.tipo, numero: em.numero, total: em.total })
        res.advertencias.push(...em.advertencias)
        if (a.signo > 0) {
          // Crédito extra → al comprobante nuevo de su clase (si ya no debe, queda a favor)
          if (a.referencia && nuevosIds.includes(a.referencia.id)) {
            const { error } = await supabase.rpc("cc_imputar_credito", { p_credito_id: em.id, p_debito_id: a.referencia.id, p_monto: null, p_usuario_id: usuarioId })
            if (error) res.advertencias.push(`El ${em.tipo} ${em.numero} quedó a favor sin imputar (${error.message}): imputalo al ${a.referencia.tipo_comprobante} ${a.referencia.numero_comprobante} desde la cuenta corriente.`)
          }
        } else {
          res.debitosIds.push(em.id)
        }
      } catch (e: any) {
        ok = false
        res.advertencias.push(`No se pudo emitir el ajuste de la devolución ${p.numero} (${a.tipo} por ${moneda(a.total)}): ${e?.message || e}. Emitilo a mano.`)
        break
      }
    }
    if (!ok) continue
    // La devolución vale ahora lo del comprobante nuevo
    for (const r of p.renglones) {
      if (!r.comprobante_venta_id) continue
      const { error } = await supabase
        .from("devoluciones_detalle")
        .update({ comprobante_venta_id: r.comprobante_venta_id, precio_venta_original: r.precio_venta_original })
        .eq("id", r.id)
      if (error) res.advertencias.push(`Renglón de la devolución ${p.numero} sin pasar al comprobante nuevo (${error.message}).`)
    }
    res.textos.push(p.texto)
  }
  return res
}

/** Para el diálogo de anular: devoluciones ya acreditadas contra los comprobantes vivos del pedido. */
export async function devolucionesAcreditadasDelPedido(supabase: SupabaseClient, pedidoId: string): Promise<Array<{ numero: string }>> {
  const { data: comps } = await supabase
    .from("comprobantes_venta")
    .select("id")
    .eq("pedido_id", pedidoId)
    .in("tipo_comprobante", VENTAS)
    .is("anulado_en", null)
  const ids = ((comps || []) as any[]).map((c) => c.id)
  if (!ids.length) return []
  const { data } = await supabase
    .from("devoluciones_detalle")
    .select("devolucion:devoluciones!inner(numero_devolucion, estado)")
    .in("comprobante_venta_id", ids)
  const numeros = new Set<string>()
  for (const d of (data || []) as any[]) {
    const dev = Array.isArray(d.devolucion) ? d.devolucion[0] : d.devolucion
    if (dev?.estado === "facturado" && dev.numero_devolucion) numeros.add(dev.numero_devolucion)
  }
  return [...numeros].map((numero) => ({ numero }))
}
