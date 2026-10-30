import { NextRequest, NextResponse } from "next/server"
import { requirePermiso } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { moneda } from "@/lib/formato"
import { POST as registrarCobro } from "@/app/api/pagos-clientes/route"

// POST /api/mostrador/entregar — entregar un pedido en mostrador (P2-40).
//
// Body: { pedido_id, cobro?: { metodos: [...], idempotency_key? } }
//  - Pedido ya pagado (saldo $0): se entrega.
//  - Con saldo: `cobro` con los mismos medios que /caja (efectivo, transferencia,
//    cheque, depósito o varios: mixto). El cobro va por el circuito de siempre
//    (POST /api/pagos-clientes, imputado a los comprobantes del pedido). Se
//    entrega solo si después del cobro el saldo quedó en $0: una transferencia
//    queda pendiente hasta que se confirme en /caja, y recién ahí se entrega.
//  - La entrega la hace el servidor y queda quién (pedidos.actualizado_por) y
//    cuándo (historial de estados, P2-20).

const ESTADOS_PARA_RETIRAR = ["listo_para_retirar", "facturado"]

async function saldoDelPedido(sb: any, pedidoId: string) {
  const { data, error } = await sb
    .from("comprobantes_venta")
    .select("id, saldo_pendiente")
    .eq("pedido_id", pedidoId)
    .neq("estado_pago", "anulado")
    .is("anulado_en", null)
  if (error) throw error
  const comps = (data || []).map((c: any) => ({ id: c.id as string, saldo: Math.max(0, Number(c.saldo_pendiente) || 0) }))
  return { comps, total: Math.round(comps.reduce((s, c) => s + c.saldo, 0) * 100) / 100 }
}

export async function POST(request: NextRequest) {
  const auth = await requirePermiso("cargar_cobros")
  if (auth.error) return auth.error

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Pedido inválido" }, { status: 400 })
  }
  const pedidoId: string | undefined = body?.pedido_id
  if (!pedidoId) return NextResponse.json({ error: "Falta el pedido" }, { status: 400 })

  const sb = createAdminClient()
  try {
    const { data: pedido, error: pErr } = await sb
      .from("pedidos")
      .select("id, numero_pedido, estado, cliente_id, condicion_entrega, clientes(condicion_entrega)")
      .eq("id", pedidoId)
      .single()
    if (pErr || !pedido) return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 })

    if (pedido.estado === "entregado") {
      return NextResponse.json({ success: true, entregado: true, mensaje: `El pedido ${pedido.numero_pedido} ya estaba entregado.` })
    }
    if (!ESTADOS_PARA_RETIRAR.includes(pedido.estado)) {
      return NextResponse.json({ error: `El pedido ${pedido.numero_pedido} no está para retirar (estado: ${pedido.estado}).` }, { status: 409 })
    }
    const condicion = pedido.condicion_entrega ?? (pedido as any).clientes?.condicion_entrega
    if (condicion !== "retira_mostrador") {
      return NextResponse.json({ error: `El pedido ${pedido.numero_pedido} no es para retirar en mostrador.` }, { status: 409 })
    }

    let saldo = await saldoDelPedido(sb, pedidoId)
    let cobro: any = null

    if (saldo.total > 0.009) {
      const metodos = Array.isArray(body?.cobro?.metodos) ? body.cobro.metodos : []
      if (!metodos.length) {
        return NextResponse.json({
          error: `Tiene saldo de ${moneda(saldo.total)}: cobralo antes de entregar.`,
          error_code: "PEDIDO_CON_SALDO",
          saldo: saldo.total,
        }, { status: 409 })
      }
      // Mismo circuito que /caja: imputado a los comprobantes del pedido
      const res = await registrarCobro(new NextRequest(new URL("/api/pagos-clientes", request.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: pedido.cliente_id,
          metodos,
          imputaciones: saldo.comps.filter((c) => c.saldo > 0).map((c) => ({ comprobante_id: c.id, monto_imputado: c.saldo })),
          observaciones: `Retiro mostrador ${pedido.numero_pedido}`,
          confirmar: true,
          idempotency_key: body?.cobro?.idempotency_key,
        }),
      }))
      cobro = await res.json().catch(() => ({}))
      if (!res.ok) return NextResponse.json({ error: cobro?.error || "No se pudo registrar el cobro" }, { status: res.status })

      saldo = await saldoDelPedido(sb, pedidoId)
      if (saldo.total > 0.009) {
        return NextResponse.json({
          success: true,
          entregado: false,
          numero_recibo: cobro?.numero_recibo ?? null,
          mensaje: cobro?.estado === "pendiente"
            ? `Cobro registrado, pendiente de confirmar en Caja (${cobro?.aviso_pendiente || "transferencia / echeq"}). El pedido se entrega cuando el saldo quede en $0.`
            : `Cobro registrado. Queda saldo de ${moneda(saldo.total)}: el pedido no se entregó.`,
          saldo: saldo.total,
        })
      }
    }

    const { data: actualizado, error: uErr } = await sb
      .from("pedidos")
      .update({ estado: "entregado", actualizado_por: auth.user.id })
      .eq("id", pedidoId)
      .in("estado", ESTADOS_PARA_RETIRAR)
      .select("id")
    if (uErr) throw uErr
    if (!actualizado?.length) {
      return NextResponse.json({ error: "El pedido cambió de estado mientras se entregaba. Actualizá la pantalla." }, { status: 409 })
    }

    return NextResponse.json({
      success: true,
      entregado: true,
      numero_recibo: cobro?.numero_recibo ?? null,
      mensaje: cobro ? `Cobrado y entregado ${pedido.numero_pedido}` : `Entregado ${pedido.numero_pedido}`,
    })
  } catch (e: any) {
    console.error("[mostrador/entregar] error:", e)
    return NextResponse.json({ error: e?.message || "Error entregando el pedido" }, { status: 500 })
  }
}
