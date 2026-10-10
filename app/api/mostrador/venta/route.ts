import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { createPedido } from "@/lib/actions/pedidos"
import { determinarTipoFactura, mensajeErrorCondicionIva } from "@/lib/comprobantes/tipo-comprobante"
import { esErrorReglaPedido } from "@/lib/pedidos/errores"
import { errorCuit, normalizarCuit } from "@/lib/formato"

/**
 * POST /api/mostrador/venta — venta de mostrador en UN paso (Fase D).
 *
 * Orquesta el circuito existente sin duplicar lógica:
 *   1. createPedido (motor de precios completo, con las condiciones elegidas en
 *      mostrador: lista, método, descuentos, contado, mercadería) +
 *      condicion_entrega=retira_mostrador
 *   2. POST /api/comprobantes-venta/generar (facturación, CAE si corresponde;
 *      si sale de contado, la NC/REV del 10% se emite ahí mismo)
 *   3. POST /api/pagos-clientes por el SALDO REAL de los comprobantes (lo
 *      facturado con percepciones, menos la NC de contado si la hubo)
 *      (confirmar=true solo si es 100% efectivo → entra a caja chica en el acto)
 *   4. pedido → entregado
 *
 * La comisión queda a nombre del vendedor asignado al cliente (createPedido).
 * Antes de crear el pedido se valida lo que la facturación exige (CUIT,
 * condición de IVA): un error ahí ya no deja un pedido huérfano.
 *
 * Si algo falla DESPUÉS de facturar, devuelve el estado parcial: la FA queda
 * con saldo y se cobra desde Cobros (/pagos-clientes) — nada se pierde ni duplica.
 *
 * Body: {
 *   cliente_id, items: [{ producto_id, cantidad }],
 *   metodos: [{ tipo: "efectivo"|"transferencia"|"cheque" }],   (el monto lo fija el servidor)
 *   condiciones?: overrides de createPedido (lista/método/bonif_pedido/
 *                 bonif_mercaderia_pct/condiciones_proveedor/condiciones_marca/
 *                 mercaderia_bonificada),
 *   observaciones?, idempotency_key?
 * }
 */
const CAMPOS_CONDICION = [
  "metodo_facturacion_pedido", "lista_precio_pedido_id",
  "lista_limpieza_pedido_id", "metodo_limpieza_pedido",
  "lista_perf0_pedido_id", "metodo_perf0_pedido",
  "lista_perf_plus_pedido_id", "metodo_perf_plus_pedido",
  "bonif_pedido", "bonif_mercaderia_pct",
  "condiciones_proveedor", "condiciones_marca", "mercaderia_bonificada",
] as const

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

    // ── 0. Lo que la facturación exige, ANTES de crear el pedido ──
    const { data: cli } = await supabase
      .from("clientes")
      .select("id, nombre_razon_social, cuit, condicion_iva, metodo_facturacion")
      .eq("id", cliente_id)
      .maybeSingle()
    if (!cli) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 })
    // Cliente que opera con presupuesto (muchos no tienen CUIT: vacío / 00-00000000-0):
    // no se le exige CUIT ni condición de IVA. Si se factura, sí (lo vuelve a validar /generar).
    const soloPresupuesto = cli.metodo_facturacion === "Presupuesto"
    if (!soloPresupuesto && !normalizarCuit(cli.cuit)) {
      return NextResponse.json({
        error: `El cliente "${cli.nombre_razon_social}" no tiene CUIT: solo se le pueden emitir presupuestos. Para facturarle, cargá el CUIT en la ficha.`,
        error_code: "CLIENTE_SIN_CUIT",
      }, { status: 422 })
    }
    const errCuit = soloPresupuesto ? null : errorCuit(cli.cuit)
    if (errCuit) {
      return NextResponse.json({
        error: `El CUIT del cliente "${cli.nombre_razon_social}" no es válido (${cli.cuit}): corregilo en la ficha antes de vender. ${errCuit}.`,
        error_code: "CLIENTE_CUIT_INVALIDO",
      }, { status: 422 })
    }
    if (!soloPresupuesto && !determinarTipoFactura(cli.condicion_iva)) {
      return NextResponse.json({ error: mensajeErrorCondicionIva(cli.nombre_razon_social), error_code: "CLIENTE_SIN_CONDICION_IVA" }, { status: 422 })
    }

    const origin = new URL(request.url).origin
    const cookie = request.headers.get("cookie") ?? ""
    const internas = { "Content-Type": "application/json", cookie }

    const condiciones: Record<string, unknown> = {}
    for (const k of CAMPOS_CONDICION) if (body.condiciones?.[k] !== undefined) condiciones[k] = body.condiciones[k]

    // ── 1. Pedido (motor de precios completo) ──
    let pedido: any
    try {
      pedido = await createPedido({
        cliente_id,
        items: items.map((i: any) => ({
          producto_id: i.producto_id,
          cantidad: Number(i.cantidad),
          precio_unitario: 0, // el motor calcula desde lista/segmento
          descuento: 0,
        })),
        observaciones: observaciones ? `Mostrador — ${observaciones}` : "Venta mostrador",
        ...(condiciones as any),
      })
    } catch (e: any) {
      if (esErrorReglaPedido(e)) return NextResponse.json({ error: e.message }, { status: 422 })
      throw e
    }
    pedidoId = pedido.id
    numeroPedido = pedido.numero_pedido
    paso.pedido = true

    await supabase
      .from("pedidos")
      .update({ condicion_entrega: "retira_mostrador" })
      .eq("id", pedido.id)

    // ── 2. Facturar (reusa el circuito completo: segmentos, CAE, PDF, kardex, NC contado) ──
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
        { status: genRes.status === 422 ? 422 : 500 }
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

    // ── 3. Cobrar el SALDO REAL de cada comprobante (con percepciones; la NC de
    // contado, si salió, ya está imputada y bajó el saldo) ──
    const ids = comprobantes.map((c: any) => c.id).filter(Boolean)
    const { data: saldos } = ids.length
      ? await supabase.from("comprobantes_venta").select("id, saldo_pendiente").in("id", ids)
      : { data: [] as any[] }
    const saldoDe = new Map((saldos || []).map((s: any) => [s.id, Math.max(0, Number(s.saldo_pendiente) || 0)]))
    const imputaciones = ids
      .map((id: string) => ({ comprobante_id: id, monto_imputado: Math.round((saldoDe.get(id) ?? 0) * 100) / 100 }))
      .filter((i: any) => i.monto_imputado > 0)
    const aCobrar = Math.round(imputaciones.reduce((s: number, i: any) => s + i.monto_imputado, 0) * 100) / 100
    const tipoPago = String((metodos as any[])[0]?.tipo || "efectivo")
    const soloEfectivo = tipoPago === "efectivo"

    let numeroRecibo: string | null = null
    if (aCobrar > 0) {
      const pagoRes = await fetch(`${origin}/api/pagos-clientes`, {
        method: "POST",
        headers: internas,
        body: JSON.stringify({
          cliente_id,
          metodos: [{ ...(metodos as any[])[0], tipo: tipoPago, monto: aCobrar }],
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
            error: `Pedido ${numeroPedido} facturado, pero falló el cobro: ${pagoData.error}. Cobrar desde Cobros (Clientes → Cobros).`,
            paso,
            pedido_id: pedidoId,
            comprobantes,
          },
          { status: 500 }
        )
      }
      numeroRecibo = pagoData.numero_recibo ?? null
    }
    paso.pago = true

    // ── 4. Entregado (el cliente se lleva la mercadería) ──
    await supabase.from("pedidos").update({ estado: "entregado" }).eq("id", pedido.id)

    const ncContado = Number(gen.bonificacion_contado?.total_bonificacion || 0)
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
      nc_contado: ncContado,
      ...(gen.bonificacion_contado_error ? { aviso: `No salió la NC del 10% contado: ${gen.bonificacion_contado_error}` } : {}),
      total_cobrado: aCobrar,
      pago_confirmado: soloEfectivo,
      numero_recibo: numeroRecibo,
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
