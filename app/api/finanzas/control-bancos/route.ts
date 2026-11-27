import { NextRequest, NextResponse } from "next/server"
import { requirePermiso } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { parseFecha } from "@/lib/formato"
import { cambiarAjustesCargos, panelControl, registrarCargos, revisarCargos } from "@/lib/bancos/control/servidor"

export const maxDuration = 60

/**
 * Control diario de bancos (bancos tanda 5) — solo admin (registra en el libro de fondos, como /caja).
 *
 * GET  → por cuenta: saldo del banco / del sistema / diferencia, qué falta explicar, última
 *        actualización; y los cargos del banco que se registrarían.
 * POST { accion }:
 *   registrar { ids? }        → registra los cargos propuestos (todos, o esos movimientos)
 *   revisar                   → en automático registra; en propuesta solo cuenta
 *   modo { propuesta }        → enciende / apaga el modo propuesta
 *   desde { desde }           → primer día que se registra (dd/mm/aaaa o AAAA-MM-DD; vacío = 60 días)
 */
export async function GET() {
  const auth = await requirePermiso("caja")
  if (auth.error) return auth.error
  try {
    return NextResponse.json(await panelControl(createAdminClient()))
  } catch (e) {
    console.error("[finanzas/control-bancos] GET:", e)
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requirePermiso("caja")
  if (auth.error) return auth.error
  const db = createAdminClient()
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  try {
    switch (body.accion) {
      case "registrar": {
        const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : null
        return NextResponse.json({ success: true, ...(await registrarCargos(db, { usuarioId: auth.user.id, automatico: false, ids })) })
      }
      case "revisar":
        return NextResponse.json({ success: true, ...(await revisarCargos(db)) })
      case "modo":
        if (typeof body.propuesta !== "boolean") return NextResponse.json({ error: "propuesta: true o false" }, { status: 400 })
        await cambiarAjustesCargos(db, auth.user.id, { propuesta: body.propuesta })
        return NextResponse.json({ success: true, revision: body.propuesta ? null : await revisarCargos(db) })
      case "desde": {
        const txt = typeof body.desde === "string" ? body.desde.trim() : ""
        const desde = txt ? parseFecha(txt) : null
        if (txt && !desde) return NextResponse.json({ error: "Fecha inválida" }, { status: 400 })
        await cambiarAjustesCargos(db, auth.user.id, { desde })
        return NextResponse.json({ success: true })
      }
      default:
        return NextResponse.json({ error: "Acción desconocida" }, { status: 400 })
    }
  } catch (e) {
    console.error("[finanzas/control-bancos] POST:", e)
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
