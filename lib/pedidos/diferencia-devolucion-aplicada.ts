import type { SupabaseClient } from "@supabase/supabase-js"
import { moneda } from "@/lib/formato"
import { comprobantesAplicados, esAplicadaDeclarada, faltanteDeclarado, valuarDiferencia } from "./ajuste-devoluciones"

// P2-43 (Juan 1/11/2026): una devolución PENDIENTE que se aplicó en la
// refacturación del pedido por lo DECLARADO (ajuste-devoluciones-refacturado.ts)
// nunca emite su REV/NC. Cuando depósito la revisa:
//  - si acepta lo declarado, no se emite nada;
//  - si acepta MENOS (llegó menos o rechazó un renglón), lo que el cliente se
//    quedó se le cobra: PRES (o ND si el origen era factura) por esa diferencia,
//    al precio del comprobante nuevo, asociado a él;
//  - más de lo declarado no se puede aceptar (tope de revisarDevolucion).
// Se puede repetir: lo ya emitido (vivo) no se emite de nuevo.

export const MOTIVO_DIFERENCIA_DEVOLUCION = "Diferencia de devolución aplicada en refacturación"
const ND_DE: Record<string, string> = { FA: "NDA", FB: "NDB", FC: "NDC" }
const FISCALES = ["FA", "FB", "FC"]

export interface DiferenciaCobrada {
  emitidos: Array<{ id: string; tipo: string; numero: string; total: number }>
  textos: string[]
  advertencias: string[]
}

export async function cobrarDiferenciaDevolucionAplicada(supabase: SupabaseClient, devolucionId: string, usuarioId: string | null): Promise<DiferenciaCobrada> {
  const res: DiferenciaCobrada = { emitidos: [], textos: [], advertencias: [] }
  const { data: dev } = await supabase.from("devoluciones").select("id, numero_devolucion, cliente_id, estado, observaciones").eq("id", devolucionId).maybeSingle()
  if (!dev || dev.estado === "pendiente" || !esAplicadaDeclarada(dev.observaciones)) return res
  const aplicados = comprobantesAplicados(dev.observaciones)
  const { data: det } = await supabase
    .from("devoluciones_detalle")
    .select("id, articulo_id, cantidad, cantidad_original, estado_renglon, comprobante_venta_id, articulo:articulos!devoluciones_detalle_articulo_id_fkey(descripcion, segmento_precio)")
    .eq("devolucion_id", devolucionId)
  const faltan = ((det || []) as any[])
    .filter((d) => aplicados.has(d.comprobante_venta_id))
    .map((d) => ({ ...d, articulo: Array.isArray(d.articulo) ? d.articulo[0] : d.articulo, falta: faltanteDeclarado(d) }))
    .filter((d) => d.falta > 0)
  if (!faltan.length) return res

  const numero = dev.numero_devolucion || dev.id
  const { data: origs } = await supabase
    .from("comprobantes_venta")
    .select("id, tipo_comprobante, numero_comprobante, pedido_id, total_neto, percepcion_iva, percepcion_iibb")
    .in("id", [...new Set(faltan.map((f) => f.comprobante_venta_id))])

  for (const o of (origs || []) as any[]) {
    const fiscal = o.tipo_comprobante !== "PRES"
    const tipo = fiscal ? ND_DE[o.tipo_comprobante] : "PRES"
    const prefijo = `Diferencia devolución ${numero} (${o.tipo_comprobante} ${o.numero_comprobante})`
    if (!tipo) {
      res.advertencias.push(`${prefijo}: no se sabe qué ND corresponde a un ${o.tipo_comprobante}. Cobrala a mano.`)
      continue
    }
    const { data: ya } = await supabase
      .from("comprobantes_venta")
      .select("id")
      .eq("cliente_id", dev.cliente_id)
      .eq("motivo_ajuste", MOTIVO_DIFERENCIA_DEVOLUCION)
      .is("anulado_en", null)
      .ilike("observaciones", `${prefijo}%`)
      .limit(1)
    if (ya?.length) continue

    // Comprobante nuevo del pedido (el de la refacturación) y su precio por artículo
    let nuevo: any = null
    const precioDe = new Map<string, any>()
    if (o.pedido_id) {
      const [{ data: nuevos }, { data: renglonesPedido }] = await Promise.all([
        supabase
          .from("comprobantes_venta")
          .select("id, tipo_comprobante, numero_comprobante, total_neto, percepcion_iva, percepcion_iibb")
          .eq("pedido_id", o.pedido_id)
          .in("tipo_comprobante", fiscal ? FISCALES : ["PRES"])
          .is("anulado_en", null)
          .order("created_at", { ascending: false })
          .limit(1),
        supabase.from("pedidos_detalle").select("articulo_id, precio_final, precio_base, es_bonificado").eq("pedido_id", o.pedido_id),
      ])
      nuevo = nuevos?.[0] ?? null
      for (const r of (renglonesPedido || []) as any[]) if (r.es_bonificado !== true && !precioDe.has(r.articulo_id)) precioDe.set(r.articulo_id, r)
    }
    const propios = faltan.filter((f) => f.comprobante_venta_id === o.id)
    const sinPrecio = propios.filter((f) => !precioDe.has(f.articulo_id))
    if (sinPrecio.length) {
      res.advertencias.push(`${prefijo}: no encuentro el precio del pedido de ${sinPrecio.map((f) => f.articulo?.descripcion || f.articulo_id).join(", ")}. Cobrá esa diferencia a mano.`)
    }
    const conPrecio = propios.filter((f) => precioDe.has(f.articulo_id))
    if (!conPrecio.length) continue
    const ref = nuevo ?? o
    const v = valuarDiferencia(
      conPrecio.map((f) => ({
        articulo_id: f.articulo_id,
        descripcion: f.articulo?.descripcion || "Artículo",
        cantidad: f.falta,
        precio_final: Number(precioDe.get(f.articulo_id).precio_final) || 0,
        precio_base: Number(precioDe.get(f.articulo_id).precio_base) || 0,
        perfumeria: f.articulo?.segmento_precio === "perfumeria",
      })),
      fiscal,
      { neto: Number(ref.total_neto) || 0, percepcion_iva: Number(ref.percepcion_iva) || 0, percepcion_iibb: Number(ref.percepcion_iibb) || 0 },
    )
    if (!(v.total > 0)) continue
    const arts = v.detalle.map((d) => `${d.cantidad} ${d.descripcion}`).join(", ")
    try {
      const { emitirComprobanteAjuste } = await import("@/lib/comprobantes/emitir-ajuste")
      const em = await emitirComprobanteAjuste(supabase, {
        tipo,
        clienteId: dev.cliente_id,
        neto: v.neto,
        iva: v.iva,
        baseIva: v.baseIva,
        percepcionIva: v.percepcionIva,
        percepcionIibb: v.percepcionIibb,
        alicuotaIIBB: v.alicuotaIIBB,
        detalle: v.detalle.map((d) => ({ ...d, descripcion: `${d.descripcion} — devolución ${numero}: no aceptado en la revisión` })),
        asociado: { tipo_comprobante: ref.tipo_comprobante, numero_comprobante: ref.numero_comprobante },
        observaciones: `${prefijo} — aplicada en la refacturación${nuevo ? ` (${nuevo.tipo_comprobante} ${nuevo.numero_comprobante})` : ""}; depósito aceptó menos de lo declarado`,
        motivo: MOTIVO_DIFERENCIA_DEVOLUCION,
        usuarioId,
      })
      res.emitidos.push({ id: em.id, tipo: em.tipo, numero: em.numero, total: em.total })
      res.advertencias.push(...em.advertencias)
      res.textos.push(`Se le cobra al cliente lo que no volvió (${arts}): ${em.tipo} ${em.numero} por ${moneda(em.total)}${nuevo ? `, asociado al ${nuevo.tipo_comprobante} ${nuevo.numero_comprobante}` : ""}.`)
    } catch (e: any) {
      res.advertencias.push(`No se pudo emitir el ${tipo} por lo que no volvió de la devolución ${numero} (${arts}, ${moneda(v.total)}): ${e?.message || e}. Cobralo a mano.`)
    }
  }
  return res
}
