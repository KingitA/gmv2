/**
 * La orden de pago NO se pudo confirmar sola aunque el banco ya hizo el pago. SOLO SERVIDOR.
 *
 * Antes eso quedaba solo en la respuesta de la consulta periódica (nadie la mira): el pago había
 * salido y la orden seguía pendiente sin que nadie se enterara. Ahora queda:
 *   - en la orden (ordenes_pago.banco_confirmacion_*, migración 20261119n): se ve en Órdenes de
 *     pago y en la ventana de Credicoop de la orden;
 *   - como aviso en la bandeja de Jarvis (ai_agenda_events, "Lo que Jarvis notó"): uno vivo por orden;
 *   - en Finanzas → Bancos ("Pagos que el banco ya hizo y la orden sigue pendiente"), que además
 *     se calcula en el momento desde bancos_operaciones (anda aunque falte la migración).
 * Al confirmarse la orden (sola o con el tilde verde) se borra y el aviso se cierra.
 * Nada de esto hace fallar la confirmación ni la consulta: si no se puede anotar, se avisa en el log.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { faltaLaColumna } from "@/lib/utils/migracion-pendiente"
import { moneda } from "@/lib/formato"

export type EstadoFalla = "no_se_pudo" | "falta_resto"
const ORIGEN_AVISO = "bancos_confirmacion"

export async function anotarFallaConfirmacion(db: SupabaseClient, ordenPagoId: string, estado: EstadoFalla, mensaje: string): Promise<void> {
  const ahora = new Date().toISOString()
  try {
    const u = await db.from("ordenes_pago")
      .update({ banco_confirmacion_falla: mensaje.slice(0, 1000), banco_confirmacion_falla_estado: estado, banco_confirmacion_falla_at: ahora })
      .eq("id", ordenPagoId).eq("estado", "pendiente")
    if (u.error && !faltaLaColumna(u.error)) console.warn("[bancos] no se pudo anotar la falla en la orden:", u.error.message)

    const { data: op } = await db.from("ordenes_pago").select("numero_op, neto_a_pagar, proveedores(nombre)").eq("id", ordenPagoId).maybeSingle()
    const prov = (Array.isArray((op as any)?.proveedores) ? (op as any).proveedores[0] : (op as any)?.proveedores) as { nombre?: string } | null
    const titulo = estado === "falta_resto"
      ? `Orden de pago ${op?.numero_op ?? ""}: el banco ya pagó, falta confirmar el resto a mano`
      : `Orden de pago ${op?.numero_op ?? ""}: el banco ya pagó y la orden no se pudo confirmar`
    const detalle = `${prov?.nombre ? `${prov.nombre} · neto ${moneda(Number(op?.neto_a_pagar ?? 0))}. ` : ""}${mensaje}`
    const fila = {
      title: titulo.slice(0, 200), description: detalle, tono: estado === "no_se_pudo" ? "alerta" : "atencion",
      severidad: estado === "no_se_pudo" ? 95 : 70, updated_at: ahora,
      acciones: [{ texto: "Ver en Bancos", pregunta: "", href: "/finanzas/bancos" }],
      metadata: { origen: ORIGEN_AVISO, estado, orden_pago_id: ordenPagoId, numero_op: op?.numero_op ?? null },
    }
    const { data: vivo } = await db.from("ai_agenda_events").select("id").eq("event_type", "aviso").eq("status", "pendiente")
      .eq("related_entity_type", "orden_pago").eq("related_entity_id", ordenPagoId).limit(1)
    if (vivo && vivo.length > 0) {
      const r = await db.from("ai_agenda_events").update(fila).eq("id", (vivo[0] as { id: string }).id).eq("status", "pendiente")
      if (r.error) console.warn("[bancos] no se pudo actualizar el aviso:", r.error.message)
      return
    }
    const r = await db.from("ai_agenda_events").insert({
      ...fila, event_type: "aviso", source: "sistema", status: "pendiente", priority: estado === "no_se_pudo" ? "alta" : "media",
      related_entity_type: "orden_pago", related_entity_id: ordenPagoId,
    })
    if (r.error) console.warn("[bancos] no se pudo dejar el aviso:", r.error.message)
  } catch (e) {
    console.warn("[bancos] anotar falla de confirmación:", (e as Error)?.message)
  }
}

/** La orden quedó confirmada: se borra la marca y se cierra el aviso. */
export async function limpiarFallaConfirmacion(db: SupabaseClient, ordenPagoId: string): Promise<void> {
  const ahora = new Date().toISOString()
  try {
    const u = await db.from("ordenes_pago").update({ banco_confirmacion_falla: null, banco_confirmacion_falla_estado: null, banco_confirmacion_falla_at: null })
      .eq("id", ordenPagoId).not("banco_confirmacion_falla_at", "is", null)
    if (u.error && !faltaLaColumna(u.error)) console.warn("[bancos] no se pudo limpiar la falla:", u.error.message)
    const r = await db.from("ai_agenda_events").update({ status: "completada", cerrado_at: ahora, cierre_nota: "La orden de pago quedó confirmada", updated_at: ahora })
      .eq("event_type", "aviso").eq("status", "pendiente").eq("related_entity_type", "orden_pago").eq("related_entity_id", ordenPagoId)
    if (r.error) console.warn("[bancos] no se pudo cerrar el aviso:", r.error.message)
  } catch (e) {
    console.warn("[bancos] limpiar falla de confirmación:", (e as Error)?.message)
  }
}

export interface OrdenPagadaPorBanco {
  orden_pago_id: string
  numero_op: string | null
  proveedor: string | null
  neto_a_pagar: number
  /** Lo que salió por el banco real (suma de las operaciones hechas) */
  pagado_por_banco: number
  ultima_firma: string | null
  falla: string | null
  falla_estado: string | null
  falla_at: string | null
}

/**
 * Órdenes PENDIENTES con algún pago ya hecho en el banco real: la plata salió y la orden no
 * está confirmada. Se calcula en el momento (anda sin la migración 20261119n); el motivo
 * guardado se agrega si la columna existe.
 */
export async function ordenesPagadasPorBancoSinConfirmar(db: SupabaseClient): Promise<OrdenPagadaPorBanco[]> {
  const { data, error } = await db.from("bancos_operaciones")
    .select("orden_pago_id, monto, firmado_at, ordenes_pago!inner(id, numero_op, estado, neto_a_pagar, proveedores(nombre))")
    .eq("ambiente", "produccion").in("estado", ["firmada", "acreditada"]).not("orden_pago_id", "is", null)
    .eq("ordenes_pago.estado", "pendiente").limit(500)
  if (error) throw error
  const por = new Map<string, OrdenPagadaPorBanco>()
  for (const f of (data ?? []) as Record<string, any>[]) {
    const op = Array.isArray(f.ordenes_pago) ? f.ordenes_pago[0] : f.ordenes_pago
    const prov = Array.isArray(op?.proveedores) ? op.proveedores[0] : op?.proveedores
    const a = por.get(f.orden_pago_id) ?? {
      orden_pago_id: f.orden_pago_id, numero_op: op?.numero_op ?? null, proveedor: prov?.nombre ?? null, neto_a_pagar: Number(op?.neto_a_pagar ?? 0),
      pagado_por_banco: 0, ultima_firma: null, falla: null, falla_estado: null, falla_at: null,
    }
    a.pagado_por_banco = Math.round((a.pagado_por_banco + Number(f.monto ?? 0)) * 100) / 100
    if (f.firmado_at && (!a.ultima_firma || f.firmado_at > a.ultima_firma)) a.ultima_firma = f.firmado_at
    por.set(f.orden_pago_id, a)
  }
  if (por.size > 0) {
    const r = await db.from("ordenes_pago").select("id, banco_confirmacion_falla, banco_confirmacion_falla_estado, banco_confirmacion_falla_at").in("id", [...por.keys()])
    if (!r.error) {
      for (const o of (r.data ?? []) as Record<string, any>[]) {
        const a = por.get(o.id)
        if (a) Object.assign(a, { falla: o.banco_confirmacion_falla ?? null, falla_estado: o.banco_confirmacion_falla_estado ?? null, falla_at: o.banco_confirmacion_falla_at ?? null })
      }
    } else if (!faltaLaColumna(r.error)) throw r.error
  }
  return [...por.values()].sort((x, y) => String(x.ultima_firma ?? "").localeCompare(String(y.ultima_firma ?? "")))
}
