import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requirePermiso } from "@/lib/auth"
import { ESTADO_NOMBRE } from "@/lib/bancos/credicoop/nucleo"
import { actualizarOperacion, marcarAcreditada, marcarRechazadaAMano, ordenListaParaConfirmar } from "@/lib/bancos/operaciones"
import { confirmarSiElBancoTermino } from "@/lib/bancos/confirmar-sola"

export const maxDuration = 60
import { respuestaErrorBanco } from "@/lib/bancos/respuesta"

/**
 * POST /api/bancos/credicoop/operaciones/[id]
 *   { accion: "actualizar" }   le pregunta al banco cómo quedó la operación (por su id de origen)
 *   { accion: "acreditada" }   una persona la marca como vista en la cuenta
 *   { accion: "rechazar", motivo }   destrabe a mano: se marca como rechazada una operación que no
 *                              termina, después de verificar en Banca Internet Empresa. Queda quién y por qué.
 * Devuelve además orden_lista_para_confirmar: todo lo mandado al banco real quedó hecho y la orden
 * sigue pendiente, y `confirmacion`: si con esta consulta el banco terminó, la orden se confirma
 * SOLA y se le manda al proveedor (lib/bancos/confirmar-sola.ts); ahí viene qué pasó, en palabras.
 * Solo admin.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // Mandar plata al banco: mismo permiso que confirmar una orden de pago (solo admin)
  const auth = await requirePermiso("ordenes_pago_confirmar")
  if (auth.error) return auth.error
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const db = createAdminClient()
    const o = body?.accion === "acreditada" ? await marcarAcreditada(db, id, auth.user.id)
      : body?.accion === "rechazar" ? await marcarRechazadaAMano(db, id, auth.user.id, String(body?.motivo ?? ""), String((auth.user as { email?: string | null }).email ?? "un administrador"))
      : await actualizarOperacion(db, id, auth.user.id)
    // Si el banco ya terminó todo lo de la orden, se confirma sola y se le manda al proveedor
    const confirmacion = o.orden_pago_id && body?.accion !== "rechazar" ? await confirmarSiElBancoTermino(db, o.orden_pago_id) : null
    const lista = o.orden_pago_id ? await ordenListaParaConfirmar(db, o.orden_pago_id) : false
    return NextResponse.json({
      ok: true, orden_lista_para_confirmar: lista, confirmacion: confirmacion && confirmacion.estado !== "nada" ? confirmacion : null,
      operacion: { id: o.id, estado: o.estado, estado_nombre: ESTADO_NOMBRE[o.estado as keyof typeof ESTADO_NOMBRE] ?? o.estado, estado_banco: o.estado_banco ?? null, motivo: o.motivo ?? null, ambiente: o.ambiente, id_operacion_banco: o.id_operacion_banco ?? null, creado_at: o.creado_at, firmado_at: o.firmado_at ?? null },
    })
  } catch (e) { return respuestaErrorBanco(e, "actualizar operación") }
}
