import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { todayArgentina, nowArgentina } from "@/lib/utils"
import { colorOverride, derivarColorCheque, COLOR_PENDIENTE } from "@/lib/actions/color-cheque"
import { crearCobranza, recortarImputaciones, type DetalleInput } from "@/lib/cobranzas/crear"

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
      pedidos_contado,  // string[] pedidos sin facturar anticipados con 10% contado
      idempotency_key,  // uuid del front: reintentos/doble tap devuelven el MISMO pago
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
    // Fase C: el chofer puede registrar/corregir cobros también durante
    // 'en_rendicion' (hasta que oficina confirme la rendición).
    if (!["en_curso", "en_rendicion"].includes(viaje.estado)) {
      return NextResponse.json({ error: "El viaje no está activo" }, { status: 400 })
    }

    // ── Armar detalles por método ──
    // Color de cheques: derivado de las imputaciones del cobro (>50% a PRES ⇒
    // NEGRO, sino BLANCO); override manual si vino explícito; sin imputaciones
    // ⇒ PENDIENTE (oficina asigna al confirmar la rendición).
    const colorCobro = (await derivarColorCheque(supabase, imputaciones)) || COLOR_PENDIENTE
    const detalles: DetalleInput[] = (metodos as any[]).map((metodo: any) => {
      const colorMetodo = colorOverride(metodo.color_cheque) || colorCobro
      return {
        tipo_pago: metodo.tipo,
        monto: Number(metodo.monto),
        caja_id: metodo.tipo === "efectivo" ? metodo.caja_id || null : null,
        cuenta_bancaria_id: metodo.tipo === "transferencia" ? metodo.cuenta_bancaria_id || null : null,
        fecha_transferencia: metodo.tipo === "transferencia" ? metodo.fecha_transferencia || null : null,
        numero_comprobante_pago: metodo.tipo === "transferencia" ? metodo.numero_comprobante || null : null,
        banco: metodo.tipo === "cheque" ? metodo.banco_emisor || null : null,
        numero_cheque: metodo.tipo === "cheque" ? metodo.numero_cheque || null : null,
        fecha_cheque: metodo.tipo === "cheque" ? metodo.fecha_cheque || null : null,
        cuit_emisor: metodo.tipo === "cheque" ? metodo.cuit_emisor || null : null,
        color_cheque: metodo.tipo === "cheque" ? colorMetodo : null,
        cheque: metodo.tipo === "cheque"
          ? {
              banco: metodo.banco_emisor || "",
              numero: metodo.numero_cheque || "",
              fecha_emision: metodo.fecha_emision || null,
              fecha_vencimiento: metodo.fecha_cheque || todayArgentina(),
              monto: Number(metodo.monto),
              color: colorMetodo,
              es_echeq: metodo.color_cheque === "ECHEQ" || Boolean(metodo.es_echeq),
            }
          : null,
      }
    })

    // ── Alta transaccional del pago (pendiente_rendicion) ──
    // Σ imputaciones se recorta al monto: el excedente queda como saldo del
    // comprobante hasta que lo cubra la NC (devolución/10%) o un pago futuro.
    const impsRecortadas = recortarImputaciones(
      ((imputaciones as any[]) || [])
        .filter((i: any) => i?.comprobante_id)
        .map((i: any) => ({ comprobante_id: i.comprobante_id, monto_imputado: Number(i.monto_imputado) })),
      Number(monto_total),
    )

    const { pago_id, dedup } = await crearCobranza(supabase, {
      idempotency_key: idempotency_key || null,
      cliente_id,
      vendedor_id: null, // chofer = usuario (profiles), no vendedor; se traza por creado_por/viaje
      viaje_id: viajeId,
      cobrador_tipo: "chofer",
      monto: Number(monto_total),
      fecha_pago: todayArgentina(),
      observaciones: observaciones || null,
      estado: "pendiente_rendicion",
      creado_por: auth.user.id,
      detalles,
      imputaciones: impsRecortadas,
    })
    const pago = { id: pago_id }

    if (dedup) {
      return NextResponse.json({
        success: true,
        pago_id,
        estado: "pendiente_rendicion",
        dedup: true,
        mensaje: "Cobro ya registrado (reintento detectado).",
      })
    }

    // Marcar pedidos anticipados con 10% contado (NC automática al facturar)
    if (Array.isArray(pedidos_contado) && pedidos_contado.length) {
      await supabase
        .from("pedidos")
        .update({ pago_contado_10: true, anticipo_pago_id: pago.id })
        .in("id", pedidos_contado)
    }

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

    // ── Clientes adicionales en la misma cobranza (cobro conjunto en la calle) ──
    if (Array.isArray(cobros_extra) && cobros_extra.length) {
      for (let exIdx = 0; exIdx < cobros_extra.length; exIdx++) {
        const ex = cobros_extra[exIdx]
        if (!ex?.cliente_id || !ex?.metodos?.length) continue
        const montoEx = ex.metodos.reduce((s: number, m: any) => s + Number(m.monto), 0)
        const colorEx = (await derivarColorCheque(supabase, ex.imputaciones)) || COLOR_PENDIENTE

        const detallesEx: DetalleInput[] = (ex.metodos as any[]).map((m: any) => {
          const colorMetodoEx = colorOverride(m.color_cheque) || colorEx
          return {
            tipo_pago: m.tipo,
            monto: Number(m.monto),
            caja_id: m.caja_id || null,
            cuenta_bancaria_id: m.cuenta_bancaria_id || null,
            fecha_transferencia: m.fecha_transferencia || null,
            numero_comprobante_pago: m.numero_comprobante || null,
            banco: m.banco_emisor || null,
            numero_cheque: m.numero_cheque || null,
            fecha_cheque: m.fecha_cheque || null,
            cuit_emisor: m.cuit_emisor || null,
            color_cheque: m.tipo === "cheque" ? colorMetodoEx : null,
            cheque: m.tipo === "cheque"
              ? {
                  banco: m.banco_emisor || "",
                  numero: m.numero_cheque || "",
                  fecha_emision: m.fecha_emision || null,
                  fecha_vencimiento: m.fecha_cheque || todayArgentina(),
                  monto: Number(m.monto),
                  color: colorMetodoEx,
                  es_echeq: m.color_cheque === "ECHEQ" || Boolean(m.es_echeq),
                }
              : null,
          }
        })

        try {
          await crearCobranza(supabase, {
            // Clave derivada del submit para el cobro extra N: se pisa el nibble
            // de versión (pos 14) con 'e' — un uuid v4 del front jamás colisiona —
            // y los últimos 2 dígitos con el índice. Reintentos no duplican extras.
            idempotency_key: idempotency_key
              ? idempotency_key.slice(0, 14) + "e" + idempotency_key.slice(15, 34) + String(10 + exIdx)
              : null,
            cliente_id: ex.cliente_id,
            vendedor_id: null,
            viaje_id: viajeId,
            cobrador_tipo: "chofer",
            monto: montoEx,
            fecha_pago: todayArgentina(),
            observaciones: observaciones || null,
            estado: "pendiente_rendicion",
            creado_por: auth.user.id,
            detalles: detallesEx,
            imputaciones: recortarImputaciones(
              ((ex.imputaciones as any[]) || [])
                .filter((i: any) => i?.comprobante_id)
                .map((i: any) => ({ comprobante_id: i.comprobante_id, monto_imputado: Number(i.monto_imputado) })),
              montoEx,
            ),
          })
        } catch (exErr: any) {
          console.error("[chofer/cobro] cobro extra falló:", ex.cliente_id, exErr?.message)
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
