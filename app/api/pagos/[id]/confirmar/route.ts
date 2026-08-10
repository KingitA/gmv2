import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { type NextRequest, NextResponse } from "next/server"
import { nowArgentina } from "@/lib/utils"
import { requireAuth } from "@/lib/auth"
import { getComisionPorcentaje, calcularComisionMonto } from "@/lib/comisiones/calcular"
import { confirmarCobranza } from "@/lib/actions/cobranzas"
import { generarBonificacionContado } from "@/lib/comprobantes/generar-bonificacion"
import { MARCA_CONTADO } from "@/lib/constants"

/**
 * Confirmación / rechazo de un pago pendiente (revisión de pagos).
 *
 * Desde Fase A1 la parte financiera (imputaciones → saldos, libro mayor,
 * recibo, kardex, estado del pago) es atómica en el RPC `cobranza_confirmar`.
 * Acá queda solo lo que es negocio accesorio: alta de imputaciones enviadas
 * en el body y generación de comisiones 'cobrada' + billetera del viajante
 * para los comprobantes que quedaron saldados.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const body = await request.json()
    const { id } = await params
    // accion: 'confirmar' | 'rechazar'. color_cheques (BLANCO|NEGRO): asignación
    // de la oficina para cheques que quedaron PENDIENTE (pago a cuenta).
    const { usuario_confirmador, accion, motivo_rechazo, imputaciones, color_cheques } = body

    if (!usuario_confirmador || !accion) {
      return NextResponse.json({ error: "usuario_confirmador y accion son requeridos" }, { status: 400 })
    }

    if (accion === "confirmar") {
      // Imputaciones enviadas desde la UI que aún no existen en DB → crearlas
      // como 'pendiente'; el RPC las aplica todas juntas en una transacción.
      for (const imp of imputaciones || []) {
        if (imp.id || !imp.comprobante_id) continue
        const { error: insErr } = await supabase.from("imputaciones").insert({
          pago_id: id,
          comprobante_id: imp.comprobante_id,
          tipo_comprobante: "venta",
          monto_imputado: imp.monto_imputado,
          estado: "pendiente",
        })
        if (insErr) throw new Error(`imputación ${imp.comprobante_id}: ${insErr.message}`)
      }

      const admin = createAdminClient()
      const result = await confirmarCobranza(supabase, admin, {
        pagoId: id,
        usuarioId: auth.user.id,
        colorCheques: color_cheques,
      })

      // ── Comisiones 'cobrada' + billetera para comprobantes saldados ──
      if (result.paidComprobanteIds.length) {
        const { data: pago } = await supabase
          .from("pagos_clientes")
          .select("id, cliente_id")
          .eq("id", id)
          .single()
        const { data: impsConfirmadas } = await supabase
          .from("imputaciones")
          .select("comprobante_id, monto_imputado")
          .eq("pago_id", id)
          .eq("estado", "confirmado")
        const montoPorComprobante = new Map(
          (impsConfirmadas || []).map((i: any) => [i.comprobante_id, Number(i.monto_imputado)]),
        )
        for (const comprobanteId of result.paidComprobanteIds) {
          await generarComisionesCobradas(supabase, {
            comprobanteId,
            pagoId: id,
            montoImputado: montoPorComprobante.get(comprobanteId) ?? 0,
            usuarioId: auth.user.id,
          })
        }
      }

      // ── 10% pago contado diferido ──
      // Si el pago se registró con el tilde del 10% pero quedó pendiente (traía
      // valores), la intención viajó como MARCA_CONTADO en observaciones.
      // Acá — recién cuando el valor se acredita — se emite la NC/REV sobre los
      // comprobantes imputados que aún no tienen la bonificación hecha, y se
      // retira la marca (idempotente). Centralizado en el endpoint para que
      // NINGÚN camino de confirmación (Caja del Día, Revisión de Pagos,
      // Historial) pueda saltearse el descuento.
      let bonificacion: { total: number } | null = null
      let bonificacion_error: string | null = null
      try {
        const { data: pagoMarca } = await supabase
          .from("pagos_clientes")
          .select("id, cliente_id, observaciones")
          .eq("id", id)
          .single()
        if (pagoMarca?.observaciones?.includes(MARCA_CONTADO)) {
          const { data: imps } = await supabase
            .from("imputaciones")
            .select("comprobante_id")
            .eq("pago_id", id)
            .eq("estado", "confirmado")
            .not("comprobante_id", "is", null)
          const compIds = [...new Set((imps || []).map((i: any) => i.comprobante_id))]

          let bonificables: string[] = []
          if (compIds.length) {
            const [{ data: comps }, { data: ncsBonif }] = await Promise.all([
              supabase
                .from("comprobantes_venta")
                .select("id, numero_comprobante, tipo_comprobante")
                .in("id", compIds)
                .in("tipo_comprobante", ["FA", "FB", "FC", "PRES"])
                .is("anulado_en", null),
              supabase
                .from("comprobantes_venta")
                .select("observaciones")
                .eq("cliente_id", pagoMarca.cliente_id)
                .in("tipo_comprobante", ["REV", "NCA", "NCB", "NCC"])
                .ilike("observaciones", "%Bonificación contado%"),
            ])
            const obsNcs = (ncsBonif || []).map((n: any) => n.observaciones || "")
            bonificables = (comps || [])
              .filter((c: any) => !obsNcs.some((o: string) => o.includes(c.numero_comprobante)))
              .map((c: any) => c.id)
          }

          if (bonificables.length) {
            const r = await generarBonificacionContado(admin, {
              cliente_id: pagoMarca.cliente_id,
              comprobante_ids: bonificables,
              pago_id: id,
            })
            bonificacion = { total: r.total_bonificacion }
          }
          // Retirar la marca (aunque no hubiera nada para bonificar): idempotencia
          await supabase
            .from("pagos_clientes")
            .update({ observaciones: pagoMarca.observaciones.replace(MARCA_CONTADO, "").trim() || null })
            .eq("id", id)
        }
      } catch (bonifErr: any) {
        console.error("[pagos/confirmar] bonificación 10% diferida falló:", bonifErr?.message)
        bonificacion_error = bonifErr?.message || "La bonificación del 10% falló — generala a mano"
      }

      return NextResponse.json({
        success: true,
        numero_recibo: result.numero_recibo,
        bonificacion,
        bonificacion_error,
        mensaje: "Pago confirmado e imputado exitosamente",
      })
    } else if (accion === "rechazar") {
      const { error: updateError } = await supabase
        .from("pagos_clientes")
        .update({
          estado: "rechazado",
          confirmado_por: usuario_confirmador,
          fecha_confirmacion: nowArgentina(),
          motivo_rechazo,
        })
        .eq("id", id)

      if (updateError) throw updateError

      // Eliminar imputaciones pendientes
      await supabase.from("imputaciones").delete().eq("pago_id", id).eq("estado", "pendiente")

      return NextResponse.json({
        success: true,
        mensaje: "Pago rechazado",
      })
    } else {
      return NextResponse.json({ error: 'Acción inválida. Use "confirmar" o "rechazar"' }, { status: 400 })
    }
  } catch (error: any) {
    console.error("[pagos/confirmar] error:", error)
    return NextResponse.json({ error: error.message || "Error procesando pago" }, { status: 500 })
  }
}

/**
 * Al saldarse un comprobante: comisiones 'cobrada' por línea (fórmula única),
 * movimiento en billetera del viajante y trazabilidad en kardex de stock.
 * Accesorio al circuito financiero — un fallo acá no debe frenar la cobranza.
 */
async function generarComisionesCobradas(
  supabase: Awaited<ReturnType<typeof createClient>>,
  {
    comprobanteId,
    pagoId,
    montoImputado,
    usuarioId,
  }: { comprobanteId: string; pagoId: string; montoImputado: number; usuarioId: string },
) {
  try {
    const { data: items } = await supabase
      .from("comprobantes_venta_detalle")
      .select(
        "articulo_id, cantidad, precio_unitario, precio_lista, bonif_viajante_pct, es_bonificado, articulos(segmento_precio, iva_ventas)",
      )
      .eq("comprobante_id", comprobanteId)

    const { data: comp } = await supabase
      .from("comprobantes_venta")
      .select("tipo_comprobante, pedido_id")
      .eq("id", comprobanteId)
      .single()

    let viajanteId: string | null = null
    if (comp?.pedido_id) {
      const { data: pedidoData } = await supabase
        .from("pedidos")
        .select("clientes(vendedor_id)")
        .eq("id", comp.pedido_id)
        .single()
      viajanteId = (pedidoData?.clientes as any)?.vendedor_id ?? null
    }

    if (viajanteId && items?.length) {
      const { data: vendedor } = await supabase
        .from("vendedores")
        .select("comision_limpieza_bazar, comision_perfumeria_0, comision_perfumeria_plus")
        .eq("id", viajanteId)
        .single()

      const metodo = ["PRES", "REV"].includes(comp?.tipo_comprobante ?? "") ? "presupuesto" : "factura"

      // Comisión COBRADA con la fórmula única (= la vendida): base = neto final,
      // tasa = comisión% − viajante%. La mercadería bonificada (es_bonificado) resta
      // (comisión negativa por el valor regalado). El financiero, si aplica, lo debita
      // la NC financiera (generar-bonificacion).
      const cobradas = (items ?? [])
        .filter((item: any) => item.articulos?.segmento_precio && vendedor)
        .map((item: any) => {
          const { segmento_precio, iva_ventas } = item.articulos
          const comisionPct = getComisionPorcentaje(vendedor!, segmento_precio, iva_ventas)
          const viajantePct = Number(item.bonif_viajante_pct ?? 0)
          const esBonif = item.es_bonificado === true
          // Para la línea bonificada el precio cobrado es $0: la base es su P.Lista
          // real (valor regalado) y la comisión se RESTA.
          const baseUnit = esBonif ? Number(item.precio_lista ?? 0) : Number(item.precio_unitario)
          const { monto, tasaEfectivaPct } = calcularComisionMonto({
            precioNetoUnitario: baseUnit,
            cantidad: Number(item.cantidad),
            metodoFacturacion: metodo,
            ivaVentas: iva_ventas,
            comisionPct,
            viajantePct,
          })
          return {
            viajante_id: viajanteId,
            pedido_id: comp?.pedido_id ?? null,
            comprobante_venta_id: comprobanteId,
            tipo: "cobrada",
            articulo_id: item.articulo_id,
            segmento: segmento_precio,
            cantidad: Number(item.cantidad),
            precio_neto_unitario: baseUnit,
            porcentaje: tasaEfectivaPct,
            monto: esBonif ? -monto : monto,
            comprobante_cobrado: true,
            fecha_comprobante_cobrado: nowArgentina(),
            pagado: false,
          }
        })
        .filter((c: any) => c.monto !== 0)

      if (cobradas.length) {
        await supabase.from("comisiones").insert(cobradas)
      }

      // Movimiento en billetera del viajante
      await supabase.from("billetera_movimientos").insert({
        viajante_id: viajanteId,
        tipo: "cobro_cliente",
        monto: montoImputado,
        concepto: `Cobro ${comp?.tipo_comprobante ?? "comprobante"}`,
        referencia_id: pagoId,
        referencia_tipo: "pago_cliente",
        fecha: nowArgentina(),
      })
    }

    // Marcar comisiones 'vendida' del pedido como comprobante_cobrado para consulta
    await supabase
      .from("comisiones")
      .update({ comprobante_cobrado: true, fecha_comprobante_cobrado: nowArgentina() })
      .eq("comprobante_venta_id", comprobanteId)
      .eq("tipo", "vendida")
      .eq("comprobante_cobrado", false)

    // Registrar cobrador_id en kardex para trazabilidad
    await supabase
      .from("kardex")
      .update({ cobrador_id: usuarioId })
      .eq("comprobante_venta_id", comprobanteId)
      .is("cobrador_id", null)
  } catch (comErr) {
    console.error("Error creando comisiones cobradas:", comErr)
  }
}
