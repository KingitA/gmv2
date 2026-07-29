import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { todayArgentina } from "@/lib/utils"
import { confirmarCobranza } from "@/lib/actions/cobranzas"
import { colorOverride, derivarColorCheque, COLOR_PENDIENTE } from "@/lib/actions/color-cheque"
import { fetchAllRows, fetchByIds } from "@/lib/supabase/fetch-all"

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
    const pagos = await fetchAllRows(() => {
      let query = supabase
        .from("pagos_clientes")
        .select("*")
        .order("created_at", { ascending: false })

      if (cliente_id) query = query.eq("cliente_id", cliente_id)
      if (estado) query = query.eq("estado", estado)
      if (fecha_desde) query = query.gte("fecha_pago", fecha_desde)
      if (fecha_hasta) query = query.lte("fecha_pago", fecha_hasta)

      return query
    })
    if (pagos.length === 0) return NextResponse.json([])

    const pagoIds = pagos.map((p: any) => p.id)
    const clienteIds = [...new Set(pagos.map((p: any) => p.cliente_id).filter(Boolean))]

    // Cargar clientes, detalles e imputaciones en batch (tandas para todos los pagos)
    const [clientesData, detallesData, imputacionesData] = await Promise.all([
      fetchByIds((chunk) => supabase.from("clientes").select("id, nombre, razon_social, cuit").in("id", chunk), clienteIds),
      fetchByIds((chunk) => supabase.from("pagos_detalle").select("*").in("pago_id", chunk), pagoIds),
      fetchByIds((chunk) => supabase.from("imputaciones").select("*, comprobante:comprobantes_venta(tipo_comprobante, numero_comprobante, total_factura)").in("pago_id", chunk), pagoIds),
    ])

    // Cargar recibos por batch (tabla puede no existir)
    let recibosData: any[] = []
    try {
      recibosData = await fetchByIds((chunk) => supabase.from("recibos").select("id, numero_recibo, pdf_url, fecha, pago_id").in("pago_id", chunk), pagoIds)
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
      confirmar,       // bool — true (default): confirma en el acto (oficina con plata a la vista).
                       // false: queda PENDIENTE de verificación (no toca saldo ni caja).
      pedidos_contado, // string[] — pedidos sin facturar anticipados con 10% contado (se marcan)
      comprobante_urls, // [{url, nombre}] — fotos de comprobantes (cheque/transferencia)
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
        estado: "pendiente",
        creado_por: auth.user.id,
      })
      .select()
      .single()

    if (pagoError) throw pagoError

    // ── 1a. Guardar fotos de comprobantes (cheque/transferencia) ──
    if (Array.isArray(comprobante_urls) && comprobante_urls.length) {
      const fotos = comprobante_urls
        .filter((c: any) => c?.url)
        .map((c: any) => ({ pago_id: pago.id, url: c.url, nombre: c.nombre || null }))
      if (fotos.length) {
        const { error: fErr } = await supabase.from("pago_comprobantes").insert(fotos)
        if (fErr) console.error("[pagos-clientes] guardar fotos:", fErr.message)
      }
    }

    // ── 1b. Marcar pedidos anticipados con 10% contado ──
    // Al facturarse, el flujo de comprobantes generará la NC del 10% y la imputará a este pago.
    if (Array.isArray(pedidos_contado) && pedidos_contado.length) {
      const { error: pedErr } = await supabase
        .from("pedidos")
        .update({ pago_contado_10: true, anticipo_pago_id: pago.id })
        .in("id", pedidos_contado)
      if (pedErr) console.error("[pagos-clientes] marcar pedidos contado:", pedErr.message)
    }

    // ── 2. Crear detalles de métodos de pago ──
    // Color de cheques: override manual del operador > derivado de la
    // imputación (>50% a PRES ⇒ NEGRO, sino BLANCO) > PENDIENTE (a cuenta,
    // la oficina lo asigna al confirmar). "ECHEQ" del OCR/selector no es un
    // color: marca es_echeq y el color sale de la misma regla.
    const colorDerivado = await derivarColorCheque(supabase, imputaciones)

    for (const metodo of metodos as any[]) {
      let cheque_id: string | null = null
      const esEcheq = metodo.color_cheque === "ECHEQ" || Boolean(metodo.es_echeq)
      const colorFinal =
        colorOverride(metodo.color_cheque) || colorOverride(color) || colorDerivado || COLOR_PENDIENTE
      const colorMetodo = metodo.tipo === "cheque" || metodo.tipo === "deposito" ? colorFinal : null

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
            color: colorFinal,
            es_echeq: esEcheq,
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
          color_cheque: colorMetodo,
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
                color: colorFinal,
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

      // Imputaciones en estado 'pendiente': se aplican al saldo recién al
      // confirmar la cobranza (gate de verificación), vía confirmarCobranza.
      const imputData = (imputaciones as any[]).map((imp) => ({
        pago_id: pago.id,
        comprobante_id: imp.comprobante_id,
        tipo_comprobante: "venta",
        monto_imputado: imp.monto_imputado,
        estado: "pendiente",
      }))
      const { error: impErr } = await supabase.from("imputaciones").insert(imputData)
      if (impErr) throw impErr
    }

    // ── 4b. Gate de verificación ──
    // Por defecto (confirmar !== false) se confirma en el acto: confirmarCobranza
    // aplica las imputaciones, postea el haber al libro mayor, genera el recibo y
    // el kardex. Con confirmar:false el pago queda PENDIENTE de verificación y NO
    // impacta saldo real ni caja hasta confirmarlo (revisión de pagos / rendición).
    let numeroReciboFinal: string | null = null
    const estadoFinal = confirmar === false ? "pendiente" : "confirmado"
    if (confirmar !== false) {
      const result = await confirmarCobranza(supabase, admin, {
        pagoId: pago.id,
        usuarioId: auth.user.id,
      })
      numeroReciboFinal = result.numero_recibo
    }

    return NextResponse.json({
      success: true,
      pago,
      estado: estadoFinal,
      numero_recibo: numeroReciboFinal,
    })
  } catch (error: any) {
    console.error("[pagos-clientes] POST error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
