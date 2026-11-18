import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requirePermiso } from "@/lib/auth"
import { ESTADO_NOMBRE } from "@/lib/bancos/credicoop/nucleo"
import { enviarPagoVep, vepsPendientes } from "@/lib/bancos/operaciones"
import { respuestaErrorBanco } from "@/lib/bancos/respuesta"

const vista = (o: any) => o && ({ id: o.id, estado: o.estado, estado_nombre: ESTADO_NOMBRE[o.estado as keyof typeof ESTADO_NOMBRE] ?? o.estado, estado_banco: o.estado_banco ?? null, motivo: o.motivo ?? null, ambiente: o.ambiente })

/**
 * GET  /api/bancos/credicoop/veps — VEP de ARCA pendientes de pago que informa Credicoop.
 * POST { numero_vep, cuenta_bancaria_id, monto_visto, vencimiento_id? } — manda a firmar el pago de ESE VEP.
 *      El importe y los CUIT se toman del banco. Si el importe ya no es el que se vio en la pantalla
 *      (monto_visto), no se manda y se devuelve el nuevo (monto_actual). Solo admin.
 */
export async function GET() {
  // Mandar plata al banco: mismo permiso que confirmar una orden de pago (solo admin)
  const auth = await requirePermiso("ordenes_pago_confirmar")
  if (auth.error) return auth.error
  try {
    const veps = await vepsPendientes(createAdminClient())
    return NextResponse.json({ veps: veps.map((v) => ({ ...v, operacion: vista(v.operacion) })) })
  } catch (e) { return respuestaErrorBanco(e, "listar VEP") }
}

export async function POST(req: Request) {
  // Mandar plata al banco: mismo permiso que confirmar una orden de pago (solo admin)
  const auth = await requirePermiso("ordenes_pago_confirmar")
  if (auth.error) return auth.error
  try {
    const body = await req.json().catch(() => ({}))
    const numeroVep = String(body?.numero_vep ?? "").replace(/[^0-9]/g, "")
    const cuenta = typeof body?.cuenta_bancaria_id === "string" ? body.cuenta_bancaria_id : ""
    if (!numeroVep || !cuenta) return NextResponse.json({ error: "Falta el número de VEP o la cuenta de la que sale el pago." }, { status: 400 })
    const o = await enviarPagoVep(createAdminClient(), { numeroVep, cuentaBancariaId: cuenta, montoVisto: typeof body?.monto_visto === "number" && Number.isFinite(body.monto_visto) ? body.monto_visto : null, vencimientoId: typeof body?.vencimiento_id === "string" ? body.vencimiento_id : null }, auth.user.id)
    return NextResponse.json({ ok: true, operacion: vista(o) })
  } catch (e) { return respuestaErrorBanco(e, "pagar VEP") }
}
