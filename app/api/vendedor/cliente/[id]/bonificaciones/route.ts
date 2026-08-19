import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"
import { repreciarPedidosAbiertosCliente } from "@/lib/actions/pedidos"
import { SEGMENTOS_BONIF, type SegmentoBonif } from "@/lib/pricing/segmento"

// Bonificaciones del cliente por SEGMENTO y TIPO (tabla bonificaciones):
//  - viajante:   descuento que el viajante concede sobre el neto de cada línea
//                (el motor de precios lo aplica; se descuenta de su comisión).
//  - mercaderia: % del neto del segmento que se entrega en mercadería sin cargo
//                (líneas es_bonificado que arma depósito/ERP sobre ese cupo).
//
// GET → { bonificaciones: { viajante: {limpieza_bazar, perf0, perf_plus},
//                           mercaderia: {…} },
//         // compat: claves planas = viajante
//         limpieza_bazar, perf0, perf_plus }
// PUT { viajante?: {seg: %}, mercaderia?: {seg: %} }
//     o (compat) { limpieza_bazar?, perf0?, perf_plus? } = viajante.
//     0/null desactiva el segmento. Solo se tocan los tipos/segmentos enviados.

const TIPOS = ["viajante", "mercaderia"] as const
type Tipo = (typeof TIPOS)[number]
type PorSeg = Record<SegmentoBonif, number>

const vacio = (): PorSeg => ({ limpieza_bazar: 0, perf0: 0, perf_plus: 0 })

async function clienteDelUsuario(supabase: any, session: any, id: string) {
  const { data } = await supabase
    .from("clientes")
    .select("id")
    .eq("id", id)
    .in("vendedor_id", session.vendedorIds)
    .maybeSingle()
  return data
}

async function leerBonificaciones(supabase: any, clienteId: string): Promise<Record<Tipo, PorSeg>> {
  const { data } = await supabase
    .from("bonificaciones")
    .select("tipo, segmento, porcentaje")
    .eq("cliente_id", clienteId)
    .in("tipo", TIPOS as unknown as string[])
    .eq("activo", true)
  const out: Record<Tipo, PorSeg> = { viajante: vacio(), mercaderia: vacio() }
  const general: Record<Tipo, number> = { viajante: 0, mercaderia: 0 }
  for (const b of data || []) {
    const tipo = b.tipo as Tipo
    if (!TIPOS.includes(tipo)) continue
    if (b.segmento && SEGMENTOS_BONIF.includes(b.segmento)) out[tipo][b.segmento as SegmentoBonif] = Number(b.porcentaje)
    else if (!b.segmento) general[tipo] = Number(b.porcentaje)
  }
  // Una bonificación sin segmento aplica a todos los que no tengan la suya
  for (const tipo of TIPOS) for (const s of SEGMENTOS_BONIF) if (!out[tipo][s] && general[tipo]) out[tipo][s] = general[tipo]
  return out
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireVendedor()
  if (session.error) return session.error
  try {
    const supabase = await createClient()
    const { id } = await params
    if (!(await clienteDelUsuario(supabase, session, id))) {
      return NextResponse.json({ error: "Cliente inexistente o no asignado a vos." }, { status: 404 })
    }
    const b = await leerBonificaciones(supabase, id)
    return NextResponse.json({ bonificaciones: { ...b.viajante, viajante: b.viajante, mercaderia: b.mercaderia } })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireVendedor()
  if (session.error) return session.error
  try {
    const supabase = await createClient()
    const { id } = await params
    if (!(await clienteDelUsuario(supabase, session, id))) {
      return NextResponse.json({ error: "Cliente inexistente o no asignado a vos." }, { status: 404 })
    }
    const body = await request.json()

    // Normalizar entrada: por tipo → por segmento. Compat: claves planas = viajante.
    const cambios: Partial<Record<Tipo, Partial<PorSeg>>> = {}
    for (const tipo of TIPOS) {
      const src = body?.[tipo]
      if (src && typeof src === "object") {
        cambios[tipo] = {}
        for (const seg of SEGMENTOS_BONIF) if (src[seg] !== undefined) cambios[tipo]![seg] = Math.max(0, Math.min(100, Number(src[seg]) || 0))
      }
    }
    if (SEGMENTOS_BONIF.some((seg) => body?.[seg] !== undefined)) {
      cambios.viajante = cambios.viajante || {}
      for (const seg of SEGMENTOS_BONIF) if (body[seg] !== undefined) cambios.viajante[seg] = Math.max(0, Math.min(100, Number(body[seg]) || 0))
    }
    if (!Object.keys(cambios).length) {
      return NextResponse.json({ error: "Nada para actualizar." }, { status: 400 })
    }

    for (const tipo of TIPOS) {
      const porSeg = cambios[tipo]
      if (!porSeg) continue
      for (const seg of SEGMENTOS_BONIF) {
        const pct = porSeg[seg]
        if (pct === undefined) continue

        // Desactivar la vigente del segmento para ese tipo
        await supabase
          .from("bonificaciones")
          .update({ activo: false })
          .eq("cliente_id", id)
          .eq("tipo", tipo)
          .eq("segmento", seg)
          .eq("activo", true)

        if (pct > 0) {
          const { error } = await supabase.from("bonificaciones").insert({
            cliente_id: id,
            tipo,
            segmento: seg,
            porcentaje: pct,
            activo: true,
            observaciones: `Cargada desde app vendedor (${session.user.email || session.user.id})`,
          })
          if (error) throw error
        }
      }
      // Si había una SIN segmento de ese tipo, se apaga: a partir de ahora el
      // cliente se maneja por segmento explícito
      await supabase
        .from("bonificaciones")
        .update({ activo: false })
        .eq("cliente_id", id)
        .eq("tipo", tipo)
        .is("segmento", null)
        .eq("activo", true)
    }

    await supabase
      .from("clientes")
      .update({ actualizado_por: session.user.id, actualizado_at: new Date().toISOString() })
      .eq("id", id)

    // La bonificación viajante entra en el precio de cada línea: los pedidos
    // abiertos del cliente se re-precian (la de mercadería no toca precios)
    const { repreciados } = cambios.viajante ? await repreciarPedidosAbiertosCliente(id) : { repreciados: 0 }

    const b = await leerBonificaciones(supabase, id)
    return NextResponse.json({
      success: true,
      pedidos_repreciados: repreciados,
      bonificaciones: { ...b.viajante, viajante: b.viajante, mercaderia: b.mercaderia },
    })
  } catch (error: any) {
    console.error("[vendedor] PUT bonificaciones:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
