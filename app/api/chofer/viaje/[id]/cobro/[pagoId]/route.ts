import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { esTripulante } from "@/lib/viajes/chofer"
import { anularCobranza } from "@/lib/actions/cobranzas"
import { ErrorReglaCobranza, mensajeParaUsuario } from "@/lib/cobranzas/errores"
import { compensarBilleteraLegada } from "@/lib/cobranzas/billetera-chofer"
import { efectoAnulacionEnParada } from "@/lib/cobranzas/reglas-cobro"
import { armarHojaRuta } from "@/lib/viajes/hoja-ruta"

/**
 * DELETE /api/chofer/viaje/[id]/cobro/[pagoId]
 *
 * El chofer anula un cobro propio mientras esté 'pendiente_rendicion' y su
 * rendición no haya sido confirmada (Fase C). La reversa completa (billetera,
 * cheques, imputaciones) la hace el RPC cobranza_anular.
 *
 * R4 (27/10, #23): si la parada es "NO ENTREGAR SIN COBRAR" y se cerró con este
 * cobro, sin él vuelve a "pendiente" (viaje en curso) o se frena la anulación
 * (viaje terminado). Regla en reglas-cobro.ts → efectoAnulacionEnParada.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; pagoId: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const { id: viajeId, pagoId } = await params

    const { data: viaje } = await supabase
      .from("viajes")
      .select("id, chofer_id, estado")
      .eq("id", viajeId)
      .single()
    if (!viaje || !(await esTripulante(supabase, viajeId, auth.user.id, viaje.chofer_id))) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 })
    }

    const { data: pago } = await supabase
      .from("pagos_clientes")
      .select("id, estado, viaje_id, monto, cliente_id")
      .eq("id", pagoId)
      .single()
    if (!pago || pago.viaje_id !== viajeId) {
      return NextResponse.json({ error: "Pago no encontrado en este viaje" }, { status: 404 })
    }
    if (pago.estado !== "pendiente_rendicion") {
      return NextResponse.json(
        { error: `El cobro ya fue ${pago.estado === "confirmado" ? "rendido y confirmado" : pago.estado} — no se puede eliminar` },
        { status: 409 }
      )
    }

    // ¿Está en una rendición confirmada? (abierta se puede: el item quedará sin pago válido)
    const { data: enRendicion } = await supabase
      .from("rendicion_items")
      .select("rendicion_id, rendiciones!inner(estado)")
      .eq("pago_id", pagoId)
      .eq("rendiciones.estado", "confirmada")
      .limit(1)
    if (enRendicion?.length) {
      return NextResponse.json({ error: "El cobro pertenece a una rendición confirmada" }, { status: 409 })
    }

    // R4: ¿la parada bloqueada quedó cerrada por este cobro?
    const enCurso = ["despachado", "en_curso"].includes(viaje.estado)
    const paradaDe = (h: Awaited<ReturnType<typeof armarHojaRuta>>) => h?.paradas.find((p) => p.cliente_id === pago.cliente_id)
    const antes = paradaDe(await armarHojaRuta(supabase, viajeId))
    if (antes) {
      const efecto = efectoAnulacionEnParada({
        estado: antes.estado,
        bloqueada: antes.bloquear_entrega,
        minimoExigido: antes.minimo_exigido,
        cobradoSin: Number(antes.cobrado) - Number(pago.monto),
        descuentos: antes.descuentos_cobro,
        viajeEnCurso: enCurso,
      })
      if (efecto === "frenar") {
        return NextResponse.json(
          { error: "La parada era \"NO ENTREGAR SIN COBRAR\" y se cerró como entregada con este cobro, y el viaje ya terminó: no se puede anular el cobro. Avisá a la oficina.", codigo: "PARADA_BLOQUEADA_ENTREGADA", reintentable: false },
          { status: 422 },
        )
      }
    }

    await anularCobranza(supabase, {
      pagoId,
      usuarioId: auth.user.id,
      motivo: "Corrección del chofer antes de rendir",
    })

    // Cobros asentados antes del 30/09/2026 (billetera referenciada al viaje): cobranza_anular no
    // encuentra el movimiento y la plata quedaba en la billetera. Se compensa acá, una sola vez.
    try {
      await compensarBilleteraLegada(supabase, { titularId: viaje.chofer_id, pagoId, viajeId, monto: Number(pago.monto), usuarioId: auth.user.id })
    } catch (compErr: any) {
      console.error("[chofer/cobro] compensación de billetera:", compErr?.message)
    }

    // R4: sin este cobro la parada bloqueada no cumple → vuelve a pendiente
    let paradaReabierta = false
    if (antes && enCurso) {
      try {
        const despues = paradaDe(await armarHojaRuta(supabase, viajeId))
        if (despues && efectoAnulacionEnParada({
          estado: despues.estado,
          bloqueada: despues.bloquear_entrega,
          minimoExigido: despues.minimo_exigido,
          cobradoSin: despues.cobrado,
          descuentos: despues.descuentos_cobro,
          viajeEnCurso: true,
        }) === "reabrir") {
          const { error: reErr } = await supabase
            .from("viajes_paradas")
            .update({ estado: "pendiente", bultos_entregados: null, motivo_no_cobro: null, motivo_no_entrega: null, resuelto_at: null, resuelto_por: null })
            .eq("id", despues.id)
            .eq("viaje_id", viajeId)
            .in("estado", ["entregado", "solo_cobro"])
          if (reErr) console.error("[chofer/cobro] no se pudo reabrir la parada:", reErr.message)
          else paradaReabierta = true
        }
      } catch (e: any) {
        console.error("[chofer/cobro] reabrir parada:", e?.message)
      }
    }

    return NextResponse.json({ success: true, ...(paradaReabierta ? { parada_reabierta: true, mensaje: "La parada era \"NO ENTREGAR SIN COBRAR\": volvió a pendiente. Cobrá de nuevo o marcá \"no entregado\"." } : {}) })
  } catch (error: any) {
    console.error("[chofer/cobro] DELETE error:", error)
    // Regla de negocio de la RPC: respuesta DEFINITIVA (422), no 500. Si no, la app
    // Chofer reintentaría la anulación para siempre y trabaría lo cargado después.
    if (error instanceof ErrorReglaCobranza) {
      return NextResponse.json({ error: error.message, mensaje: mensajeParaUsuario(error), codigo: error.codigo, reintentable: false }, { status: 422 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
