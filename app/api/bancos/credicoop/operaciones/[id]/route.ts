import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requirePermiso } from "@/lib/auth"
import { ESTADO_NOMBRE } from "@/lib/bancos/credicoop/nucleo"
import { actualizarOperacion, marcarAcreditada } from "@/lib/bancos/operaciones"
import { respuestaErrorBanco } from "@/lib/bancos/respuesta"

/**
 * POST /api/bancos/credicoop/operaciones/[id]
 *   { accion: "actualizar" }   le pregunta al banco cómo quedó la operación (por su id de origen)
 *   { accion: "acreditada" }   una persona la marca como vista en la cuenta
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
    const o = body?.accion === "acreditada" ? await marcarAcreditada(db, id, auth.user.id) : await actualizarOperacion(db, id, auth.user.id)
    return NextResponse.json({
      ok: true,
      operacion: { id: o.id, estado: o.estado, estado_nombre: ESTADO_NOMBRE[o.estado as keyof typeof ESTADO_NOMBRE] ?? o.estado, estado_banco: o.estado_banco ?? null, motivo: o.motivo ?? null, ambiente: o.ambiente, id_operacion_banco: o.id_operacion_banco ?? null, creado_at: o.creado_at, firmado_at: o.firmado_at ?? null },
    })
  } catch (e) { return respuestaErrorBanco(e, "actualizar operación") }
}
