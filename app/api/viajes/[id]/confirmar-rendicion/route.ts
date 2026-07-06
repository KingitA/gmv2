import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { nowArgentina } from "@/lib/utils"

/**
 * POST /api/viajes/[id]/confirmar-rendicion
 *
 * Desde Fase C la rendición es transaccional vía RPCs:
 *   rendicion_crear    → cabecera + checklist de pagos (rendiciones/rendicion_items)
 *   rendicion_confirmar→ por cada pago verificado: cobranza_confirmar (firma 2,
 *                        método 'rendicion'), débito de billetera, efectivo
 *                        declarado a la caja elegida (kardex RENDICION_VIAJE),
 *                        transferencias quedan sin verificar → conciliación,
 *                        diferencia declarado/registrado exige forzar=true.
 *
 * Body: {
 *   caja_destino_tipo: "CAJA"|"BANCO", caja_destino_id: uuid,
 *   efectivo_declarado: number,
 *   pagos_verificados?: uuid[],   // omitido = todos los pendiente_rendicion
 *   forzar_diferencia?: boolean,
 *   observaciones?: string
 * }
 */
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
      caja_destino_tipo,
      caja_destino_id,
      efectivo_declarado,
      pagos_verificados,
      forzar_diferencia,
      observaciones,
      // compat con la UI anterior
      caja_destino_efectivo,
    } = body

    const cajaTipo = caja_destino_tipo || "CAJA"
    const cajaId = caja_destino_id || caja_destino_efectivo
    if (!cajaId) {
      return NextResponse.json(
        { error: "Falta la caja destino del efectivo (caja_destino_id)" },
        { status: 400 }
      )
    }

    const { data: viaje } = await supabase
      .from("viajes")
      .select("id, estado, nombre, chofer_id")
      .eq("id", viajeId)
      .single()

    if (!viaje) return NextResponse.json({ error: "Viaje no encontrado" }, { status: 404 })
    if (viaje.estado !== "en_rendicion") {
      return NextResponse.json({ error: "El viaje no está pendiente de rendición" }, { status: 400 })
    }

    // Pagos a rendir: los seleccionados o todos los pendiente_rendicion del viaje
    let pagoIds: string[] = pagos_verificados || []
    if (!pagoIds.length) {
      const { data: pagos } = await supabase
        .from("pagos_clientes")
        .select("id")
        .eq("viaje_id", viajeId)
        .eq("estado", "pendiente_rendicion")
      pagoIds = (pagos || []).map((p) => p.id)
    }
    if (!pagoIds.length) {
      return NextResponse.json({ error: "El viaje no tiene pagos pendientes de rendición" }, { status: 400 })
    }

    // ── 1. Crear la rendición ──
    const { data: creada, error: crearErr } = await supabase.rpc("rendicion_crear", {
      p_cobrador_id: viaje.chofer_id,
      p_cobrador_tipo: "chofer",
      p_pago_ids: pagoIds,
      p_efectivo_declarado: Number(efectivo_declarado) || 0,
      p_viaje_id: viajeId,
      p_observaciones: observaciones || null,
      p_usuario_id: auth.user.id,
    })
    if (crearErr) return NextResponse.json({ error: crearErr.message }, { status: 400 })

    // ── 2. Confirmar (segunda firma en lote) ──
    const { data: confirmada, error: confErr } = await supabase.rpc("rendicion_confirmar", {
      p_rendicion_id: creada.rendicion_id,
      p_caja_destino_tipo: cajaTipo,
      p_caja_destino_id: cajaId,
      p_usuario_id: auth.user.id,
      p_pagos_verificados: null,
      p_efectivo_declarado: Number(efectivo_declarado) || 0,
      p_forzar_diferencia: Boolean(forzar_diferencia),
    })
    if (confErr) {
      // diferencia de efectivo sin forzar → 409 para que la UI pida confirmación
      const esDiferencia = confErr.message?.includes("diferencia de efectivo")
      return NextResponse.json(
        { error: confErr.message, requiere_forzar: esDiferencia, rendicion_id: creada.rendicion_id },
        { status: esDiferencia ? 409 : 400 }
      )
    }

    // ── 3. Confirmar devoluciones pendientes del viaje (stock) ──
    let devolucionesConfirmadas = 0
    const { data: devoluciones } = await supabase
      .from("devoluciones")
      .select("id, devoluciones_detalle(articulo_id, cantidad, es_vendible)")
      .eq("viaje_id", viajeId)
      .eq("estado", "pendiente")

    for (const dev of devoluciones || []) {
      await supabase
        .from("devoluciones")
        .update({ estado: "confirmado", confirmado_por: auth.user.id, fecha_confirmacion: nowArgentina() })
        .eq("id", dev.id)
      for (const item of (dev as any).devoluciones_detalle || []) {
        if (item.es_vendible) {
          await supabase.rpc("incrementar_stock", {
            p_articulo_id: item.articulo_id,
            p_cantidad: item.cantidad,
          })
        }
      }
      // El crédito al cliente lo postea la NC/Reversa (generar-nc-reversa),
      // que además se imputa automáticamente contra la FA de origen (A3).
      devolucionesConfirmadas++
    }

    return NextResponse.json({
      success: true,
      viaje_id: viajeId,
      rendicion_id: creada.rendicion_id,
      pagos_confirmados: confirmada.confirmados,
      pagos_omitidos: confirmada.omitidos,
      transferencias_a_conciliar: confirmada.a_conciliar,
      efectivo_a_caja: confirmada.efectivo_a_caja,
      diferencia: confirmada.diferencia,
      devoluciones_confirmadas: devolucionesConfirmadas,
      mensaje: `Rendición confirmada: ${confirmada.confirmados} pagos (${confirmada.a_conciliar} transferencias a conciliar), efectivo a caja $${Number(confirmada.efectivo_a_caja).toLocaleString("es-AR")}.`,
    })
  } catch (error: any) {
    console.error("[viajes] Error en confirmar-rendicion:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// GET: datos de la rendición (para la página del admin)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { id: viajeId } = await params

    const [
      { data: viaje },
      { data: pagos },
      { data: devoluciones },
      { data: gastos },
      { data: cajas },
    ] = await Promise.all([
      supabase
        .from("viajes")
        .select("id, nombre, fecha, estado, chofer, chofer_id, usuarios:profiles!viajes_chofer_id_fkey(nombre, email)")
        .eq("id", viajeId)
        .single(),
      supabase
        .from("pagos_clientes")
        .select(`
          id, cliente_id, monto, estado, fecha_pago, verificado_por, verificado_at, verificacion_metodo,
          clientes(nombre, razon_social),
          pagos_detalle(tipo_pago, monto),
          imputaciones(comprobante_id, monto_imputado, estado,
            comprobantes_venta(tipo_comprobante, numero_comprobante))
        `)
        .eq("viaje_id", viajeId)
        .in("estado", ["pendiente_rendicion", "confirmado"]),
      supabase
        .from("devoluciones")
        .select(`
          id, numero_devolucion, cliente_id, monto_total, estado,
          clientes(nombre, razon_social),
          devoluciones_detalle(
            articulo_id, cantidad, precio_venta_original, motivo, es_vendible, condicion,
            articulos(sku, descripcion)
          )
        `)
        .eq("viaje_id", viajeId),
      supabase
        .from("billetera_movimientos")
        .select("tipo, medio, monto, concepto, fecha")
        .eq("referencia_tipo", "viaje")
        .eq("referencia_id", viajeId),
      supabase.from("cajas_financieras").select("id, nombre").order("nombre"),
    ])

    if (!viaje) return NextResponse.json({ error: "Viaje no encontrado" }, { status: 404 })

    const totalCobrado = (pagos || []).reduce((s, p) => s + Number(p.monto), 0)
    const totalDevoluciones = (devoluciones || []).reduce((s, d) => s + Number(d.monto_total), 0)

    const gastosList = (gastos || []).filter((g) => g.tipo === "debito")
    const totalGastos = gastosList.reduce((s, g) => s + Math.abs(Number(g.monto)), 0)

    const fondosRecibidos = (gastos || [])
      .filter((g) => g.tipo === "credito")
      .reduce((s, g) => s + Number(g.monto), 0)

    const pagosPorMetodo = { efectivo: 0, cheque: 0, transferencia: 0, deposito: 0 }
    for (const p of pagos || []) {
      for (const d of (p as any).pagos_detalle || []) {
        const tipo = d.tipo_pago as keyof typeof pagosPorMetodo
        if (tipo in pagosPorMetodo) {
          pagosPorMetodo[tipo] += Number(d.monto)
        }
      }
    }

    // Efectivo esperado de los pagos AÚN pendientes de rendir
    const efectivoPendiente = (pagos || [])
      .filter((p) => p.estado === "pendiente_rendicion")
      .reduce(
        (s, p) =>
          s +
          ((p as any).pagos_detalle || [])
            .filter((d: any) => d.tipo_pago === "efectivo")
            .reduce((x: number, d: any) => x + Number(d.monto), 0),
        0
      )

    const efectivoNeto = pagosPorMetodo.efectivo + fondosRecibidos - totalGastos

    return NextResponse.json({
      viaje,
      pagos: pagos || [],
      devoluciones: devoluciones || [],
      gastos: gastosList,
      cajas: cajas || [],
      resumen: {
        total_cobrado: totalCobrado,
        total_devoluciones: totalDevoluciones,
        total_gastos: totalGastos,
        fondos_recibidos: fondosRecibidos,
        efectivo_neto: efectivoNeto,
        efectivo_pendiente_rendir: efectivoPendiente,
        pagos_por_metodo: pagosPorMetodo,
        pagos_pendientes: (pagos || []).filter((p) => p.estado === "pendiente_rendicion").length,
        devoluciones_pendientes: (devoluciones || []).filter((d) => d.estado === "pendiente").length,
      },
    })
  } catch (error: any) {
    console.error("[viajes] Error en GET confirmar-rendicion:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
