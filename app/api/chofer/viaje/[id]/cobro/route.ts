import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { todayArgentina, nowArgentina } from "@/lib/utils"

// POST /api/chofer/viaje/[id]/cobro
// Registra un cobro del chofer con estado='pendiente_rendicion'.
// Crea imputaciones en estado='pendiente' - se confirman al aprobar la rendición.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { id: viajeId } = await params
    const body = await request.json()

    const {
      cliente_id,
      monto_total,
      metodos,          // [{ tipo, monto, ...campos específicos }]
      imputaciones,     // [{ comprobante_id, monto_imputado }]
      devolucion_ids,   // [uuid] devolucion pendiente a acreditar en rendición
      observaciones,
      comprobante_urls, // [{url, nombre}] fotos de comprobantes
      cobros_extra,     // [{ cliente_id, monto, metodos, imputaciones }] otros clientes en la misma cobranza
    } = body

    if (!cliente_id || !monto_total || !metodos?.length) {
      return NextResponse.json(
        { error: "cliente_id, monto_total y metodos son requeridos" },
        { status: 400 }
      )
    }

    // Verificar que el viaje es del chofer y está en_viaje
    const { data: viaje } = await supabase
      .from("viajes")
      .select("id, chofer_id, estado")
      .eq("id", viajeId)
      .single()

    if (!viaje || viaje.chofer_id !== auth.user.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 })
    }
    if (viaje.estado !== "en_curso") {
      return NextResponse.json({ error: "El viaje no está activo" }, { status: 400 })
    }

    // Crear el pago con estado pendiente_rendicion
    const { data: pago, error: pagoError } = await supabase
      .from("pagos_clientes")
      .insert({
        cliente_id,
        vendedor_id: null, // chofer = usuario (profiles), no vendedor; se traza por creado_por/viaje
        viaje_id: viajeId,
        monto: monto_total,
        fecha_pago: todayArgentina(),
        estado: "pendiente_rendicion",
        creado_por: auth.user.id,
        observaciones: observaciones || null,
      })
      .select()
      .single()

    if (pagoError) throw pagoError

    // Fotos de comprobantes (cheque/transferencia) cargadas por el chofer
    if (Array.isArray(comprobante_urls) && comprobante_urls.length) {
      const fotos = comprobante_urls
        .filter((c: any) => c?.url)
        .map((c: any) => ({ pago_id: pago.id, url: c.url, nombre: c.nombre || null }))
      if (fotos.length) {
        const { error: fErr } = await supabase.from("pago_comprobantes").insert(fotos)
        if (fErr) console.error("[chofer/cobro] guardar fotos:", fErr.message)
      }
    }

    // Crear detalles de pago por método
    const chequesInsert: Array<{ chequeData: any; index: number }> = []
    const detallesInsert: any[] = []

    for (const metodo of metodos) {
      const detalle: any = {
        pago_id: pago.id,
        tipo_pago: metodo.tipo,
        monto: metodo.monto,
      }

      if (metodo.tipo === "efectivo") {
        detalle.caja_id = metodo.caja_id || null
      } else if (metodo.tipo === "transferencia") {
        detalle.cuenta_bancaria_id = metodo.cuenta_bancaria_id || null
        detalle.fecha_transferencia = metodo.fecha_transferencia || null
        detalle.numero_comprobante_pago = metodo.numero_comprobante || null
      } else if (metodo.tipo === "cheque") {
        chequesInsert.push({
          chequeData: {
            tipo: "TERCERO",
            estado: "EN_CARTERA",
            banco: metodo.banco_emisor || "",
            numero: metodo.numero_cheque || "",
            fecha_emision: metodo.fecha_emision || null,
            fecha_vencimiento: metodo.fecha_cheque || todayArgentina(),
            monto: metodo.monto,
            color: metodo.color_cheque || "NEGRO",
            cliente_origen_id: cliente_id,
          },
          index: detallesInsert.length,
        })
        detalle.numero_cheque = metodo.numero_cheque || null
        detalle.banco = metodo.banco_emisor || null
        detalle.fecha_cheque = metodo.fecha_cheque || null
        detalle.cuit_emisor = metodo.cuit_emisor || null
        detalle.color_cheque = metodo.color_cheque || "NEGRO"
      }

      detallesInsert.push(detalle)
    }

    for (const { chequeData, index } of chequesInsert) {
      const { data: cheque } = await supabase
        .from("cheques")
        .insert(chequeData)
        .select("id")
        .single()
      if (cheque) detallesInsert[index].cheque_id = cheque.id
    }

    if (detallesInsert.length > 0) {
      await supabase.from("pagos_detalle").insert(detallesInsert)
    }

    // Crear imputaciones en estado='pendiente' (se confirman en rendición)
    if (imputaciones?.length) {
      const imputData = imputaciones.map((imp: any) => ({
        pago_id: pago.id,
        comprobante_id: imp.comprobante_id,
        tipo_comprobante: "venta",
        monto_imputado: imp.monto_imputado,
        estado: "pendiente",
      }))
      await supabase.from("imputaciones").insert(imputData)
    }

    // ── Clientes adicionales en la misma cobranza (cobro conjunto en la calle) ──
    if (Array.isArray(cobros_extra) && cobros_extra.length) {
      for (const ex of cobros_extra) {
        if (!ex?.cliente_id || !ex?.metodos?.length) continue
        const montoEx = ex.metodos.reduce((s: number, m: any) => s + Number(m.monto), 0)
        const { data: pagoEx } = await supabase
          .from("pagos_clientes")
          .insert({
            cliente_id: ex.cliente_id,
            vendedor_id: null,
            viaje_id: viajeId,
            monto: montoEx,
            fecha_pago: todayArgentina(),
            estado: "pendiente_rendicion",
            creado_por: auth.user.id,
            observaciones: observaciones || null,
          })
          .select("id")
          .single()
        if (!pagoEx) continue

        for (const m of ex.metodos) {
          let chequeIdEx: string | null = null
          if (m.tipo === "cheque") {
            const { data: chq } = await supabase.from("cheques").insert({
              tipo: "TERCERO", estado: "EN_CARTERA",
              banco: m.banco_emisor || "", numero: m.numero_cheque || "",
              fecha_emision: m.fecha_emision || null, fecha_vencimiento: m.fecha_cheque || todayArgentina(),
              monto: m.monto, color: m.color_cheque || "NEGRO", cliente_origen_id: ex.cliente_id,
            }).select("id").single()
            chequeIdEx = chq?.id || null
          }
          await supabase.from("pagos_detalle").insert({
            pago_id: pagoEx.id, tipo_pago: m.tipo, monto: m.monto,
            caja_id: m.caja_id || null, cuenta_bancaria_id: m.cuenta_bancaria_id || null,
            fecha_transferencia: m.fecha_transferencia || null, numero_comprobante_pago: m.numero_comprobante || null,
            banco: m.banco_emisor || null, numero_cheque: m.numero_cheque || null, fecha_cheque: m.fecha_cheque || null,
            cuit_emisor: m.cuit_emisor || null, color_cheque: m.color_cheque || null, cheque_id: chequeIdEx,
          })
        }
        if (ex.imputaciones?.length) {
          await supabase.from("imputaciones").insert(
            ex.imputaciones.map((imp: any) => ({
              pago_id: pagoEx.id, comprobante_id: imp.comprobante_id,
              tipo_comprobante: "venta", monto_imputado: imp.monto_imputado, estado: "pendiente",
            }))
          )
        }
      }
    }

    // Registrar en billetera del chofer
    await supabase.from("billetera_movimientos").insert({
      viajante_id: auth.user.id,
      tipo: "cobro_cliente",
      medio:
        metodos[0]?.tipo === "efectivo"
          ? "efectivo"
          : metodos[0]?.tipo === "cheque"
          ? "cheque"
          : "transferencia",
      monto: monto_total,
      concepto: `Cobro cliente`,
      referencia_id: viajeId,
      referencia_tipo: "viaje",
      creado_por: auth.user.id,
      fecha: nowArgentina(),
    })

    return NextResponse.json({
      success: true,
      pago_id: pago.id,
      estado: "pendiente_rendicion",
      mensaje: "Cobro registrado. Se imputará al confirmar la rendición del viaje.",
    })
  } catch (error: any) {
    console.error("[chofer] Error en POST cobro:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
