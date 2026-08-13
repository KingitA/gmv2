import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"
import { todayArgentina } from "@/lib/utils"
import { colorOverride, derivarColorCheque, COLOR_PENDIENTE } from "@/lib/actions/color-cheque"
import { crearCobranza, recortarImputaciones, type DetalleInput } from "@/lib/cobranzas/crear"

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
    const { clientes, metodos, comprobante_urls, observaciones, idempotency_key } = body

    if (!Array.isArray(clientes) || !clientes.length || !Array.isArray(metodos) || !metodos.length) {
      return NextResponse.json({ error: "clientes y metodos son requeridos" }, { status: 400 })
    }

    // ── Validación de totales ──
    // Además de imputaciones y pago a cuenta, se pueden cobrar pedidos SIN
    // facturar (anticipo, mismo criterio que el ERP): c.pedidos = [{pedido_id,
    // monto, contado}] — el monto va como pago a cuenta (sin imputación) y el
    // flag contado marca pago_contado_10 (NC del 10% al facturar).
    const totalMetodos = metodos.reduce((s: number, m: any) => s + Number(m.monto || 0), 0)
    // Devoluciones descontadas del cobro (array nuevo; c.devolucion single es legacy)
    const devolucionesDe = (c: any): { devolucion_id: string; monto: number }[] => {
      const arr = Array.isArray(c.devoluciones) ? c.devoluciones : c.devolucion ? [c.devolucion] : []
      return arr
        .map((d: any) => ({ devolucion_id: d.devolucion_id, monto: Number(d.monto ?? d.monto_descontado ?? 0) }))
        .filter((d: any) => d.devolucion_id && d.monto > 0)
    }
    // bonificacion_proyectada: NC 10% contado que emitirá el ERP al confirmar
    //   (las imputaciones van completas; la NC salda el resto).
    // ajuste_redondeo: crédito por redondeo que el front asienta vía
    //   /api/clientes/[id]/ajustes después de crear el pago.
    // Ambos cubren parte de lo imputado sin ser plata entregada.
    const montoCliente = (c: any) =>
      (c.imputaciones || []).reduce((s: number, i: any) => s + Number(i.monto || 0), 0) +
      (c.pedidos || []).reduce((s: number, p: any) => s + Number(p.monto || 0), 0) +
      Number(c.pago_a_cuenta || 0) -
      Number(c.bonificacion_proyectada || 0) -
      Number(c.ajuste_redondeo || 0) -
      devolucionesDe(c).reduce((s, d) => s + d.monto, 0)
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
      .select("id, vendedor_id, nombre")
      .in("id", clienteIds)
    const vendedorDe = new Map((clientesDb || []).map((c) => [c.id, c.vendedor_id]))
    const nombreDe = new Map((clientesDb || []).map((c) => [c.id, c.nombre]))
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

    // ── Validar devoluciones descontadas (pendientes, del cliente, con tope) ──
    const todosDescuentos = clientes.flatMap((c: any) =>
      devolucionesDe(c).map((d) => ({ ...d, cliente_id: c.cliente_id }))
    )
    if (todosDescuentos.length) {
      const devIds = [...new Set(todosDescuentos.map((d) => d.devolucion_id))]
      const { data: devs } = await supabase
        .from("devoluciones")
        .select("id, cliente_id, estado, monto_total")
        .in("id", devIds)
      const devMap = new Map((devs || []).map((d: any) => [d.id, d]))
      const { data: usados } = await supabase
        .from("devoluciones_descuentos")
        .select("devolucion_id, monto")
        .in("devolucion_id", devIds)
      const usadoPorDev = new Map<string, number>()
      for (const u of usados || [])
        usadoPorDev.set(u.devolucion_id, (usadoPorDev.get(u.devolucion_id) || 0) + Number(u.monto))

      for (const d of todosDescuentos) {
        const dev = devMap.get(d.devolucion_id)
        if (!dev) return NextResponse.json({ error: "Devolución inexistente" }, { status: 400 })
        if (dev.cliente_id !== d.cliente_id)
          return NextResponse.json({ error: "La devolución no es de ese cliente" }, { status: 400 })
        if (dev.estado !== "pendiente")
          return NextResponse.json({ error: "La devolución ya fue procesada por la oficina" }, { status: 400 })
        const restante = Number(dev.monto_total || 0) - (usadoPorDev.get(d.devolucion_id) || 0)
        if (d.monto > restante + 0.01)
          return NextResponse.json(
            { error: `La devolución tiene ${restante.toFixed(2)} disponibles y se intentó descontar ${d.monto.toFixed(2)}` },
            { status: 400 }
          )
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

      // ── Detalles por método (proporcional al monto del cliente) ──
      // Color de cheques: derivado de las imputaciones de ESTE cliente
      // (>50% a PRES ⇒ NEGRO, sino BLANCO); override manual del viajante si
      // vino explícito; sin imputaciones ⇒ PENDIENTE (oficina asigna al rendir).
      const colorCliente =
        (await derivarColorCheque(supabase, c.imputaciones)) || COLOR_PENDIENTE

      const proporcion = montoPago / totalMetodos
      const detalles: DetalleInput[] = []
      for (const m of metodos) {
        const montoDetalle =
          clientes.length === 1
            ? Number(m.monto)
            : Math.round(Number(m.monto) * proporcion * 100) / 100
        if (montoDetalle <= 0) continue
        detalles.push({
          tipo_pago: m.tipo,
          monto: montoDetalle,
          banco: m.banco || null,
          numero_cheque: m.numero_cheque || null,
          fecha_cheque: m.fecha_cheque || null,
          cuit_emisor: m.tipo === "cheque" ? m.cuit_emisor || null : null,
          referencia: m.referencia_transferencia || null,
          cuenta_bancaria_id: m.cuenta_bancaria_id || null,
          color_cheque: m.tipo === "cheque" ? colorOverride(m.color) || colorCliente : null,
          cheque: m.tipo === "cheque"
            ? {
                banco: m.banco || "S/D",
                numero: m.numero_cheque || "S/N",
                fecha_emision: todayArgentina(),
                fecha_vencimiento: m.fecha_cheque || todayArgentina(),
                monto: montoDetalle,
                color: colorOverride(m.color) || colorCliente,
                es_echeq: Boolean(m.es_echeq),
              }
            : null,
        })
      }
      // El prorrateo redondea por método: el último absorbe la diferencia para
      // que Σ detalles == monto del pago AL CENTAVO (si no, caja y libro mayor
      // quedan desalineados; la RPC lo rechaza).
      const sumDetalles = detalles.reduce((s, d) => s + d.monto, 0)
      const diffCentavos = Math.round((montoPago - sumDetalles) * 100) / 100
      if (detalles.length && Math.abs(diffCentavos) > 0.001) {
        const ultimo = detalles[detalles.length - 1]
        ultimo.monto = Math.round((ultimo.monto + diffCentavos) * 100) / 100
        if (ultimo.cheque) ultimo.cheque.monto = ultimo.monto
      }

      // ── Pago transaccional (pago + detalle + cheques + imputaciones) ──
      // Clave derivada del submit por cliente (nibble de versión → 'e' + índice):
      // reintentos del viajante con mala señal no duplican ningún pago del lote.
      const { pago_id: pagoId, dedup } = await crearCobranza(supabase, {
        idempotency_key: idempotency_key
          ? (clientes.length === 1
              ? idempotency_key
              : idempotency_key.slice(0, 14) + "e" + idempotency_key.slice(15, 34) + String(10 + idx))
          : null,
        cliente_id: c.cliente_id,
        vendedor_id: vendedorId,
        cobranza_id: cobranzaId,
        cobrador_tipo: "viajante",
        monto: montoPago,
        fecha_pago: todayArgentina(),
        observaciones: obsPago,
        estado: "pendiente_rendicion",
        creado_por: session.user.id,
        detalles,
        imputaciones: recortarImputaciones(
          (c.imputaciones || [])
            .filter((i: any) => i?.comprobante_id)
            .map((i: any) => ({ comprobante_id: i.comprobante_id, monto_imputado: Number(i.monto) })),
          montoPago,
        ),
      })
      const pago = { id: pagoId }
      if (dedup) {
        pagosCreados.push({ pago_id: pago.id, cliente_id: c.cliente_id, monto: montoPago, estado: "pendiente_rendicion", dedup: true })
        continue
      }

      // ── Devoluciones descontadas: asentar el vínculo (anti doble uso) ──
      const descuentosCliente = devolucionesDe(c)
      if (descuentosCliente.length) {
        const { error: descErr } = await supabase.from("devoluciones_descuentos").insert(
          descuentosCliente.map((d) => ({
            devolucion_id: d.devolucion_id,
            pago_id: pago.id,
            monto: Math.round(d.monto * 100) / 100,
          }))
        )
        if (descErr) console.error("[viajante/cobro] descuento devolución:", descErr.message)
      }

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
        concepto: `Cobro ${nombreDe.get(c.cliente_id) || "cliente"}`,
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
