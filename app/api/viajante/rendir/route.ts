import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"
import { codigoPrincipal } from "@/lib/vendedor/codigo-principal"

/**
 * POST /api/viajante/rendir — el viajante DECLARA su rendición (Fase E).
 * Contrato: docs/CONTRATO-API-VIAJANTES.md §8. Crea la rendición 'abierta'
 * (rendicion_crear); la CONFIRMA oficina desde el ERP (segunda firma,
 * rendicion_confirmar) — el viajante nunca se auto-verifica.
 *
 * RENDICIÓN ÚNICA (27/11/2026): un usuario = UNA rendición, aunque tenga varios códigos
 * de vendedor (ej. FREIJE DANIEL y FREIJE DANIEL LISTA NECO). Va TODO lo pendiente (ya no
 * se eligen cobros), con el código principal, y descuenta los retiros de TODOS sus códigos
 * (rendicion_crear v6, p_retiros_de — migración 20261127f). Sin esa migración aplicada,
 * cae a lo de antes: una rendición por código.
 */
export async function POST(request: NextRequest) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const body = await request.json()
    const { pago_ids, efectivo_declarado, observaciones } = body

    // Pagos a rendir: los seleccionados o todos los pendiente_rendicion propios
    let query = supabase
      .from("pagos_clientes")
      .select("id, monto, vendedor_id, estado")
      .eq("estado", "pendiente_rendicion")
      .in("vendedor_id", session.vendedorIds)
    if (Array.isArray(pago_ids) && pago_ids.length) {
      query = query.in("id", pago_ids)
    }
    const { data: pagos, error } = await query
    if (error) throw error
    if (!pagos?.length) {
      return NextResponse.json(
        { error: "No hay pagos pendientes de rendición para declarar" },
        { status: 400 }
      )
    }

    // Agrupar por billetera (vendedor_id)
    const grupos = new Map<string, string[]>()
    for (const p of pagos) {
      grupos.set(p.vendedor_id, [...(grupos.get(p.vendedor_id) ?? []), p.id])
    }

    const rendiciones: any[] = []
    let declaradoRestante = Number(efectivo_declarado) || 0

    // Rendición única: una sola llamada con todos los pagos y los retiros de todos los códigos
    const unica = await supabase.rpc("rendicion_crear", {
      p_cobrador_id: codigoPrincipal(session.vendedorIds),
      p_cobrador_tipo: "viajante",
      p_pago_ids: pagos.map((p) => p.id),
      p_efectivo_declarado: declaradoRestante,
      p_viaje_id: null,
      p_observaciones: observaciones || null,
      p_usuario_id: session.user.id,
      p_retiros_de: session.vendedorIds,
    })
    // PGRST202 / 42883 = la base todavía no tiene la v6 (p_retiros_de): sigue como antes
    const sinV6 = unica.error && (unica.error.code === "PGRST202" || unica.error.code === "42883" || /p_retiros_de|could not find the function/i.test(unica.error.message))
    if (unica.error && !sinV6) return NextResponse.json({ error: unica.error.message }, { status: 400 })
    if (!unica.error) rendiciones.push(unica.data)

    for (const [vendedorId, ids] of sinV6 ? grupos : new Map<string, string[]>()) {
      // Efectivo registrado del grupo (para repartir lo declarado si hay >1 grupo)
      const { data: dets } = await supabase
        .from("pagos_detalle")
        .select("monto")
        .in("pago_id", ids)
        .eq("tipo_pago", "efectivo")
      const registradoGrupo = (dets || []).reduce((s, d) => s + Number(d.monto), 0)
      const declaradoGrupo =
        grupos.size === 1 ? declaradoRestante : Math.min(declaradoRestante, registradoGrupo)
      declaradoRestante -= declaradoGrupo

      const { data, error: rpcErr } = await supabase.rpc("rendicion_crear", {
        p_cobrador_id: vendedorId,
        p_cobrador_tipo: "viajante",
        p_pago_ids: ids,
        p_efectivo_declarado: declaradoGrupo,
        p_viaje_id: null,
        p_observaciones: observaciones || null,
        p_usuario_id: session.user.id,
      })
      if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 400 })
      rendiciones.push(data)
    }

    const principal = rendiciones[0]
    return NextResponse.json(
      {
        success: true,
        rendicion_id: principal.rendicion_id,
        rendicion_ids: rendiciones.map((r) => r.rendicion_id),
        estado: "abierta",
        efectivo_registrado: rendiciones.reduce((s, r) => s + Number(r.efectivo_registrado), 0),
        efectivo_declarado: rendiciones.reduce((s, r) => s + Number(r.efectivo_declarado), 0),
        diferencia: rendiciones.reduce((s, r) => s + Number(r.diferencia), 0),
        cantidad_pagos: rendiciones.reduce((s, r) => s + Number(r.cantidad_pagos), 0),
      },
      { status: 201 }
    )
  } catch (error: any) {
    console.error("[viajante/rendir] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
