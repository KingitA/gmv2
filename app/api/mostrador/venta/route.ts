import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { createPedido } from "@/lib/actions/pedidos"

/**
 * POST /api/mostrador/venta — venta de mostrador en UN paso (Fase D).
 *
 * Orquesta el circuito existente sin duplicar lógica:
 *   1. createPedido (motor de precios completo) + condicion_entrega=retira_mostrador
 *   2. POST /api/comprobantes-venta/generar (facturación, CAE si corresponde)
 *   3. POST /api/pagos-clientes con imputación a los comprobantes generados
 *      (confirmar=true solo si es 100%% efectivo → entra a caja chica en el acto)
 *   4. pedido → entregado
 *
 * Si algo falla DESPUÉS de facturar, devuelve el estado parcial: la FA queda
 * con saldo y se cobra desde /pagos-clientes (nada se pierde ni duplica).
 *
 * Body: {
 *   cliente_id, items: [{ producto_id, cantidad }],
 *   metodos: [{ tipo: "efectivo"|"transferencia"|"cheque", monto, ... }],
 *   observaciones?
 * }
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  const paso = { pedido: false, factura: false, pago: false }
  let pedidoId: string | null = null
  let numeroPedido: string | null = null

  try {
    const supabase = await createClient()
    const body = await request.json()
    const { cliente_id, items, metodos, observaciones } = body

    if (!cliente_id || !items?.length || !metodos?.length) {
      return NextResponse.json(
        { error: "cliente_id, items y metodos son requeridos" },
        { status: 400 }
      )
    }

    const origin = new URL(request.url).origin
    const cookie = request.headers.get("cookie") ?? ""
    const internas = { "Content-Type": "application/json", cookie }

    // ── 1. Pedido (motor de precios completo) ──
    const pedido = await createPedido({
      cliente_id,
      items: items.map((i: any) => ({
        producto_id: i.producto_id,
        cantidad: Number(i.cantidad),
        precio_unitario: 0, // el motor calcula desde lista/segmento
        descuento: 0,
      })),
      observaciones: observaciones ? `Mostrador — ${observaciones}` : "Venta mostrador",
    })
    pedidoId = pedido.id
    numeroPedido = pedido.numero_pedido
    paso.pedido = true

    await supabase
      .from("pedidos")
      .update({ condicion_entrega: "retira_mostrador" })
      .eq("id", pedido.id)

    // ── 2. Facturar (reusa el circuito completo: segmentos, CAE, PDF, kardex) ──
    const genRes = await fetch(`${origin}/api/comprobantes-venta/generar`, {
      method: "POST",
      headers: internas,
      body: JSON.stringify({ pedido_id: pedido.id }),
    })
    const gen = await genRes.json()
    if (!genRes.ok) {
      return NextResponse.json(
        {
          error: `Pedido ${numeroPedido} creado, pero falló la facturación: ${gen.error}`,
          paso,
          pedido_id: pedidoId,
        },
        { status: 500 }
      )
    }
    paso.factura = true

    const comprobantes = (gen.comprobantes || []).filter(
      (c: any) => Number(c.total_factura ?? c.total ?? 0) > 0
    )
    const totalAFacturar = comprobantes.reduce(
      (s: number, c: any) => s + Number(c.total_factura ?? c.total ?? 0),
      0
    )

    // ── 3. Cobrar con imputación a los comprobantes generados ──
    const totalMetodos = (metodos as any[]).reduce((s, m) => s + Number(m.monto), 0)
    const soloEfectivo = (metodos as any[]).every((m) => m.tipo === "efectivo")

    // Imputar proporcionalmente hasta agotar el pago
    let restante = totalMetodos
    const imputaciones = comprobantes
      .map((c: any) => {
        const saldo = Number(c.total_factura ?? c.total ?? 0)
        const monto = Math.min(saldo, restante)
        restante -= monto
        return { comprobante_id: c.id, monto_imputado: monto }
      })
      .filter((i: any) => i.monto_imputado > 0)

    const pagoRes = await fetch(`${origin}/api/pagos-clientes`, {
      method: "POST",
      headers: internas,
      body: JSON.stringify({
        cliente_id,
        metodos,
        imputaciones,
        observaciones: `Venta mostrador ${numeroPedido}`,
        confirmar: soloEfectivo, // efectivo = plata a la vista; cheque/transf → revisión
        idempotency_key: body.idempotency_key || null, // dedup del submit del front
      }),
    })
    const pagoData = await pagoRes.json()
    if (!pagoRes.ok) {
      return NextResponse.json(
        {
          error: `Pedido ${numeroPedido} facturado, pero falló el cobro: ${pagoData.error}. Cobrar desde Pagos Clientes.`,
          paso,
          pedido_id: pedidoId,
          comprobantes,
        },
        { status: 500 }
      )
    }
    paso.pago = true

    // ── 4. Entregado (el cliente se lleva la mercadería) ──
    await supabase.from("pedidos").update({ estado: "entregado" }).eq("id", pedido.id)

    return NextResponse.json({
      success: true,
      pedido_id: pedidoId,
      numero_pedido: numeroPedido,
      comprobantes: comprobantes.map((c: any) => ({
        id: c.id,
        tipo: c.tipo_comprobante,
        numero: c.numero_comprobante,
        total: c.total_factura ?? c.total,
        pdf_url: c.pdf_url ?? null,
      })),
      total_facturado: totalAFacturar,
      pago_confirmado: soloEfectivo,
      numero_recibo: pagoData.numero_recibo ?? null,
      mensaje: soloEfectivo
        ? `Venta ${numeroPedido} facturada y cobrada.`
        : `Venta ${numeroPedido} facturada. El pago quedó pendiente de verificación (cheque/transferencia).`,
    })
  } catch (error: any) {
    console.error("[mostrador/venta] error:", error)
    return NextResponse.json(
      { error: error.message, paso, pedido_id: pedidoId },
      { status: 500 }
    )
  }
}
