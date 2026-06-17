import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { todayArgentina } from "@/lib/utils"

// ─── GET: listar pagos con filtros ───────────────────────────
export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const cliente_id = searchParams.get("cliente_id")
    const estado = searchParams.get("estado")
    const fecha_desde = searchParams.get("fecha_desde")
    const fecha_hasta = searchParams.get("fecha_hasta")

    // Consulta base sin joins de FK potencialmente problemáticos
    let query = supabase
      .from("pagos_clientes")
      .select("*")
      .order("created_at", { ascending: false })

    if (cliente_id) query = query.eq("cliente_id", cliente_id)
    if (estado) query = query.eq("estado", estado)
    if (fecha_desde) query = query.gte("fecha_pago", fecha_desde)
    if (fecha_hasta) query = query.lte("fecha_pago", fecha_hasta)

    const { data, error } = await query
    if (error) throw error

    const pagos = data || []
    if (pagos.length === 0) return NextResponse.json([])

    const pagoIds = pagos.map((p: any) => p.id)
    const clienteIds = [...new Set(pagos.map((p: any) => p.cliente_id).filter(Boolean))]

    // Cargar clientes, detalles e imputaciones en batch (3 queries para todos los pagos)
    const [
      { data: clientesData },
      { data: detallesData },
      { data: imputacionesData },
    ] = await Promise.all([
      clienteIds.length
        ? supabase.from("clientes").select("id, nombre, razon_social, cuit").in("id", clienteIds)
        : Promise.resolve({ data: [] }),
      supabase.from("pagos_detalle").select("*").in("pago_id", pagoIds),
      supabase.from("imputaciones").select("*, comprobante:comprobantes_venta(tipo_comprobante, numero_comprobante, total_factura)").in("pago_id", pagoIds),
    ])

    // Cargar recibos por batch (tabla puede no existir)
    let recibosData: any[] = []
    try {
      const { data: rd } = await supabase.from("recibos").select("id, numero_recibo, pdf_url, fecha, pago_id").in("pago_id", pagoIds)
      recibosData = rd || []
    } catch { /* tabla no existe aún */ }

    // Indexar por pago_id
    const clientesMap = new Map((clientesData || []).map((c: any) => [c.id, c]))
    const detallesByPago = new Map<string, any[]>()
    for (const d of detallesData || []) {
      if (!detallesByPago.has(d.pago_id)) detallesByPago.set(d.pago_id, [])
      detallesByPago.get(d.pago_id)!.push(d)
    }
    const imputacionesByPago = new Map<string, any[]>()
    for (const i of imputacionesData || []) {
      if (!imputacionesByPago.has(i.pago_id)) imputacionesByPago.set(i.pago_id, [])
      imputacionesByPago.get(i.pago_id)!.push(i)
    }
    const recibosByPago = new Map<string, any[]>()
    for (const r of recibosData) {
      if (!recibosByPago.has(r.pago_id)) recibosByPago.set(r.pago_id, [])
      recibosByPago.get(r.pago_id)!.push(r)
    }

    const pagosConDepositos = await Promise.all(
      pagos.map(async (pago: any) => {
        const detalles = detallesByPago.get(pago.id) || []

        // Cargar ítems de depósito si hay alguno
        const depositoIds = detalles.filter((d) => d.tipo_pago === "deposito").map((d) => d.id)
        let depositoItemsMap = new Map<string, any[]>()
        if (depositoIds.length) {
          const { data: ditems } = await supabase.from("pago_deposito_items").select("*").in("pago_detalle_id", depositoIds)
          for (const it of ditems || []) {
            if (!depositoItemsMap.has(it.pago_detalle_id)) depositoItemsMap.set(it.pago_detalle_id, [])
            depositoItemsMap.get(it.pago_detalle_id)!.push(it)
          }
        }

        const detallesConItems = detalles.map((det: any) => ({
          ...det,
          deposito_items: depositoItemsMap.get(det.id) || [],
        }))

        return {
          ...pago,
          clientes: clientesMap.get(pago.cliente_id) || null,
          pagos_detalle: detallesConItems,
          imputaciones: imputacionesByPago.get(pago.id) || [],
          recibos: recibosByPago.get(pago.id) || [],
          retenciones: [],
        }
      })
    )

    return NextResponse.json(pagosConDepositos)
  } catch (error: any) {
    console.error("[pagos-clientes] GET error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// ─── POST: crear pago completo ────────────────────────────────
export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const admin = createAdminClient()
    const body = await request.json()

    const {
      cliente_id,
      vendedor_id,
      viaje_id,
      fecha_pago,
      observaciones,
      metodos,         // array de métodos de pago (ver tipos abajo)
      imputaciones,    // array de { comprobante_id, monto_imputado }
      retenciones,     // array de { tipo, fecha, numero_comprobante, monto, comprobantes_afectados }
      color,           // BLANCO | NEGRO
    } = body

    if (!cliente_id || !metodos?.length) {
      return NextResponse.json(
        { error: "cliente_id y al menos un método de pago son requeridos" },
        { status: 400 }
      )
    }

    const montoTotal = (metodos as any[]).reduce((sum: number, m: any) => {
      if (m.tipo === "deposito") {
        return sum + (m.items || []).reduce((s: number, it: any) => s + Number(it.monto), 0)
      }
      return sum + Number(m.monto)
    }, 0)

    const montoRetenciones = (retenciones || []).reduce(
      (sum: number, r: any) => sum + Number(r.monto),
      0
    )

    if (montoTotal <= 0) {
      return NextResponse.json({ error: "El monto total debe ser mayor a 0" }, { status: 400 })
    }

    // ── 1. Crear registro principal pagos_clientes ──
    const { data: pago, error: pagoError } = await supabase
      .from("pagos_clientes")
      .insert({
        cliente_id,
        vendedor_id: vendedor_id || null,
        viaje_id: viaje_id || null,
        monto: montoTotal,
        fecha_pago: fecha_pago || todayArgentina(),
        observaciones: observaciones || null,
        estado: "confirmado",
        creado_por: auth.user.id,
      })
      .select()
      .single()

    if (pagoError) throw pagoError

    // ── 2. Crear detalles de métodos de pago ──
    for (const metodo of metodos as any[]) {
      let cheque_id: string | null = null

      // Si es cheque de tercero: crear registro en tabla cheques
      if (metodo.tipo === "cheque") {
        const { data: cheque } = await admin
          .from("cheques")
          .insert({
            tipo: "TERCERO",
            estado: "EN_CARTERA",
            banco: metodo.banco_emisor,
            numero: metodo.numero_cheque,
            fecha_emision: metodo.fecha_emision || null,
            fecha_vencimiento: metodo.fecha_cheque,
            monto: metodo.monto,
            color: color || "BLANCO",
            cliente_origen_id: cliente_id,
          })
          .select("id")
          .single()
        cheque_id = cheque?.id || null
      }

      const { data: detalle, error: detError } = await supabase
        .from("pagos_detalle")
        .insert({
          pago_id: pago.id,
          tipo_pago: metodo.tipo,
          monto: metodo.tipo === "deposito"
            ? (metodo.items || []).reduce((s: number, it: any) => s + Number(it.monto), 0)
            : Number(metodo.monto),
          // efectivo
          caja_id: metodo.caja_id || null,
          // transferencia
          cuenta_bancaria_id: metodo.cuenta_bancaria_id || null,
          fecha_transferencia: metodo.fecha_transferencia || null,
          numero_comprobante_pago: metodo.numero_comprobante || null,
          // cheque
          banco: metodo.banco_emisor || null,
          numero_cheque: metodo.numero_cheque || null,
          fecha_cheque: metodo.fecha_cheque || null,
          localidad: metodo.localidad || null,
          cuit_emisor: metodo.cuit_emisor || null,
          color_cheque: metodo.color_cheque || null,
          cheque_id,
          // depósito
          fecha_deposito: metodo.fecha_deposito || null,
        })
        .select("id")
        .single()

      if (detError) throw detError

      // ── 2b. Si es depósito: crear ítems del depósito ──
      if (metodo.tipo === "deposito" && metodo.items?.length) {
        for (const item of metodo.items as any[]) {
          let itemChequeId: string | null = null

          if (item.tipo_item === "cheque") {
            const { data: chq } = await admin
              .from("cheques")
              .insert({
                tipo: "TERCERO",
                estado: "EN_CARTERA",
                banco: item.banco_emisor || null,
                numero: item.numero_cheque || null,
                fecha_vencimiento: item.fecha_pago_cheque || null,
                monto: item.monto,
                color: color || "BLANCO",
                cliente_origen_id: cliente_id,
              })
              .select("id")
              .single()
            itemChequeId = chq?.id || null
          }

          await supabase.from("pago_deposito_items").insert({
            pago_detalle_id: detalle.id,
            tipo_item: item.tipo_item,
            monto: item.monto,
            numero_cheque: item.numero_cheque || null,
            banco_emisor: item.banco_emisor || null,
            fecha_pago_cheque: item.fecha_pago_cheque || null,
            numero_comprobante_deposito: item.numero_comprobante_deposito || null,
            cheque_id: itemChequeId,
            fecha_deposito_efectivo: item.fecha_deposito_efectivo || null,
            nro_comprobante_deposito_ef: item.nro_comprobante_deposito_ef || null,
          })
        }
      }
    }

    // ── 3. Crear retenciones ──
    if (retenciones?.length) {
      const retencionesData = (retenciones as any[]).map((r) => ({
        pago_id: pago.id,
        tipo: r.tipo,
        fecha: r.fecha,
        numero_comprobante: r.numero_comprobante || null,
        monto: r.monto,
        comprobantes_afectados: r.comprobantes_afectados || null,
        origen: r.origen || "manual",
        archivo_url: r.archivo_url || null,
      }))
      const { error: retErr } = await supabase.from("retenciones").insert(retencionesData)
      if (retErr) console.error("[pagos-clientes] Error guardando retenciones:", retErr)
    }

    // ── 4. Imputar a comprobantes ──
    if (imputaciones?.length) {
      // Si el total imputado supera el pago real, ajustar proporcionalmente (de primero a último)
      const totalImputado = (imputaciones as any[]).reduce((s: number, i: any) => s + Number(i.monto_imputado), 0)
      if (totalImputado > montoTotal) {
        let remaining = montoTotal
        for (const imp of imputaciones as any[]) {
          const apply = Math.min(Number(imp.monto_imputado), remaining)
          imp.monto_imputado = apply
          remaining = Math.max(0, remaining - apply)
        }
      }

      const imputData = (imputaciones as any[]).map((imp) => ({
        pago_id: pago.id,
        comprobante_id: imp.comprobante_id,
        tipo_comprobante: "venta",
        monto_imputado: imp.monto_imputado,
        estado: "confirmado",
      }))
      const { error: impErr } = await supabase.from("imputaciones").insert(imputData)
      if (impErr) throw impErr

      // Actualizar saldo_pendiente de cada comprobante
      for (const imp of imputaciones as any[]) {
        if (!imp.comprobante_id) continue
        const { data: comp } = await supabase
          .from("comprobantes_venta")
          .select("saldo_pendiente")
          .eq("id", imp.comprobante_id)
          .single()
        if (!comp) continue
        const nuevoSaldo = Math.max(0, Number(comp.saldo_pendiente) - Number(imp.monto_imputado))
        await supabase
          .from("comprobantes_venta")
          .update({
            saldo_pendiente: nuevoSaldo,
            estado_pago: nuevoSaldo <= 0 ? "pagado" : "parcial",
          })
          .eq("id", imp.comprobante_id)
      }
    }

    // ── 4b. Libro mayor: el pago confirmado acredita al cliente (haber) ──
    // haber = monto del pago (= pago.monto), consistente con el backfill.
    // NOTA: el crédito por retenciones aún no se postea (pago.monto no las
    // incluye hoy); se resolverá en la cobranza unificada (Fase 2).
    const { error: ccPagoErr } = await supabase.rpc("cc_postear", {
      p_cliente_id:      cliente_id,
      p_tipo_movimiento: "pago",
      p_debe:            0,
      p_haber:           montoTotal,
      p_referencia_tipo: "pago_cliente",
      p_referencia_id:   pago.id,
      p_numero_comprobante: null,
      p_observaciones:   observaciones || "Pago",
      p_usuario_id:      auth.user.id,
    })
    if (ccPagoErr) console.error("[cc_postear] pago", pago.id, ccPagoErr.message)

    // ── 5. Generar número de recibo ──
    const { data: numRow, error: numErr } = await admin
      .from("numeracion_comprobantes")
      .select("ultimo_numero")
      .eq("tipo_comprobante", "RECIBO")
      .eq("punto_venta", "0001")
      .single()

    let numeroRecibo = "REC-0001-00000001"
    if (!numErr && numRow) {
      const siguiente = Number(numRow.ultimo_numero) + 1
      const formatted = String(siguiente).padStart(8, "0")
      numeroRecibo = `REC-0001-${formatted}`
      await admin
        .from("numeracion_comprobantes")
        .update({ ultimo_numero: siguiente })
        .eq("tipo_comprobante", "RECIBO")
        .eq("punto_venta", "0001")
    }

    // ── 6. Crear recibo ──
    const { data: recibo, error: reciboError } = await supabase
      .from("recibos")
      .insert({
        numero_recibo: numeroRecibo,
        pago_id: pago.id,
        cliente_id,
        fecha: fecha_pago || todayArgentina(),
        monto_total: montoTotal,
        generado_por: auth.user.id,
      })
      .select()
      .single()

    if (reciboError) console.error("[pagos-clientes] Error creando recibo:", reciboError)

    // ── 7. Kardex contable: una línea por método ──
    const kardexItems = (metodos as any[]).map((m: any) => ({
      tipo_movimiento: "COBRO_CLIENTE",
      concepto: `Cobro ${numeroRecibo} — ${m.tipo.toUpperCase()}`,
      monto: m.tipo === "deposito"
        ? (m.items || []).reduce((s: number, it: any) => s + Number(it.monto), 0)
        : Number(m.monto),
      color: color || null,
      origen_tipo: "CLIENTE",
      origen_id: cliente_id,
      destino_tipo: m.tipo === "cheque" || m.tipo === "deposito" ? "EN_CARTERA"
        : m.tipo === "efectivo" ? "CAJA"
        : "BANCO",
      destino_id: m.tipo === "efectivo" ? (m.caja_id || null)
        : m.tipo === "transferencia" || m.tipo === "deposito" ? (m.cuenta_bancaria_id || null)
        : null,
      metodo: m.tipo === "cheque" ? "CHEQUE_TERCERO"
        : m.tipo === "transferencia" ? "TRANSFERENCIA"
        : m.tipo === "deposito" ? "DEPOSITO"
        : "EFECTIVO",
      referencia_tipo: "pago_cliente",
      referencia_id: pago.id,
      pago_id: pago.id,
      recibo_id: recibo?.id || null,
      cliente_id,
      cobrador_id: auth.user.id,
    }))

    if (montoRetenciones > 0) {
      kardexItems.push({
        tipo_movimiento: "COBRO_CLIENTE",
        concepto: `Retenciones ${numeroRecibo}`,
        monto: montoRetenciones,
        color: color || null,
        origen_tipo: "CLIENTE",
        origen_id: cliente_id,
        destino_tipo: null,
        destino_id: null,
        metodo: "RETENCION",
        referencia_tipo: "pago_cliente",
        referencia_id: pago.id,
        pago_id: pago.id,
        recibo_id: recibo?.id || null,
        cliente_id,
        cobrador_id: auth.user.id,
      } as any)
    }

    const { error: kardexErr } = await supabase.from("kardex_contable").insert(kardexItems)
    if (kardexErr) console.error("[pagos-clientes] Error en kardex_contable:", kardexErr)

    return NextResponse.json({
      success: true,
      pago,
      recibo: recibo || null,
      numero_recibo: numeroRecibo,
    })
  } catch (error: any) {
    console.error("[pagos-clientes] POST error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
