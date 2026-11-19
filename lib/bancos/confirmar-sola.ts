/**
 * La orden de pago se confirma SOLA cuando el banco confirma la firma. SOLO SERVIDOR.
 *
 * Decisión de Juan (19/11/2026): «se confirma como pagada cuando el banco confirma la
 * transferencia y se envía la orden de pago en caso de tener alguien a quien mandárselo, si no,
 * queda cerrada sin enviar.»
 *
 * Se llama después de cada consulta al banco ("Actualizar estado", "vista en la cuenta" y la
 * consulta periódica). La regla es decidirConfirmacion (pura, con sus pruebas); la confirmación
 * va por el MISMO camino que el tilde verde (confirmarOrdenPago → op_confirmar, con el control
 * de retención de E-57 y las guardias de la base de 20261119d).
 *
 * - Solo el banco REAL confirma. Con el simulador o el banco de prueba se corre la misma regla y
 *   se DICE qué habría pasado, sin tocar la orden.
 * - Si la orden tiene medios de pago que no pasan por el banco (efectivo, cheque en papel), no
 *   se confirma sola: se avisa que falta confirmar el resto a mano.
 * - Queda registrado que la confirmó el sistema por la firma del banco: confirmado_por = quien
 *   mandó el pago al banco, confirmada_por_banco_at y la operación que la disparó.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { confirmarOrdenPago } from "@/lib/ordenes-pago/confirmar"
import { enviarOrdenAlProveedor, type ResumenEnvio } from "@/lib/ordenes-pago/envio"
import { estadoConexion } from "./credicoop/config"
import { decidirConfirmacion, type MedioDeOrden, type OperacionDeOrden } from "./credicoop/confirmacion"
import { anotarFallaConfirmacion } from "./falla-confirmacion"
import { CONFIRMAR_SOLA, faltaTablaBancos } from "./operaciones"

export interface ResultadoConfirmacionSola {
  /**
   * confirmada   = la orden quedó pagada recién
   * falta_resto  = el banco terminó, pero hay medios que se confirman a mano
   * no_se_pudo   = el banco terminó y la confirmación no pasó (el motivo va en el mensaje)
   * simulacion   = prueba: qué habría pasado con el banco real; no se tocó nada
   * nada         = no correspondía hacer nada
   */
  estado: "confirmada" | "falta_resto" | "no_se_pudo" | "simulacion" | "nada"
  mensaje: string | null
  envio: ResumenEnvio | null
}
const NADA: ResultadoConfirmacionSola = { estado: "nada", mensaje: null, envio: null }

export async function confirmarSiElBancoTermino(db: SupabaseClient, ordenPagoId: string): Promise<ResultadoConfirmacionSola> {
  if (!CONFIRMAR_SOLA) return NADA
  try {
    const [ordenRes, opsRes] = await Promise.all([
      db.from("ordenes_pago").select("id, numero_op, estado, ordenes_pago_detalle(id, medio, monto)").eq("id", ordenPagoId).maybeSingle(),
      db.from("bancos_operaciones").select("id, orden_pago_detalle_id, estado, ambiente, monto, creado_at, creado_por").eq("orden_pago_id", ordenPagoId),
    ])
    if (ordenRes.error || !ordenRes.data) return NADA
    if (opsRes.error) { if (!faltaTablaBancos(opsRes.error)) console.warn("[bancos] confirmar sola:", opsRes.error.message); return NADA }
    const orden = ordenRes.data
    const medios = ((orden.ordenes_pago_detalle ?? []) as Record<string, any>[]).map((d): MedioDeOrden => ({ id: d.id, medio: d.medio, monto: Number(d.monto ?? 0) }))
    const operaciones = ((opsRes.data ?? []) as Record<string, any>[]).map((o): OperacionDeOrden => ({ ...(o as OperacionDeOrden), monto: Number(o.monto ?? 0) }))

    const decision = decidirConfirmacion(orden, medios, operaciones, "produccion")

    if (decision.accion === "nada") {
      // Prueba (simulador / banco de prueba): la misma regla, sin tocar la orden
      const ambiente = estadoConexion().ambiente
      if (!ambiente || ambiente === "produccion") return NADA
      const prueba = decidirConfirmacion(orden, medios, operaciones, ambiente)
      if (prueba.accion === "confirmar") {
        return { estado: "simulacion", envio: null, mensaje: `Prueba: con el banco real, la orden ${orden.numero_op} se habría confirmado sola como pagada y se le habría mandado al proveedor. Acá no se confirmó ni se envió nada.` }
      }
      if (prueba.accion === "falta_resto") {
        return { estado: "simulacion", envio: null, mensaje: `Prueba: con el banco real, el banco ya habría confirmado lo suyo, pero la orden ${orden.numero_op} no se confirmaría sola porque tiene pagos que no pasan por el banco (${prueba.medios.join(", ")}).` }
      }
      return NADA
    }
    if (decision.accion === "esperar") return NADA
    if (decision.accion === "falta_resto") {
      const mensaje = `El banco ya confirmó, pero la orden ${orden.numero_op} tiene pagos que no pasan por el banco (${decision.medios.join(", ")}): falta confirmar el resto a mano, con el tilde verde.`
      // Queda a la vista (la orden, Finanzas → Bancos y la bandeja de Jarvis): la respuesta de la consulta periódica no la mira nadie
      await anotarFallaConfirmacion(db, ordenPagoId, "falta_resto", mensaje)
      return { estado: "falta_resto", envio: null, mensaje }
    }

    // Todo hecho en el banco real: se confirma por el mismo camino que el tilde verde
    const quien = decision.operacion.creado_por ?? null
    const r = await confirmarOrdenPago(db, ordenPagoId, quien)
    if (!r.ok) {
      // ¿La confirmó otro pedido al mismo tiempo (la consulta periódica y una persona)? Entonces no pasó nada malo.
      const { data: ahora } = await db.from("ordenes_pago").select("estado").eq("id", ordenPagoId).maybeSingle()
      if (ahora?.estado === "pagada") return NADA
      const mensaje = `El banco ya confirmó el pago, pero la orden ${orden.numero_op} no se pudo confirmar sola: ${r.error} Confirmala a mano con el tilde verde.`
      await anotarFallaConfirmacion(db, ordenPagoId, "no_se_pudo", mensaje)
      return { estado: "no_se_pudo", envio: null, mensaje }
    }
    // Otro pedido la confirmó en el mismo momento (op_confirmar es idempotente): ese ya dejó la constancia y mandó el mail
    if (r.data?.ya_confirmada === true) return NADA
    // Constancia: la confirmó el sistema por la firma del banco (quién mandó el pago y cuándo queda en la operación)
    const marca = await db.from("ordenes_pago").update({ confirmada_por_banco_at: new Date().toISOString(), confirmada_por_banco_operacion_id: decision.operacion.id }).eq("id", ordenPagoId)
    if (marca.error) console.warn("[bancos] no se pudo anotar la confirmación por el banco:", marca.error.message)

    const envio = await enviarOrdenAlProveedor(db, ordenPagoId, { usuarioId: quien, origen: "banco" })
    const certificado = r.data?.numero_certificado ? ` Se emitió el certificado de retención N° ${r.data.numero_certificado}.` : ""
    return { estado: "confirmada", envio, mensaje: `El banco confirmó el pago: la orden ${orden.numero_op} quedó pagada.${certificado} ${envio.mensaje}` }
  } catch (e) {
    console.error("[bancos] confirmar sola:", e)
    return NADA
  }
}

/**
 * Órdenes pendientes que tienen algo hecho en el banco real: candidatas a confirmarse solas.
 * Lo usa la consulta periódica para no depender de que justo esa consulta haya visto la firma.
 */
export async function ordenesParaConfirmarSolas(db: SupabaseClient): Promise<string[]> {
  const { data, error } = await db.from("bancos_operaciones").select("orden_pago_id, ordenes_pago!inner(estado)")
    .eq("ambiente", "produccion").in("estado", ["firmada", "acreditada"]).not("orden_pago_id", "is", null).eq("ordenes_pago.estado", "pendiente").limit(200)
  if (error) { if (!faltaTablaBancos(error)) console.warn("[bancos] órdenes para confirmar:", error.message); return [] }
  return [...new Set(((data ?? []) as Record<string, any>[]).map((f) => f.orden_pago_id as string))]
}
