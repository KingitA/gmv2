import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requirePermiso } from "@/lib/auth"
import { hoyISO, parseFecha, sumarDiasISO } from "@/lib/formato"
import { traerMovimientos } from "@/lib/bancos/operaciones"
import { respuestaErrorBanco } from "@/lib/bancos/respuesta"

/**
 * POST /api/bancos/credicoop/movimientos { cuenta_bancaria_id, desde?, hasta? }
 * Trae los movimientos de la cuenta desde Credicoop y los carga en la conciliación (Finanzas →
 * Conciliación) como un extracto. El sistema PROPONE las coincidencias; no concilia nada solo.
 * Sin fechas: los últimos 7 días. Solo admin.
 */
export async function POST(req: Request) {
  // Mandar plata al banco: mismo permiso que confirmar una orden de pago (solo admin)
  const auth = await requirePermiso("ordenes_pago_confirmar")
  if (auth.error) return auth.error
  try {
    const body = await req.json().catch(() => ({}))
    const cuenta = typeof body?.cuenta_bancaria_id === "string" ? body.cuenta_bancaria_id : ""
    if (!cuenta) return NextResponse.json({ error: "Elegí la cuenta." }, { status: 400 })
    const hoy = hoyISO()
    let desde = parseFecha(body?.desde) ?? sumarDiasISO(hoy, -7)
    let hasta = parseFecha(body?.hasta) ?? hoy
    if (desde > hasta) [desde, hasta] = [hasta, desde]
    if (hasta > hoy) hasta = hoy
    return NextResponse.json({ ok: true, desde, hasta, ...(await traerMovimientos(createAdminClient(), { cuentaBancariaId: cuenta, desde, hasta }, auth.user.id)) })
  } catch (e) { return respuestaErrorBanco(e, "traer movimientos") }
}
