import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requirePermiso } from "@/lib/auth"
import { ESTADO_NOMBRE } from "@/lib/bancos/credicoop/nucleo"
import { enviarPagoDeOrden, pagosEnviablesDeOrden } from "@/lib/bancos/operaciones"
import { respuestaErrorBanco } from "@/lib/bancos/respuesta"

const vista = (o: any) => o && ({
  id: o.id, estado: o.estado, estado_nombre: ESTADO_NOMBRE[o.estado as keyof typeof ESTADO_NOMBRE] ?? o.estado, estado_banco: o.estado_banco ?? null,
  motivo: o.motivo ?? null, ambiente: o.ambiente, id_operacion_banco: o.id_operacion_banco ?? null, creado_at: o.creado_at, firmado_at: o.firmado_at ?? null,
})

/**
 * GET  /api/bancos/credicoop/ordenes-pago/[id] — qué pagos de la orden se pueden mandar a
 *      Credicoop (transferencias, e-cheq a emitir, e-cheq de terceros a endosar), con los datos
 *      que se van a mandar, lo que falta para poder mandarlos y el estado si ya se mandaron.
 * POST { detalle_id, cuenta_bancaria_id? } — manda ESE pago a Credicoop para firmar con token. No confirma la orden.
 *      cuenta_bancaria_id: solo para endosar un e-cheq cuando hay más de una cuenta de Credicoop habilitada.
 * Solo admin.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  // Mandar plata al banco: mismo permiso que confirmar una orden de pago (solo admin)
  const auth = await requirePermiso("ordenes_pago_confirmar")
  if (auth.error) return auth.error
  try {
    const { id } = await params
    const info = await pagosEnviablesDeOrden(createAdminClient(), id)
    return NextResponse.json({ orden: info.orden, conexion: info.conexion, pagos: info.pagos.map((p) => ({ ...p, operacion: vista(p.operacion) })) })
  } catch (e) { return respuestaErrorBanco(e, "pagos de la orden") }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // Mandar plata al banco: mismo permiso que confirmar una orden de pago (solo admin)
  const auth = await requirePermiso("ordenes_pago_confirmar")
  if (auth.error) return auth.error
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const detalleId = typeof body?.detalle_id === "string" ? body.detalle_id : ""
    if (!detalleId) return NextResponse.json({ error: "Falta indicar qué pago de la orden se manda." }, { status: 400 })
    const operacion = await enviarPagoDeOrden(createAdminClient(), id, detalleId, auth.user.id, typeof body?.cuenta_bancaria_id === "string" ? body.cuenta_bancaria_id : null)
    return NextResponse.json({ ok: true, operacion: vista(operacion) })
  } catch (e) { return respuestaErrorBanco(e, "enviar pago") }
}
