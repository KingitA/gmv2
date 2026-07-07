import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"
import { todayArgentina } from "@/lib/utils"

/**
 * POST /api/viajante/cobro — cobro en la calle del viajante (Fase E).
 * Contrato: docs/CONTRATO-API-VIAJANTES.md §3. Un solo shape para cliente
 * único y multi-cliente (clientes[] siempre array).
 *
 * Todos los pagos nacen 'pendiente_rendicion' con cobrador_tipo='viajante':
 * suman a la billetera (trigger de billetera_movimientos) y se confirman con
 * la segunda firma en la rendición de oficina (rendicion_confirmar).
 */
export async function POST(request: NextRequest) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const body = await request.json()
    const { clientes, metodos, comprobante_urls, observaciones } = body

    if (!Array.isArray(clientes) || !clientes.length || !Array.isArray(metodos) || !metodos.length) {
      return NextResponse.json({ error: "clientes y metodos son requeridos" }, { status: 400 })
    }

    // ── Validación de totales ──
    // Además de imputaciones y pago a cuenta, se pueden cobrar pedidos SIN
    // facturar (anticipo, mismo criterio que el ERP): c.pedidos = [{pedido_id,
    // monto, contado}] — el monto va como pago a cuenta (sin imputación) y el
    // flag contado marca pago_contado_10 (NC del 10% al facturar).
    const totalMetodos = metodos.reduce((s: number, m: any) => s + Number(m.monto || 0), 0)
    const montoCliente = (c: any) =>
      (c.imputaciones || []).reduce((s: number, i: any) => s + Number(i.monto || 0), 0) +
      (c.pedidos || []).reduce((s: number, p: any) => s + Number(p.monto || 0), 0) +
      Number(c.pago_a_cuenta || 0) -
      Number(c.devolucion?.monto_descontado || 0)
    const totalClientes = clientes.reduce((s: number, c: any) => s + montoCliente(c), 0)

    if (totalMetodos <= 0) {
      return NextResponse.json({ error: "El monto total debe ser mayor a 0" }, { status: 400 })
    }
    if (Math.abs(totalMetodos - totalClientes) > 0.01) {
      return NextResponse.json(
        { error: `Los métodos de pago ($${totalMetodos}) no coinciden con lo imputado ($${totalClientes})` },
        { status: 400 }
      )
    }

    // ── Validar clientes e imputaciones ──
    const clienteIds = clientes.map((c: any) => c.cliente_id)
    const { data: clientesDb } = await supabase
      .from("clientes")
      .select("id, vendedor_id")
      .in("id", clienteIds)
    const vendedorDe = new Map((clientesDb || []).map((c) => [c.id, c.vendedor_id]))
    for (const c of clientes) {
      if (!vendedorDe.has(c.cliente_id)) {
        return NextResponse.json({ error: `Cliente ${c.cliente_id} no encontrado` }, { status: 404 })
      }
      for (const imp of c.imputaciones || []) {
        if (!imp.comprobante_id || Number(imp.monto) <= 0) {
          return NextResponse.json({ error: "Imputación inválida" }, { status: 400 })
        }
      }
      for (const p of c.pedidos || []) {
        if (!p.pedido_id || Number(p.monto) <= 0) {
          return NextResponse.json({ error: "Pedido anticipado inválido" }, { status: 400 })
        }
      }
    }

    // Validar pedidos anticipados: que existan y sean del cliente indicado
    const pedidoIds = clientes.flatMap((c: any) => (c.pedidos || []).map((p: any) => p.pedido_id))
    const pedidosDb = new Map<string, any>()
    if (pedidoIds.length) {
      const { data: rows } = await supabase
        .from("pedidos")
        .select("id, cliente_id, numero_pedido")
        .in("id", pedidoIds)
      for (const r of rows || []) pedidosDb.set(r.id, r)
      for (const c of clientes) {
        for (const p of c.pedidos || []) {
          const row = pedidosDb.get(p.pedido_id)
          if (!row || row.cliente_id !== c.cliente_id) {
            return NextResponse.json({ error: `Pedido ${p.pedido_id} inexistente o de otro cliente` }, { status: 400 })
          }
        }
      }
    }

    // ── Cabecera multi-cliente ──
    let cobranzaId: string | null = null
    if (clientes.length > 1) {
      const { data: cab, error: cabErr } = await supabase
        .from("cobranzas")
        .insert({
          fecha: todayArgentina(),
          estado: "pendiente",
          origen: "viajante",
          total: totalMetodos,
          observaciones: observaciones || null,
          creado_por: session.user.id,
        })
        .select("id")
        .single()
      if (cabErr) throw cabErr
      cobranzaId = cab.id
    }

    const pagosCreados: any[] = []
    let billeteraVendedorId: string | null = null
    let restanteMetodos = clientes.map((c: any) => montoCliente(c))

    for (let idx = 0; idx < clientes.length; idx++) {
      const c = clientes[idx]
      const montoPago = restanteMetodos[idx]
      if (montoPago <= 0) continue

      // Billetera del vendedor dueño del cliente (si es del usuario); sino el primero
      const vendedorCliente = vendedorDe.get(c.cliente_id)
      const vendedorId = session.vendedorIds.includes(vendedorCliente)
        ? vendedorCliente
        : session.vendedorIds[0]
      billeteraVendedorId = billeteraVendedorId ?? vendedorId

      // Nota de anticipo a pedidos sin facturar (mismo formato que el ERP)
      const pedidosAnticipo: any[] = c.pedidos || []
      const notaAnticipo = pedidosAnticipo.length
        ? `Anticipo a pedido(s) sin facturar: ${pedidosAnticipo
            .map((p: any) => pedidosDb.get(p.pedido_id)?.numero_pedido || p.pedido_id)
            .join(", ")}`
        : ""
      const obsPago = [observaciones, notaAnticipo].filter(Boolean).join(" · ") || null

      // ── Pago ──
      const { data: pago, error: pagoErr } = await supabase
        .from("pagos_clientes")
        .insert({
          cliente_id: c.cliente_id,
          vendedor_id: vendedorId,
          monto: montoPago,
          fecha_pago: todayArgentina(),
          observaciones: obsPago,
          estado: "pendiente_rendicion",
          cobrador_tipo: "viajante",
          creado_por: session.user.id,
          ...(cobranzaId ? { cobranza_id: cobranzaId } : {}),
        })
        .select("id")
        .single()
      if (pagoErr) throw pagoErr

      // ── Pedidos anticipados: vincular al pago; contado marca el 10% ──
      for (const p of pedidosAnticipo) {
        await supabase
          .from("pedidos")
          .update({
            anticipo_pago_id: pago.id,
            ...(p.contado ? { pago_contado_10: true } : {}),
          })
          .eq("id", p.pedido_id)
      }

      // ── Detalles por método (proporcional al monto del cliente) ──
      const proporcion = montoPago / totalMetodos
      for (const m of metodos) {
        const montoDetalle =
          clientes.length === 1
            ? Number(m.monto)
            : Math.round(Number(m.monto) * proporcion * 100) / 100
        if (montoDetalle <= 0) continue

        let chequeId: string | null = null
        if (m.tipo === "cheque") {
          const { data: cheque } = await supabase
            .from("cheques")
            .insert({
              tipo: "TERCERO",
              estado: "EN_CARTERA",
              banco: m.banco || "S/D",
              numero: m.numero_cheque || "S/N",
              fecha_emision: todayArgentina(),
              fecha_vencimiento: m.fecha_cheque || todayArgentina(),
              monto: montoDetalle,
              color: m.color || "BLANCO",
              es_echeq: Boolean(m.es_echeq),
              cliente_origen_id: c.cliente_id,
            })
            .select("id")
            .single()
          chequeId = cheque?.id ?? null
        }

        await supabase.from("pagos_detalle").insert({
          pago_id: pago.id,
          tipo_pago: m.tipo,
          monto: montoDetalle,
          banco: m.banco || null,
          numero_cheque: m.numero_cheque || null,
          fecha_cheque: m.fecha_cheque || null,
          referencia: m.referencia_transferencia || null,
          cuenta_bancaria_id: m.cuenta_bancaria_id || null,
          color_cheque: m.color || null,
          cheque_id: chequeId,
        })
      }

      // ── Imputaciones pendientes ──
      const imps = (c.imputaciones || []).map((i: any) => ({
        pago_id: pago.id,
        comprobante_id: i.comprobante_id,
        tipo_comprobante: "venta",
        monto_imputado: Number(i.monto),
        estado: "pendiente",
      }))
      if (imps.length) {
        const { error: impErr } = await supabase.from("imputaciones").insert(imps)
        if (impErr) throw impErr
      }

      // ── Fotos de comprobantes ──
      const fotos = (comprobante_urls || [])
        .map((f: any) => (typeof f === "string" ? { url: f } : f))
        .filter((f: any) => f?.url)
      if (fotos.length && idx === 0) {
        await supabase.from("pago_comprobantes").insert(
          fotos.map((f: any) => ({ pago_id: pago.id, url: f.url, nombre: f.nombre || null }))
        )
      }

      // ── Billetera (el trigger actualiza el saldo) ──
      const medioDominante = metodos.length === 1
        ? (metodos[0].tipo === "cheque" ? "cheque" : metodos[0].tipo === "transferencia" ? "transferencia" : "efectivo")
        : null
      await supabase.from("billetera_movimientos").insert({
        viajante_id: vendedorId,
        tipo: "cobro_cliente",
        medio: medioDominante,
        monto: montoPago,
        concepto: `Cobro en calle`,
        referencia_id: pago.id,
        referencia_tipo: "pago_cliente",
        fecha: new Date().toISOString(),
        creado_por: session.user.id,
      })

      pagosCreados.push({
        pago_id: pago.id,
        cliente_id: c.cliente_id,
        monto: montoPago,
        estado: "pendiente_rendicion",
      })
    }

    // Saldo actual de la billetera
    let billeteraSaldo = 0
    if (billeteraVendedorId) {
      const { data: saldo } = await supabase
        .from("saldos_financieros")
        .select("saldo")
        .eq("cuenta_tipo", "BILLETERA")
        .eq("cuenta_id", billeteraVendedorId)
        .eq("color", "BLANCO")
        .maybeSingle()
      billeteraSaldo = Number(saldo?.saldo ?? 0)
    }

    return NextResponse.json(
      {
        success: true,
        cobranza_id: cobranzaId,
        pagos: pagosCreados,
        billetera_saldo: billeteraSaldo,
      },
      { status: 201 }
    )
  } catch (error: any) {
    console.error("[viajante/cobro] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
