import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { todayArgentina, nowArgentina } from "@/lib/utils"
import { confirmarCobranza } from "@/lib/actions/cobranzas"

// POST /api/viajes/[id]/confirmar-rendicion
// Admin confirma la rendición del viaje:
// 1. Confirma todos los pagos pendiente_rendicion (crea imputaciones, actualiza saldos, genera recibos)
// 2. Confirma todas las devoluciones pendientes del viaje (restaura stock, registra en CC)
// 3. Cierra el viaje como 'completado'
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const admin = createAdminClient()
    const { id: viajeId } = await params
    const body = await request.json()

    // caja_destino_efectivo: uuid de la caja donde entra el efectivo neto
    const { caja_destino_efectivo } = body

    // Verificar que el viaje está en_rendicion
    const { data: viaje } = await supabase
      .from("viajes")
      .select("id, estado, nombre, chofer_id")
      .eq("id", viajeId)
      .single()

    if (!viaje) return NextResponse.json({ error: "Viaje no encontrado" }, { status: 404 })
    if (viaje.estado !== "en_rendicion") {
      return NextResponse.json({ error: "El viaje no está pendiente de rendición" }, { status: 400 })
    }

    const resultados = {
      pagos_confirmados: 0,
      devoluciones_confirmadas: 0,
      recibos_generados: [] as string[],
      errores: [] as string[],
    }

    // ─── 1. Confirmar pagos pendiente_rendicion ───────────────
    const { data: pagos } = await supabase
      .from("pagos_clientes")
      .select("id, cliente_id, monto, fecha_pago")
      .eq("viaje_id", viajeId)
      .eq("estado", "pendiente_rendicion")

    for (const pago of pagos || []) {
      try {
        // Obtener imputaciones pendientes de este pago
        const { data: imputaciones } = await supabase
          .from("imputaciones")
          .select("id, comprobante_id, monto_imputado")
          .eq("pago_id", pago.id)
          .eq("estado", "pendiente")

        // Aplicar imputaciones: actualizar saldo de comprobantes
        for (const imp of imputaciones || []) {
          const { data: comp } = await supabase
            .from("comprobantes_venta")
            .select("saldo_pendiente")
            .eq("id", imp.comprobante_id)
            .single()

          if (comp) {
            const nuevoSaldo = Math.max(0, Number(comp.saldo_pendiente) - Number(imp.monto_imputado))
            await supabase
              .from("comprobantes_venta")
              .update({
                saldo_pendiente: nuevoSaldo,
                estado_pago: nuevoSaldo <= 0 ? "pagado" : "parcial",
              })
              .eq("id", imp.comprobante_id)
          }

          await supabase
            .from("imputaciones")
            .update({ estado: "confirmado" })
            .eq("id", imp.id)
        }

        // Confirmación única (recibo + kardex + libro mayor); las imputaciones
        // ya quedaron aplicadas arriba y confirmarCobranza es idempotente.
        const r = await confirmarCobranza(supabase, admin, { pagoId: pago.id, usuarioId: auth.user.id })
        resultados.pagos_confirmados++
        if (r.numero_recibo) resultados.recibos_generados.push(r.numero_recibo)
      } catch (err: any) {
        resultados.errores.push(`Pago ${pago.id}: ${err.message}`)
      }
    }

    // ─── 2. Confirmar devoluciones pendientes del viaje ───────
    const { data: devoluciones } = await supabase
      .from("devoluciones")
      .select(`
        id, cliente_id, monto_total,
        devoluciones_detalle(id, articulo_id, cantidad, precio_venta_original, es_vendible, motivo)
      `)
      .eq("viaje_id", viajeId)
      .eq("estado", "pendiente")

    for (const dev of devoluciones || []) {
      try {
        // Confirmar devolución
        await supabase
          .from("devoluciones")
          .update({
            estado: "confirmado",
            confirmado_por: auth.user.id,
            fecha_confirmacion: nowArgentina(),
          })
          .eq("id", dev.id)

        // Restaurar stock para artículos vendibles
        for (const item of (dev as any).devoluciones_detalle || []) {
          if (item.es_vendible) {
            await supabase.rpc("incrementar_stock", {
              p_articulo_id: item.articulo_id,
              p_cantidad: item.cantidad,
            })
          }
        }

        // NOTA: la confirmación de la devolución NO acredita el libro mayor.
        // El crédito al cliente se postea cuando se genera la NC/Reversa
        // (app/api/comprobantes-venta/generar-nc-reversa), que es el documento
        // fiscal de la devolución. Acá solo se confirma y se restaura stock,
        // para no doble-contar el haber.

        resultados.devoluciones_confirmadas++
      } catch (err: any) {
        resultados.errores.push(`Devolución ${dev.id}: ${err.message}`)
      }
    }

    // ─── 3. Cerrar viaje ──────────────────────────────────────
    await supabase
      .from("viajes")
      .update({ estado: "completado" })
      .eq("id", viajeId)

    return NextResponse.json({
      success: true,
      viaje_id: viajeId,
      ...resultados,
      mensaje: `Rendición confirmada. ${resultados.pagos_confirmados} pagos y ${resultados.devoluciones_confirmadas} devoluciones procesadas.`,
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
    ] = await Promise.all([
      supabase
        .from("viajes")
        .select("id, nombre, fecha, estado, chofer_id, usuarios!viajes_chofer_id_fkey(nombre, email)")
        .eq("id", viajeId)
        .single(),
      supabase
        .from("pagos_clientes")
        .select(`
          id, cliente_id, monto, estado, fecha_pago,
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
    ])

    if (!viaje) return NextResponse.json({ error: "Viaje no encontrado" }, { status: 404 })

    const totalCobrado = (pagos || []).reduce((s, p) => s + Number(p.monto), 0)
    const totalDevoluciones = (devoluciones || []).reduce((s, d) => s + Number(d.monto_total), 0)

    const gastosList = (gastos || []).filter((g) => g.tipo === "debito")
    const totalGastos = gastosList.reduce((s, g) => s + Math.abs(Number(g.monto)), 0)

    const fondosRecibidos = (gastos || [])
      .filter((g) => g.tipo === "credito")
      .reduce((s, g) => s + Number(g.monto), 0)

    // Desglose por método de pago
    const pagosPorMetodo = { efectivo: 0, cheque: 0, transferencia: 0, deposito: 0 }
    for (const p of pagos || []) {
      for (const d of (p as any).pagos_detalle || []) {
        const tipo = d.tipo_pago as keyof typeof pagosPorMetodo
        if (tipo in pagosPorMetodo) {
          pagosPorMetodo[tipo] += Number(d.monto)
        }
      }
    }

    const efectivoNeto = pagosPorMetodo.efectivo + fondosRecibidos - totalGastos

    return NextResponse.json({
      viaje,
      pagos: pagos || [],
      devoluciones: devoluciones || [],
      gastos: gastosList,
      resumen: {
        total_cobrado: totalCobrado,
        total_devoluciones: totalDevoluciones,
        total_gastos: totalGastos,
        fondos_recibidos: fondosRecibidos,
        efectivo_neto: efectivoNeto,
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
