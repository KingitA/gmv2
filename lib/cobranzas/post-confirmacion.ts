import type { SupabaseClient } from "@supabase/supabase-js"
import { generarBonificacionContado } from "@/lib/comprobantes/generar-bonificacion"
import { liquidarComisiones } from "@/lib/comisiones/liquidar"
import { parsearMarcaCreditos, quitarMarcaCreditos, ejecutarCreditosDePago } from "@/lib/cobranzas/creditos"
import { parsearMarcaAjuste, quitarMarcaAjuste, ejecutarAjusteDePago } from "@/lib/cobranzas/ajuste"
import { MARCA_CONTADO } from "@/lib/constants"
import { filtrarYaBonificados, TIPOS_BONIFICABLES } from "@/lib/comprobantes/ya-bonificados"

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
    // R5: débitos que este cobro va a bonificar (contado y sin NC/REV de bonificación viva)
    let debitosQueBonifican = new Set<string>()
    if (pago.observaciones?.includes(MARCA_CONTADO)) {
      const { data: debs } = await supabase
        .from("comprobantes_venta")
        .select("id, numero_comprobante")
        .in("id", [...new Set(paresCreditos.map((p) => p.debito_id))])
        .in("tipo_comprobante", TIPOS_BONIFICABLES)
        .is("anulado_en", null)
      const pendientes = await filtrarYaBonificados(supabase, pago.cliente_id, (debs || []) as any[])
      debitosQueBonifican = new Set(pendientes.map((d: any) => d.id))
    }
    const avisosCreditos = await ejecutarCreditosDePago(supabase, paresCreditos, pagoId, debitosQueBonifican)
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
          .select("id, total_factura")
          .in("id", compIds)
          .in("tipo_comprobante", ["FA", "FB", "FC", "PRES"])
          .is("anulado_en", null)
        // generarBonificacionContado tiene su propio guard de idempotencia
        // (filtra los comprobantes que ya tienen NC/REV de bonificación viva),
        // así que acá alcanza con pasarle los candidatos.
        bonificables = (comps || []).map((c: any) => c.id)
      }

      if (bonificables.length) {
        // REGLA 07/10 (dueño, reemplaza la del 01/10): la NC es por el 10% del
        // TOTAL de cada comprobante, UNA sola vez, aunque este cobro pague solo
        // una parte. Sin fracción = completa; el guard de generarBonificacionContado
        // (filtrarYaBonificados) bloquea otra NC mientras la primera esté viva.
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
  if (Math.abs(montoAjuste) > 0.005) {
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

  // ── 2. Comisión ganada → cuenta personal del vendedor ──
  // Va DESPUÉS de la bonificación: un comprobante puede quedar saldado por la
  // plata más la NC del 10%. La comisión se calcula sobre la plata (el 10% la
  // reduce) y se postea en la cuenta del empleado (lib/comisiones/liquidar.ts).
  // Con el cliente ADMIN: no depende de los permisos de quien confirma.
  try {
    const liq = await liquidarComisiones(admin, [...montoPorComprobante.keys()], usuarioId)
    if (liq.avisos.length) {
      result.bonificacion_error = [result.bonificacion_error, ...liq.avisos].filter(Boolean).join(" · ")
    }
  } catch (comErr: any) {
    console.error("[post-confirmacion] comisiones:", comErr?.message)
    result.bonificacion_error = [result.bonificacion_error, `Comisiones: ${comErr?.message}`].filter(Boolean).join(" · ")
  }

  // ── Nada falla en silencio: si algo quedó a medias, persistirlo para
  // reintento desde "Pendientes de reproceso" en /caja (la operación entera
  // es idempotente — re-ejecutarla completa lo que faltó). ──
  if (result.bonificacion_error) {
    const { registrarTareaFallida } = await import("@/lib/finanzas/tareas-fallidas")
    await registrarTareaFallida({
      tipo: "post_confirmacion",
      referencia_tipo: "pago_cliente",
      referencia_id: pagoId,
      payload: { pagoId, usuarioId },
      error: result.bonificacion_error,
    })
  }

  return result
}
