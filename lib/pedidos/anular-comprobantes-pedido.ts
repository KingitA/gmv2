// Anular TODOS los comprobantes de un pedido para refacturarlo (#19/#20) —
// la anulación (cuentas corrientes). Las reglas de qué se puede anular y en qué
// orden son de listas de precios (lib/pedidos/anulacion-pedido.ts).
//
//  1. evaluarAnulacionPedido: si no se puede, corta con el motivo (422).
//  2. Anula cada comprobante de `aAnular` EN ORDEN con la misma función que la
//     anulación de a uno (lib/comprobantes/anular-comprobante.ts): primero las
//     NC/REV del 10 % contado, después los del pedido (fiscales antes que PRES).
//  3. Cruza entre sí lo que quedó abierto de esta anulación: el inverso del 10 %
//     contado es un DÉBITO (ND/PRES) y el de cada comprobante un CRÉDITO (NC/REV);
//     sin el cruce quedaban los dos "pendientes" por el mismo importe.
//  4. Lo que el cliente ya pagó IMPUTADO A ESTE PEDIDO es el crédito que le
//     queda a la NC/REV de la anulación. Al volver a generar, pasa al comprobante
//     nuevo de este pedido (lib/pedidos/refacturar.ts, regla del dueño 27/10:
//     respeta lo que eligió quien cobró). Lo que estaba a cuenta sigue a cuenta.
//  5. Sin comprobantes vivos: el pedido QUEDA EN SU ESTADO (27/10), se le
//     saca el 10 % contado y se resincroniza el kardex (las líneas dejan de
//     estar vinculadas a un comprobante vivo).
//
// Reintentable: si se corta a la mitad (ARCA rechaza una NC, por ejemplo), lo ya
// anulado queda anulado y al volver a llamar `aAnular` trae solo lo que sigue vivo.

import { anularComprobante, CorteAnulacion, type ResultadoAnulacion } from "@/lib/comprobantes/anular-comprobante"
import { comprobantesDePedidos } from "@/lib/comprobantes/comprobantes-de-pedido"
import { sincronizarKardexPedido } from "@/lib/kardex/sincronizar-pedido"
import { evaluarAnulacionPedido } from "./anulacion-pedido"

const CREDITOS = new Set(["NC", "NCA", "NCB", "NCC", "REV"])
const DEBITOS_VENTA = new Set(["FA", "FB", "FC", "PRES", "ND", "NDA", "NDB", "NDC"])
const r2 = (n: number) => Math.round(n * 100) / 100

export interface AnuladoDePedido {
  original: { id: string; tipo_comprobante: string; numero_comprobante: string; total: number }
  inverso: ResultadoAnulacion["inverso"]
}

export interface ResultadoAnulacionPedido {
  anulados: AnuladoDePedido[]
  /** Crédito que le quedó al cliente por lo que ya había pagado (a favor, sin reimputar) */
  a_favor: number
  estado_pedido: string | null
  advertencias: string[]
}

/** Corte a mitad de camino: lo anulado hasta ahí y el motivo del corte. */
export class CorteAnulacionPedido extends Error {
  constructor(public body: Record<string, any>, public status: number) {
    super(String(body.error))
  }
}

export async function anularComprobantesPedido(supabase: any, pedidoId: string, usuarioId: string): Promise<ResultadoAnulacionPedido> {
  const ev = await evaluarAnulacionPedido(supabase, pedidoId)
  if (!ev.puede) throw new CorteAnulacionPedido({ error: ev.motivo, error_code: "PEDIDO_NO_ANULABLE" }, 422)

  const anulados: AnuladoDePedido[] = []
  const advertencias: string[] = []
  for (const c of ev.aAnular) {
    try {
      const r = await anularComprobante(supabase, c.id, usuarioId)
      anulados.push({
        original: { id: c.id, tipo_comprobante: c.tipo_comprobante, numero_comprobante: c.numero_comprobante, total: c.total_factura },
        inverso: r.inverso,
      })
      // El inverso del 10 % contado es un débito: la anulación de a uno avisa que
      // no lo pudo cruzar con su original (crédito ya imputado), pero acá se cruza
      // en el paso 3 con el crédito de la anulación — ese aviso no aplica.
      const avisos = (r.advertencias || []).filter((a) => !(CREDITOS.has(c.tipo_comprobante) && a.startsWith("La cancelación de saldos")))
      advertencias.push(...avisos)
    } catch (e: any) {
      const corte = e instanceof CorteAnulacion ? e : null
      throw new CorteAnulacionPedido(
        {
          error: `No se pudo anular ${c.tipo_comprobante} ${c.numero_comprobante}: ${corte ? corte.body.error : e?.message || e}`,
          error_code: corte?.body.error_code ?? "ANULACION_CORTADA",
          // Lo ya anulado queda anulado: volviendo a intentar sigue desde acá
          anulados,
          pendientes: ev.aAnular.slice(anulados.length).map((p) => `${p.tipo_comprobante} ${p.numero_comprobante}`),
        },
        corte?.status ?? 500,
      )
    }
  }

  // ── 3. Cruce de lo que quedó abierto de esta anulación (débitos ↔ créditos) ──
  const inversoIds = anulados.map((a) => a.inverso.id)
  if (inversoIds.length) {
    const { data: inversos } = await supabase
      .from("comprobantes_venta")
      .select("id, tipo_comprobante, numero_comprobante, saldo_pendiente")
      .in("id", inversoIds)
    const creditos = (inversos || []).filter((c: any) => CREDITOS.has(c.tipo_comprobante) && Number(c.saldo_pendiente) < -0.005)
    const debitos = (inversos || []).filter((c: any) => !CREDITOS.has(c.tipo_comprobante) && Number(c.saldo_pendiente) > 0.005)
    for (const d of debitos) {
      let pendiente = Number(d.saldo_pendiente)
      for (const cr of creditos) {
        if (pendiente <= 0.005) break
        if (Number(cr.saldo_pendiente) >= -0.005) continue
        const { data: imp, error } = await supabase.rpc("cc_imputar_credito", {
          p_credito_id: cr.id,
          p_debito_id: d.id,
          p_monto: null,
          p_usuario_id: usuarioId,
        })
        if (error) {
          advertencias.push(`No se pudo cruzar ${cr.tipo_comprobante} ${cr.numero_comprobante} con ${d.tipo_comprobante} ${d.numero_comprobante} (${error.message}): imputalo a mano desde la cuenta corriente.`)
          continue
        }
        cr.saldo_pendiente = Number(imp?.credito_saldo_restante ?? 0)
        pendiente = Number(imp?.debito_saldo_restante ?? 0)
      }
    }
  }

  // ── 4. Lo que quedó a favor (lo pagado), después del cruce ──
  const { data: finales } = inversoIds.length
    ? await supabase.from("comprobantes_venta").select("tipo_comprobante, saldo_pendiente").in("id", inversoIds)
    : { data: [] as any[] }
  const aFavor = r2(
    (finales || [])
      .filter((c: any) => CREDITOS.has(c.tipo_comprobante))
      .reduce((s: number, c: any) => s + Math.max(0, -Number(c.saldo_pendiente || 0)), 0),
  )

  // ── 5. Sin comprobantes vivos: el pedido sigue en su estado, kardex al día ──
  const quedan = (await comprobantesDePedidos(supabase, [pedidoId])).filter(
    (c) => c.pedido_id === pedidoId && !c.anulado_en && DEBITOS_VENTA.has(c.tipo_comprobante),
  )
  const estado = ev.estado
  if (!quedan.length) {
    // El pedido QUEDA EN SU ESTADO (regla del dueño 27/10): refacturar solo cambia
    // los comprobantes. Sin débitos vivos, sus condiciones ya son editables
    // (puedeEditarCondiciones) y Generar lo vuelve a facturar sin tocar el estado.
    const { error } = await supabase.from("pedidos").update({ pago_contado_10: false }).eq("id", pedidoId)
    if (error) advertencias.push(`No se pudo sacar la marca de 10 % contado del pedido (${error.message}).`)
    try {
      await sincronizarKardexPedido(supabase, pedidoId, { operadorId: usuarioId })
    } catch (e: any) {
      advertencias.push(`Kardex del pedido sin resincronizar (${e?.message || e}): usá "Sincronizar kardex" en el pedido.`)
    }
  } else {
    advertencias.push(`Siguen vivos: ${quedan.map((c) => `${c.tipo_comprobante} ${c.numero_comprobante}`).join(", ")}.`)
  }

  return { anulados, a_favor: aFavor, estado_pedido: estado, advertencias }
}
