/**
 * Fallas de los servicios de IA por SALDO o CUOTA (E-101).
 *
 * El 17/11/2026 Gemini se quedó sin crédito (error 402) y la lectura de facturas estuvo caída
 * sin que nadie se enterara. Ahora, cada vez que un servicio de IA rechaza un pedido por saldo,
 * facturación o cuota:
 *   1. se anota en la tabla ia_fallas (migración 20261119a_jarvis_compras.sql), y
 *   2. se deja un aviso en la bandeja de Jarvis ("Lo que Jarvis notó"), que ven admin y
 *      administrativo. El vigía `lectura_ia` (lib/jarvis/vigias.ts) lo mantiene mientras siga
 *      fallando y lo cierra solo cuando pasan 24 horas sin fallas.
 *
 * Nada de esto puede romper la lectura: si la tabla todavía no existe o la base no responde,
 * se sigue como si nada (queda el error en el registro del servidor).
 */
import { createAdminClient } from "@/lib/supabase/admin"

export type ServicioIA = "gemini" | "claude"

/** Código HTTP del error, venga como venga (SDK, fetch propio, mensaje "Gemini API 402 (...)"). */
export function estadoDeError(e: unknown): number {
  const err = e as { status?: number; statusCode?: number; message?: string } | null
  const msg = String(err?.message || "")
  return Number(err?.status) || Number(err?.statusCode)
    || Number(/\[(\d{3})\b/.exec(msg)?.[1]) || Number(/API (\d{3})\b/.exec(msg)?.[1]) || 0
}

/**
 * ¿El servicio rechazó el pedido por plata o por cuota? 402 = sin crédito; 429 = cuota o
 * demasiados pedidos; y los mensajes típicos de facturación de Google y de Anthropic.
 */
export function esFallaDeSaldoOCuota(e: unknown): boolean {
  const estado = estadoDeError(e)
  if (estado === 402 || estado === 429) return true
  const msg = String((e as { message?: string } | null)?.message || "")
  return /quota|billing|credit balance|insufficient|payment required|resource_exhausted|exceeded your current/i.test(msg)
}

const CLAVE_AVISO: Record<ServicioIA, string> = { gemini: "ia_cuota:gemini", claude: "ia_cuota:claude" }
const NOMBRE: Record<ServicioIA, string> = { gemini: "Gemini (lectura de facturas, remitos y cheques)", claude: "Claude (mails, Excel y Jarvis)" }

/** Texto del aviso. Lo usa también el vigía, para que diga lo mismo. */
export function textoAvisoFallaIA(servicio: ServicioIA, veces: number, ultimoEstado: number | null) {
  const motivo = ultimoEstado === 402 ? "se quedó sin crédito (error 402)"
    : ultimoEstado === 429 ? "llegó al límite de uso o de cuota (error 429)"
    : "rechazó pedidos por saldo o cuota"
  return {
    titulo: `${servicio === "gemini" ? "Gemini" : "Claude"} ${motivo}: la lectura automática está fallando`,
    detalle: `${NOMBRE[servicio]} falló ${veces} ${veces === 1 ? "vez" : "veces"} en las últimas 24 horas por saldo o cuota. `
      + "Mientras dure, los documentos no se leen solos y hay que cargarlos a mano. "
      + (servicio === "gemini"
        ? "Qué hacer: entrar a Google AI Studio → Facturación y cargar crédito o revisar el límite de la cuenta."
        : "Qué hacer: entrar a la consola de Anthropic → Billing y cargar crédito o revisar el límite."),
  }
}

/**
 * Anota la falla y deja el aviso. No lanza nunca. Si el error no es de saldo/cuota, no hace nada.
 * `origen`: dónde pasó, en palabras ("lectura de comprobante de compra", "cheque", …).
 */
export async function registrarFallaIA(servicio: ServicioIA, e: unknown, origen: string): Promise<void> {
  if (!esFallaDeSaldoOCuota(e)) return
  try {
    const db = createAdminClient()
    const estado = estadoDeError(e) || null
    const mensaje = String((e as { message?: string } | null)?.message || e || "").slice(0, 500)
    const { error } = await db.from("ia_fallas").insert({ servicio, estado, mensaje, origen: origen.slice(0, 120) })
    if (error) { console.error("[ia_fallas] no se pudo anotar la falla:", error.message); return }

    // Aviso inmediato en la bandeja (si ya hay uno pendiente, no se duplica: el vigía lo actualiza)
    const clave = CLAVE_AVISO[servicio]
    const { data: vivo } = await db.from("ai_agenda_events").select("id").eq("event_type", "aviso")
      .eq("clave", clave).eq("status", "pendiente").limit(1)
    if (vivo && vivo.length > 0) return
    const t = textoAvisoFallaIA(servicio, 1, estado)
    const { error: avisoErr } = await db.from("ai_agenda_events").insert({
      title: t.titulo, description: t.detalle, tono: "alerta", acciones: [], severidad: 100,
      metadata: { servicio, estado, origen }, clave, vigia: "lectura_ia",
      event_type: "aviso", source: "jarvis", status: "pendiente", priority: "alta",
    })
    if (avisoErr && avisoErr.code !== "23505") console.error("[ia_fallas] no se pudo dejar el aviso:", avisoErr.message)
  } catch (err) {
    console.error("[ia_fallas] error al registrar la falla:", err)
  }
}

export const CLAVE_AVISO_FALLA_IA = CLAVE_AVISO
