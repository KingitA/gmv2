import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { accesoViajeChofer } from "@/lib/viajes/chofer"
import { armarHojaRuta } from "@/lib/viajes/hoja-ruta"
import { moneda } from "@/lib/formato"
import { CODIGO_ANTICIPADO_SIN_COBRO, CODIGO_ENTREGA_BLOQUEADA, TEXTO_ANTICIPADO_SIN_COBRO, TEXTO_ENTREGA_BLOQUEADA } from "@/lib/cobranzas/reglas-cobro"
import { anticipadosSinCobro } from "@/lib/cobranzas/anticipado"

const ESTADOS = ["pendiente", "entregado", "entregado_parcial", "no_entregado", "solo_cobro"]

// PATCH /api/chofer/viaje/[id]/parada — resultado de una parada.
// Body: { parada_id, estado, bultos_entregados?, motivo_no_entrega?, motivo_no_cobro? }
//  - no_entregado / entregado_parcial → motivo_no_entrega obligatorio.
//  - Si oficina marcó "cobrar sí o sí" y lo cobrado no alcanza → motivo_no_cobro
//    obligatorio: deja constancia para el cotejo en oficina.
//  - #23: si además marcó "NO ENTREGAR SIN COBRAR" (bloquear_entrega) y lo cobrado
//    (incluidos los cobros pendientes de rendición, el 10 % contado y el ajuste) no
//    llega a lo exigido, NO se puede marcar entregado ni entregado parcial: 409
//    { codigo: "ENTREGA_BLOQUEADA" }. Solo queda "no entregado".
//  - Cliente/pedido ANTICIPADO sin un cobro registrado (fase 3 de condiciones de pago):
//    409 { codigo: "ANTICIPADO_SIN_COBRO" } — "registrá el cobro antes de entregar".
//  - estado 'pendiente' reabre la parada (corrección) mientras el viaje siga en curso.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { id } = await params
    const body = await request.json()
    const { acceso, error: accErr } = await accesoViajeChofer(supabase, id, auth.user.id)
    if (accErr) return accErr

    if (!["despachado", "en_curso"].includes(acceso.viaje.estado)) {
      return NextResponse.json({ error: "El viaje no está en curso" }, { status: 400 })
    }
    if (!body.parada_id || !ESTADOS.includes(body.estado)) {
      return NextResponse.json({ error: "parada_id y estado son requeridos" }, { status: 400 })
    }

    if (body.estado === "pendiente") {
      const { error } = await supabase
        .from("viajes_paradas")
        .update({
          estado: "pendiente", bultos_entregados: null, motivo_no_entrega: null,
          motivo_no_cobro: null, resuelto_at: null, resuelto_por: null,
        })
        .eq("id", body.parada_id)
        .eq("viaje_id", id)
      if (error) throw error
      return NextResponse.json({ success: true })
    }

    // La parada calculada: bultos, exigencia de cobro y lo ya cobrado
    const hoja = await armarHojaRuta(supabase, id)
    const parada = hoja?.paradas.find((p) => p.id === body.parada_id)
    if (!parada) return NextResponse.json({ error: "Parada no encontrada" }, { status: 404 })

    const motivoEntrega = String(body.motivo_no_entrega || "").trim()
    const motivoCobro = String(body.motivo_no_cobro || "").trim()

    if (["no_entregado", "entregado_parcial"].includes(body.estado) && !motivoEntrega) {
      return NextResponse.json({ error: "Contá por qué no se entregó todo", falta: "motivo_no_entrega" }, { status: 400 })
    }
    // Anticipado (condiciones de pago, fase 3): sin un cobro registrado no se descarga.
    // Alcanza con el cobro cargado en la app (pendiente de rendir); no hace falta el ERP.
    if (["entregado", "entregado_parcial"].includes(body.estado)) {
      const sinCobro = await anticipadosSinCobro(supabase, parada.pedidos.map((p) => p.id), { viajeId: id })
      if (sinCobro.length) {
        return NextResponse.json(
          {
            error: `${TEXTO_ANTICIPADO_SIN_COBRO} (pedido ${sinCobro.map((p) => p.numero).join(", ")})`,
            mensaje: TEXTO_ANTICIPADO_SIN_COBRO,
            codigo: CODIGO_ANTICIPADO_SIN_COBRO,
            pedidos: sinCobro.map((p) => p.numero),
          },
          { status: 409 },
        )
      }
    }
    if (parada.entrega_bloqueada && ["entregado", "entregado_parcial"].includes(body.estado)) {
      return NextResponse.json(
        {
          error: `${TEXTO_ENTREGA_BLOQUEADA}. Oficina pidió cobrar ${moneda(parada.minimo_exigido)} y hay cobrado ${moneda(parada.cobrado + parada.descuentos_cobro)}: solo se puede marcar «no entregado».`,
          codigo: CODIGO_ENTREGA_BLOQUEADA,
          minimo_exigido: parada.minimo_exigido,
          cobrado: parada.cobrado,
        },
        { status: 409 },
      )
    }
    if (body.estado === "solo_cobro" && parada.pedidos.length) {
      return NextResponse.json({ error: "Esta parada tiene mercadería para entregar" }, { status: 400 })
    }
    if (!parada.cobro_cumplido && !motivoCobro) {
      return NextResponse.json(
        {
          error: `Oficina pidió cobrar sí o sí ${moneda(parada.minimo_exigido)} y hay cobrado ${moneda(parada.cobrado + parada.descuentos_cobro)}: contá por qué no se cobró`,
          falta: "motivo_no_cobro",
        },
        { status: 400 },
      )
    }

    let bultos: number | null = null
    if (body.estado === "entregado") bultos = parada.bultos
    else if (body.estado === "entregado_parcial") bultos = Math.max(0, Math.min(parada.bultos, Number(body.bultos_entregados) || 0))
    else if (body.estado === "no_entregado") bultos = 0

    const { error } = await supabase
      .from("viajes_paradas")
      .update({
        estado: body.estado,
        bultos_entregados: bultos,
        motivo_no_entrega: motivoEntrega || null,
        motivo_no_cobro: parada.cobro_cumplido ? null : motivoCobro,
        resuelto_at: new Date().toISOString(),
        resuelto_por: auth.user.id,
      })
      .eq("id", body.parada_id)
      .eq("viaje_id", id)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("[chofer] Error en PATCH parada:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
