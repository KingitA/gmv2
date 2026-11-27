import { NextRequest, NextResponse } from "next/server"
import { requirePermiso } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  cambiarModo, ErrorTransferencia, panelTransferencias, revisarTransferencias, vincularExistente, vincularNuevo,
} from "@/lib/bancos/transferencias/servidor"

// Transferencias de clientes vistas en el banco (Tanda 3 del plan de bancos). Solo admin (permiso caja).
// GET  → panel de /caja: créditos sin identificar (con propuesta / sugerencias), confirmadas por el banco
//        y transferencias informadas que no aparecieron.
// POST { accion: "revisar" }                                     → cruza ahora (en propuesta no confirma)
//      { accion: "modo", propuesta: boolean }                     → enciende / apaga el modo propuesta
//      { accion: "vincular", movimiento_id, pago_id, detalle_id } → con una transferencia informada
//      { accion: "vincular", movimiento_id, cliente_id }          → crea el cobro de ese cliente y lo confirma
export async function GET() {
  const auth = await requirePermiso("caja")
  if (auth.error) return auth.error
  try {
    return NextResponse.json(await panelTransferencias(createAdminClient()))
  } catch (e: any) {
    console.error("[bancos/transferencias] GET:", e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requirePermiso("caja")
  if (auth.error) return auth.error
  try {
    const db = createAdminClient()
    const body = await request.json().catch(() => ({}))
    switch (body.accion) {
      case "revisar":
        return NextResponse.json(await revisarTransferencias(db))
      case "modo":
        if (typeof body.propuesta !== "boolean") return NextResponse.json({ error: "propuesta: true o false" }, { status: 400 })
        await cambiarModo(db, body.propuesta, auth.user.id)
        return NextResponse.json({ ok: true, modo_propuesta: body.propuesta, revision: body.propuesta ? null : await revisarTransferencias(db) })
      case "vincular": {
        if (!body.movimiento_id) return NextResponse.json({ error: "Falta el movimiento del banco" }, { status: 400 })
        const r = body.pago_id && body.detalle_id
          ? await vincularExistente(db, { movimientoId: body.movimiento_id, pagoId: body.pago_id, detalleId: body.detalle_id, usuarioId: auth.user.id })
          : body.cliente_id
            ? await vincularNuevo(db, { movimientoId: body.movimiento_id, clienteId: body.cliente_id, usuarioId: auth.user.id })
            : null
        if (!r) return NextResponse.json({ error: "Elegí el cliente o la transferencia informada" }, { status: 400 })
        return NextResponse.json({ ok: true, ...r })
      }
      default:
        return NextResponse.json({ error: "Acción inválida" }, { status: 400 })
    }
  } catch (e: any) {
    if (e instanceof ErrorTransferencia) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error("[bancos/transferencias] POST:", e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
