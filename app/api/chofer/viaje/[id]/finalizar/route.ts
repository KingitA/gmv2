import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

// POST /api/chofer/viaje/[id]/finalizar
// El chofer finaliza su viaje: queda 'en_rendicion' Y se DECLARA la rendición
// (rendicion_crear, estado abierta) con los cobros del viaje, para que la
// oficina la vea en "Esperando la plata" de la Caja del Día y la controle
// desde ahí. Body opcional: { efectivo_declarado, observaciones }.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { id: viajeId } = await params
    let body: any = {}
    try { body = await request.json() } catch { /* sin body */ }

    const { data: viaje } = await supabase
      .from("viajes")
      .select("id, chofer_id, estado")
      .eq("id", viajeId)
      .single()

    if (!viaje || viaje.chofer_id !== auth.user.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 })
    }
    if (viaje.estado !== "en_curso") {
      return NextResponse.json({ error: "El viaje no está en curso" }, { status: 400 })
    }

    const { error } = await supabase
      .from("viajes")
      .update({ estado: "en_rendicion" })
      .eq("id", viajeId)

    if (error) throw error

    // Declarar la rendición con los cobros del viaje que siguen sin rendir.
    // Antes solo se cambiaba el estado del viaje y la rendición no existía:
    // la Caja del Día ("Esperando la plata") nunca la mostraba.
    let rendicionId: string | null = null
    const { data: pagosViaje } = await supabase
      .from("pagos_clientes")
      .select("id, pagos_detalle(tipo_pago, monto)")
      .eq("viaje_id", viajeId)
      .eq("estado", "pendiente_rendicion")
    const pagoIds = (pagosViaje || []).map((p: any) => p.id)
    if (pagoIds.length) {
      const efectivoRegistrado = (pagosViaje || []).reduce(
        (s: number, p: any) =>
          s + (p.pagos_detalle || []).filter((d: any) => d.tipo_pago === "efectivo").reduce((x: number, d: any) => x + Number(d.monto), 0),
        0,
      )
      const declarado = body.efectivo_declarado != null ? Number(body.efectivo_declarado) : efectivoRegistrado
      const { data: creada, error: rendErr } = await supabase.rpc("rendicion_crear", {
        p_cobrador_id: viaje.chofer_id,
        p_cobrador_tipo: "chofer",
        p_pago_ids: pagoIds,
        p_efectivo_declarado: declarado,
        p_viaje_id: viajeId,
        p_observaciones: body.observaciones || null,
        p_usuario_id: auth.user.id,
      })
      // "ningún pago elegible" = ya había una rendición abierta con estos
      // pagos (reintento del chofer): no es un error, la rendición ya existe.
      if (rendErr && !rendErr.message?.includes("ningún pago elegible")) {
        console.error("[chofer/finalizar] rendicion_crear:", rendErr.message)
      }
      rendicionId = creada?.rendicion_id ?? null
    }

    return NextResponse.json({
      success: true,
      estado: "en_rendicion",
      rendicion_id: rendicionId,
      pagos_declarados: pagoIds.length,
      mensaje: pagoIds.length
        ? "Viaje enviado a rendición: oficina la ve en la Caja del Día y la confirma al recibir la plata."
        : "Viaje enviado a rendición (sin cobros para rendir).",
    })
  } catch (error: any) {
    console.error("[chofer] Error en POST finalizar:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
