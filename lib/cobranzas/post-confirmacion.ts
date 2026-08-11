import type { SupabaseClient } from "@supabase/supabase-js"
import { nowArgentina } from "@/lib/utils"
import { getComisionPorcentaje, calcularComisionMonto } from "@/lib/comisiones/calcular"
import { generarBonificacionContado } from "@/lib/comprobantes/generar-bonificacion"
import { MARCA_CONTADO } from "@/lib/constants"

export interface PostConfirmacionResult {
  bonificacion: { total: number } | null
  bonificacion_error: string | null
}

/**
 * Todo lo que debe pasar DESPUÉS de que `cobranza_confirmar` (RPC atómica)
 * confirmó un pago, sin importar por qué camino se confirmó:
 *   - Revisión de Pagos / Caja del Día → PATCH /api/pagos/[id]/confirmar
 *   - Alta con confirmación en el acto → POST /api/pagos-clientes
 *   - Rendición de chofer → POST /api/viajes/[id]/confirmar-rendicion
 *   - Rendición de viajante → POST /api/finanzas/rendiciones/[id]/confirmar
 *
 * Hace dos cosas, ambas idempotentes:
 *  1. Bonificación 10% contado (primero: la NC/REV salda el último tramo).
 *  2. Comisiones 'cobrada' por los comprobantes que quedaron saldados.
 *  La billetera NO se toca acá: la manejan los endpoints de cobro en la calle
 *  (crédito) y la rendición (débito).
 *  2. Bonificación 10% contado diferida: si el pago viajó con MARCA_CONTADO
 *     en observaciones, emite la NC/REV sobre los comprobantes imputados que
 *     aún no la tienen y retira la marca.
 *
 * Es negocio accesorio: un fallo acá NO debe revertir la confirmación — se
 * reporta en el resultado para que la UI lo muestre.
 */
export async function procesarPostConfirmacion(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  {
    pagoId,
    usuarioId,
  }: {
    pagoId: string
    usuarioId: string
  },
): Promise<PostConfirmacionResult> {
  const result: PostConfirmacionResult = { bonificacion: null, bonificacion_error: null }

  const { data: pago } = await supabase
    .from("pagos_clientes")
    .select("id, cliente_id, estado, observaciones")
    .eq("id", pagoId)
    .single()
  if (!pago || pago.estado !== "confirmado") return result

  const { data: impsConfirmadas } = await supabase
    .from("imputaciones")
    .select("comprobante_id, monto_imputado")
    .eq("pago_id", pagoId)
    .eq("estado", "confirmado")
    .not("comprobante_id", "is", null)
  const montoPorComprobante = new Map<string, number>()
  for (const i of impsConfirmadas || []) {
    montoPorComprobante.set(
      i.comprobante_id,
      (montoPorComprobante.get(i.comprobante_id) ?? 0) + Number(i.monto_imputado),
    )
  }

  // ── 1. Bonificación 10% contado diferida (MARCA_CONTADO) ──
  // VA PRIMERO: con 10% contado, el último comprobante recién queda saldado
  // cuando la NC/REV le imputa el 10% restante. Si las comisiones se calcularan
  // antes (como hacía el código original), ese comprobante quedaba sin comisión
  // 'cobrada' para siempre.
  try {
    if (pago.observaciones?.includes(MARCA_CONTADO)) {
      const compIds = [...montoPorComprobante.keys()]
      let bonificables: string[] = []
      if (compIds.length) {
        const { data: comps } = await supabase
          .from("comprobantes_venta")
          .select("id")
          .in("id", compIds)
          .in("tipo_comprobante", ["FA", "FB", "FC", "PRES"])
          .is("anulado_en", null)
        // generarBonificacionContado tiene su propio guard de idempotencia
        // (filtra los comprobantes que ya tienen NC/REV de bonificación viva),
        // así que acá alcanza con pasarle los candidatos.
        bonificables = (comps || []).map((c: any) => c.id)
      }

      if (bonificables.length) {
        const r = await generarBonificacionContado(admin, {
          cliente_id: pago.cliente_id,
          comprobante_ids: bonificables,
          pago_id: pagoId,
        })
        if (r.total_bonificacion > 0) result.bonificacion = { total: r.total_bonificacion }
        if (r.advertencias?.length) result.bonificacion_error = r.advertencias.join(" · ")
      }
      // Retirar la marca (aunque no hubiera nada para bonificar): idempotencia
      await supabase
        .from("pagos_clientes")
        .update({ observaciones: pago.observaciones.replace(MARCA_CONTADO, "").trim() || null })
        .eq("id", pagoId)
    }
  } catch (bonifErr: any) {
    console.error("[post-confirmacion] bonificación 10% diferida falló:", bonifErr?.message)
    result.bonificacion_error = bonifErr?.message || "La bonificación del 10% falló — generala a mano"
  }

  // ── 2. Comisiones 'cobrada' ──
  // Se deriva DESPUÉS de la bonificación: comprobantes imputados por este pago
  // que quedaron saldados (por plata y/o por la NC del 10%).
  let paidIds: string[] = []
  const compIds = [...montoPorComprobante.keys()]
  if (compIds.length) {
    const { data: comps } = await supabase
      .from("comprobantes_venta")
      .select("id, saldo_pendiente")
      .in("id", compIds)
    paidIds = (comps || []).filter((c: any) => Number(c.saldo_pendiente) <= 0.005).map((c: any) => c.id)
  }
  for (const comprobanteId of paidIds) {
    await generarComisionesCobradas(supabase, { comprobanteId, usuarioId })
  }

  return result
}

/**
 * Al saldarse un comprobante: comisiones 'cobrada' por línea (fórmula única),
 * y trazabilidad en kardex de stock.
 * Idempotente: no duplica comisiones si se re-procesa el pago.
 * Accesorio al circuito financiero — un fallo acá no debe frenar la cobranza.
 */
async function generarComisionesCobradas(
  supabase: SupabaseClient,
  { comprobanteId, usuarioId }: { comprobanteId: string; usuarioId: string },
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
      // Idempotencia: si el comprobante ya tiene comisiones 'cobrada' reales
      // (no débitos por NC financiera), este pago ya fue procesado.
      const { data: yaCobradas } = await supabase
        .from("comisiones")
        .select("id")
        .eq("comprobante_venta_id", comprobanteId)
        .eq("tipo", "cobrada")
        .gt("monto", 0)
        .limit(1)
      const yaProcesado = Boolean(yaCobradas?.length)

      if (!yaProcesado) {
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
      }

      // NOTA: acá NO se toca la billetera del viajante. La billetera es la
      // plata que el viajante/chofer tiene físicamente en la calle: la
      // acreditan SUS endpoints de cobro al crearse el pago y la debita la
      // rendición. Acreditarla al confirmar (como hacía el código original)
      // inflaba la billetera del vendedor cuando cobraba la OFICINA — plata
      // que él nunca tuvo.
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
