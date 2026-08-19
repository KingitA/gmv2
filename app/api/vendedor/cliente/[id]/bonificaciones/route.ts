import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"
import { repreciarPedidosAbiertosCliente } from "@/lib/actions/pedidos"

// Bonificación de VIAJANTE del cliente, por segmento (tabla bonificaciones,
// tipo='viajante'). Es el descuento que el viajante le concede al cliente
// sobre el neto de cada línea; el motor de precios (calcularPrecioPedido) ya
// lo aplica en cada pedido y se descuenta de la comisión del viajante
// (tasa = comisión% − viajante%). Desde acá el vendedor lo ve y lo carga.
//
// GET  → { bonificaciones: { limpieza_bazar: 9.5, perf0: 0, perf_plus: 0 } }
// PUT  { limpieza_bazar?: number, perf0?: number, perf_plus?: number }
//      0 o null desactiva el segmento.

const SEGMENTOS = ["limpieza_bazar", "perf0", "perf_plus"] as const
type Segmento = (typeof SEGMENTOS)[number]

async function clienteDelUsuario(supabase: any, session: any, id: string) {
  const { data } = await supabase
    .from("clientes")
    .select("id")
    .eq("id", id)
    .in("vendedor_id", session.vendedorIds)
    .maybeSingle()
  return data
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
    const { data } = await supabase
      .from("bonificaciones")
      .select("segmento, porcentaje")
      .eq("cliente_id", id)
      .eq("tipo", "viajante")
      .eq("activo", true)
    const out: Record<Segmento, number> = { limpieza_bazar: 0, perf0: 0, perf_plus: 0 }
    let general = 0
    for (const b of data || []) {
      if (b.segmento && SEGMENTOS.includes(b.segmento)) out[b.segmento as Segmento] = Number(b.porcentaje)
      else if (!b.segmento) general = Number(b.porcentaje)
    }
    // Una bonificación sin segmento aplica a todos los que no tengan la suya
    for (const s of SEGMENTOS) if (!out[s] && general) out[s] = general
    return NextResponse.json({ bonificaciones: out })
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

    for (const seg of SEGMENTOS) {
      if (body[seg] === undefined) continue
      const pct = Math.max(0, Math.min(100, Number(body[seg]) || 0))

      // Desactivar las vigentes del segmento (y la "sin segmento" si la hubiera
      // para ese tipo — desde la app se trabaja por segmento)
      await supabase
        .from("bonificaciones")
        .update({ activo: false })
        .eq("cliente_id", id)
        .eq("tipo", "viajante")
        .eq("segmento", seg)
        .eq("activo", true)

      if (pct > 0) {
        const { error } = await supabase.from("bonificaciones").insert({
          cliente_id: id,
          tipo: "viajante",
          segmento: seg,
          porcentaje: pct,
          activo: true,
          observaciones: `Cargada desde app vendedor (${session.user.email || session.user.id})`,
        })
        if (error) throw error
      }
    }

    // Si había una viajante SIN segmento, la apagamos: a partir de ahora el
    // cliente se maneja por segmento explícito desde la app
    await supabase
      .from("bonificaciones")
      .update({ activo: false })
      .eq("cliente_id", id)
      .eq("tipo", "viajante")
      .is("segmento", null)
      .eq("activo", true)

    await supabase
      .from("clientes")
      .update({ actualizado_por: session.user.id, actualizado_at: new Date().toISOString() })
      .eq("id", id)

    // La bonificación viajante entra en el precio de cada línea: los pedidos
    // abiertos del cliente se re-precian con el porcentaje nuevo
    const { repreciados } = await repreciarPedidosAbiertosCliente(id)

    return NextResponse.json({ success: true, pedidos_repreciados: repreciados })
  } catch (error: any) {
    console.error("[vendedor] PUT bonificaciones:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
