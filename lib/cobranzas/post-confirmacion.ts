import type { SupabaseClient } from "@supabase/supabase-js"
import { nowArgentina } from "@/lib/utils"
import { generarBonificacionContado, debitarComisionPorFinanciero } from "@/lib/comprobantes/generar-bonificacion"
import { parsearMarcaCreditos, quitarMarcaCreditos, ejecutarCreditosDePago } from "@/lib/cobranzas/creditos"
import { parsearMarcaAjuste, quitarMarcaAjuste, ejecutarAjusteDePago } from "@/lib/cobranzas/ajuste"
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

  // ── 0. Créditos existentes tildados en el cobro (marca [CREDITOS:...]) ──
  // Igual que el sistema viejo de Recibos: NC/REV y plata a cuenta elegidas
  // se aplican contra los débitos seleccionados. Regla del 10% (25/08):
  // bonif neta = 10% × (débitos sin dto − créditos mercadería sin dto) —
  // los débitos bonifican completo y cada crédito con aplicar_10 asienta un
  // débito del 10% de lo usado (dentro de ejecutarCreditosDePago).
  const paresCreditos = parsearMarcaCreditos(pago.observaciones)
  if (paresCreditos.length) {
    const avisosCreditos = await ejecutarCreditosDePago(supabase, paresCreditos, pagoId)
    if (avisosCreditos.length) {
      console.error("[post-confirmacion] créditos:", avisosCreditos.join(" · "))
      result.bonificacion_error = [result.bonificacion_error, ...avisosCreditos].filter(Boolean).join(" · ")
    }
    // Retirar la marca (idempotencia: no se re-ejecutan)
    const obsSinMarca = quitarMarcaCreditos(pago.observaciones || "")
    await supabase.from("pagos_clientes").update({ observaciones: obsSinMarca || null }).eq("id", pagoId)
    pago.observaciones = obsSinMarca
  }

  // ── 1. Bonificación 10% contado diferida (MARCA_CONTADO) ──
  // VA PRIMERO: con 10% contado, el último comprobante recién queda saldado
  // cuando la NC/REV le imputa el 10% restante. Si las comisiones se calcularan
  // antes (como hacía el código original), ese comprobante quedaba sin comisión
  // 'cobrada' para siempre.
  try {
    if (pago.observaciones?.includes(MARCA_CONTADO)) {
      // Candidatos: los imputados por el pago Y los débitos cubiertos por
      // créditos (un débito 100% cubierto por crédito también bonifica — el
      // 10% del crédito ya se debitó en el paso 0: neto correcto).
      const compIds = [...new Set([
        ...montoPorComprobante.keys(),
        ...paresCreditos.map((p) => p.debito_id),
      ])]
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

  // ── 1b. Ajuste por redondeo prometido en el cobro (marca [AJUSTE:x]) ──
  // Se asienta recién ahora (cobro confirmado), después de la NC del 10% y
  // antes de las comisiones: salda el comprobante que quedó con los centavos.
  const montoAjuste = parsearMarcaAjuste(pago.observaciones)
  if (montoAjuste > 0.005) {
    const aviso = await ejecutarAjusteDePago(supabase, {
      pagoId,
      clienteId: pago.cliente_id,
      monto: montoAjuste,
      usuarioId: usuarioId || null,
    })
    if (aviso) {
      console.error("[post-confirmacion] ajuste:", aviso)
      result.bonificacion_error = [result.bonificacion_error, aviso].filter(Boolean).join(" · ")
    }
    const obsSinAjuste = quitarMarcaAjuste(pago.observaciones || "")
    await supabase.from("pagos_clientes").update({ observaciones: obsSinAjuste || null }).eq("id", pagoId)
    pago.observaciones = obsSinAjuste
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

  // ── 3. Débito del 10% financiero sobre la comisión ──
  // "Cobró comisión por $100 de venta, pero con la NC la venta real fue $90":
  // −10% de la comisión de los comprobantes que tienen bonificación viva.
  // VA DESPUÉS de generar las comisiones (dentro de la bonificación corría
  // antes de que existieran y no debitaba nada). Idempotente por motivo.
  try {
    if (paidIds.length) {
      const { data: bonifImps } = await supabase
        .from("imputaciones")
        .select("comprobante_id, credito:comprobantes_venta!imputaciones_credito_comprobante_id_fkey(observaciones, anulado_en, estado_pago)")
        .in("comprobante_id", paidIds)
        .not("credito_comprobante_id", "is", null)
        .neq("estado", "anulado")
      const bonificados = [
        ...new Set(
          (bonifImps || [])
            .filter((i: any) => {
              const cr = i.credito
              return cr && !cr.anulado_en && cr.estado_pago !== "anulado" &&
                (cr.observaciones || "").startsWith("Bonificación contado")
            })
            .map((i: any) => i.comprobante_id),
        ),
      ]
      if (bonificados.length) await debitarComisionPorFinanciero(supabase, bonificados)
    }
  } catch (debErr: any) {
    console.error("[post-confirmacion] débito comisión 10%:", debErr?.message)
  }

  return result
}

/**
 * Al saldarse un comprobante: comisiones 'cobrada' por línea, tomadas DEL
 * KARDEX — el % y monto pactados al armar el pedido (definición del negocio
 * 13/08: "vale el % con el que se vendió"; un cambio posterior en la config
 * del vendedor no toca ventas viejas). Antes se recalculaban desde la config
 * actual del vendedor y podían diferir del kardex.
 * Idempotente: no duplica comisiones si se re-procesa el pago.
 * Accesorio al circuito financiero — un fallo acá no debe frenar la cobranza.
 */
async function generarComisionesCobradas(
  supabase: SupabaseClient,
  { comprobanteId, usuarioId }: { comprobanteId: string; usuarioId: string },
) {
  try {
    // Idempotencia: si el comprobante ya tiene comisiones 'cobrada' reales
    // (no débitos por NC financiera), este cobro ya fue procesado.
    const { data: yaCobradas } = await supabase
      .from("comisiones")
      .select("id")
      .eq("comprobante_venta_id", comprobanteId)
      .eq("tipo", "cobrada")
      .gt("monto", 0)
      .limit(1)

    if (!yaCobradas?.length) {
      // Fuente: líneas de kardex del comprobante (una comisión por línea,
      // con el % grabado al vender y el vínculo kardex_id para trazabilidad).
      const { data: lineas } = await supabase
        .from("kardex")
        .select("id, articulo_id, cantidad, precio_unitario_final, comision_viajante_pct, comision_viajante_monto, vendedor_id, pedido_id")
        .eq("comprobante_venta_id", comprobanteId)
        .eq("tipo_movimiento", "venta")
        .not("comision_viajante_monto", "is", null)
        .neq("comision_viajante_monto", 0)

      const conVendedor = (lineas || []).filter((l: any) => l.vendedor_id)
      if (conVendedor.length) {
        // Segmento del artículo (informativo, para filtros de la UI)
        const artIds = [...new Set(conVendedor.map((l: any) => l.articulo_id).filter(Boolean))]
        const segmentoDe = new Map<string, string | null>()
        if (artIds.length) {
          const { data: arts } = await supabase
            .from("articulos")
            .select("id, segmento_precio")
            .in("id", artIds)
          for (const a of arts || []) segmentoDe.set(a.id, a.segmento_precio ?? null)
        }

        const cobradas = conVendedor.map((l: any) => ({
          viajante_id: l.vendedor_id,
          pedido_id: l.pedido_id ?? null,
          comprobante_venta_id: comprobanteId,
          kardex_id: l.id,
          tipo: "cobrada",
          articulo_id: l.articulo_id ?? null,
          segmento: l.articulo_id ? segmentoDe.get(l.articulo_id) ?? null : null,
          cantidad: Number(l.cantidad ?? 0),
          precio_neto_unitario: Number(l.precio_unitario_final ?? 0),
          porcentaje: Number(l.comision_viajante_pct ?? 0),
          monto: Number(l.comision_viajante_monto ?? 0),
          comprobante_cobrado: true,
          fecha_comprobante_cobrado: nowArgentina(),
          pagado: false,
        }))
        await supabase.from("comisiones").insert(cobradas)
      }

      // NOTA: acá NO se toca la billetera del viajante. La billetera es la
      // plata que el viajante/chofer tiene físicamente en la calle: la
      // acreditan SUS endpoints de cobro al crearse el pago y la debita la
      // rendición.
    }

    // Marcar comisiones 'vendida' del pedido como comprobante_cobrado para consulta
    await supabase
      .from("comisiones")
      .update({ comprobante_cobrado: true, fecha_comprobante_cobrado: nowArgentina() })
      .eq("comprobante_venta_id", comprobanteId)
      .eq("tipo", "vendida")
      .eq("comprobante_cobrado", false)

    // KARDEX = fuente de verdad de los hechos del artículo: al saldarse el
    // comprobante se tilda "cobrado" en sus líneas (lo leen el módulo de
    // vendedores y el Playroom). cobranza_anular lo destilda si el pago cae.
    await supabase
      .from("kardex")
      .update({
        comprobante_cobrado: true,
        fecha_comprobante_cobrado: nowArgentina(),
        cobrador_id: usuarioId,
      })
      .eq("comprobante_venta_id", comprobanteId)
      .eq("comprobante_cobrado", false)
  } catch (comErr) {
    console.error("Error creando comisiones cobradas:", comErr)
  }
}
