import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireOficina, errorJson, sincronizarParadas } from "@/lib/viajes/servidor"
import { viajeEditable, pedidoAsignableAViaje } from "@/lib/viajes/estados"

// GET /api/viajes/[id]/pedidos
// Pedidos del viaje + CANDIDATOS: pedidos sin viaje, en cualquier estado previo
// a salir, de clientes de las zonas del viaje (por localidad o clientes_zonas).
// ?todas=1 trae candidatos de cualquier zona (pedido fuera de recorrido).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireOficina()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { id } = await params
    const todas = new URL(request.url).searchParams.get("todas") === "1"

    const { data: viaje } = await supabase
      .from("viajes")
      .select("id, estado, tipo, viaje_zonas(zona_id)")
      .eq("id", id)
      .single()
    if (!viaje) return errorJson("Viaje no encontrado", 404)

    const SELECT_PEDIDO = `
      id, numero_pedido, fecha, estado, total, bultos, cliente_id, vendedor_id, condicion_entrega,
      clientes(nombre_razon_social, razon_social, nombre, direccion, localidad_id, localidades(nombre, zona_id)),
      vendedores(nombre)
    `
    const forma = (p: any) => ({
      id: p.id,
      numero: p.numero_pedido,
      fecha: p.fecha,
      estado: p.estado,
      total: Number(p.total) || 0,
      bultos: p.bultos || 0,
      cliente_id: p.cliente_id,
      cliente_nombre: p.clientes?.nombre_razon_social || p.clientes?.razon_social || p.clientes?.nombre || "Sin nombre",
      localidad: p.clientes?.localidades?.nombre || "",
      zona_id: p.clientes?.localidades?.zona_id || null,
      vendedor: p.vendedores?.nombre || "",
      condicion_entrega: p.condicion_entrega,
    })

    const { data: asignados, error: aErr } = await supabase
      .from("pedidos")
      .select(SELECT_PEDIDO)
      .eq("viaje_id", id)
      .neq("estado", "eliminado")
      .order("numero_pedido", { ascending: true })
    if (aErr) throw aErr

    let candidatos: any[] = []
    if (viajeEditable(viaje.estado)) {
      const zonaIds = ((viaje as any).viaje_zonas || []).map((z: any) => z.zona_id)
      let clienteIds: string[] | null = null
      if (!todas) {
        if (!zonaIds.length) clienteIds = []
        else {
          const [{ data: locs }, { data: cz }] = await Promise.all([
            supabase.from("localidades").select("id").in("zona_id", zonaIds),
            supabase.from("clientes_zonas").select("cliente_id").in("zona_id", zonaIds),
          ])
          const locIds = (locs || []).map((l: any) => l.id)
          const { data: cls } = locIds.length
            ? await supabase.from("clientes").select("id").in("localidad_id", locIds)
            : { data: [] as any[] }
          clienteIds = [...new Set([...(cls || []).map((c: any) => c.id), ...(cz || []).map((c: any) => c.cliente_id)])]
        }
      }

      if (clienteIds === null || clienteIds.length) {
        // Una consulta nueva por uso: el builder de supabase es mutable
        const consulta = () =>
          supabase
            .from("pedidos")
            .select(SELECT_PEDIDO)
            .is("viaje_id", null)
            .not("estado", "in", "(en_viaje,entregado,rechazado,eliminado)")
            .or("condicion_entrega.is.null,condicion_entrega.neq.retira_mostrador")
            .order("fecha", { ascending: true })
            .limit(500)
        // En lotes: .in() con cientos de uuids rompe el largo de URL
        if (clienteIds) {
          const lotes: string[][] = []
          for (let i = 0; i < clienteIds.length; i += 150) lotes.push(clienteIds.slice(i, i + 150))
          const res = await Promise.all(lotes.map((l) => consulta().in("cliente_id", l)))
          for (const r of res) {
            if (r.error) throw r.error
            candidatos.push(...(r.data || []))
          }
          candidatos.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
        } else {
          const { data, error } = await consulta()
          if (error) throw error
          candidatos = data || []
        }
      }
    }

    return NextResponse.json({
      editable: viajeEditable(viaje.estado),
      pedidos: (asignados || []).map(forma),
      candidatos: candidatos.map(forma),
    })
  } catch (error: any) {
    console.error("[viajes] Error en GET pedidos:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST /api/viajes/[id]/pedidos — asignar / quitar pedidos en lote.
// Body: { agregar?: string[], quitar?: string[] }
// Solo con el viaje 'programado'. Asignar NO cambia el estado del pedido:
// pasan a en_viaje recién al despachar. Las paradas se alinean solas.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireOficina()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { id } = await params
    const body = await request.json()
    const agregar: string[] = Array.isArray(body.agregar) ? body.agregar.filter(Boolean) : []
    const quitar: string[] = Array.isArray(body.quitar) ? body.quitar.filter(Boolean) : []
    if (!agregar.length && !quitar.length) return errorJson("Nada para agregar ni quitar")

    const { data: viaje } = await supabase.from("viajes").select("id, estado, tipo").eq("id", id).single()
    if (!viaje) return errorJson("Viaje no encontrado", 404)
    if (viaje.tipo !== "reparto") return errorJson("Este viaje no es de reparto")
    if (!viajeEditable(viaje.estado)) return errorJson("El viaje ya fue despachado: no se agregan ni quitan pedidos")

    const rechazados: Array<{ id: string; motivo: string }> = []
    let agregados = 0

    if (agregar.length) {
      const { data: pedidos, error } = await supabase
        .from("pedidos")
        .select("id, numero_pedido, estado, viaje_id")
        .in("id", agregar)
      if (error) throw error

      const ok: string[] = []
      for (const pid of agregar) {
        const p = (pedidos || []).find((x: any) => x.id === pid)
        if (!p) rechazados.push({ id: pid, motivo: "no existe" })
        else if (p.viaje_id && p.viaje_id !== id) rechazados.push({ id: pid, motivo: `el pedido ${p.numero_pedido} ya está en otro viaje` })
        else if (!pedidoAsignableAViaje(p.estado)) rechazados.push({ id: pid, motivo: `el pedido ${p.numero_pedido} está ${p.estado}` })
        else if (p.viaje_id !== id) ok.push(pid)
      }
      if (ok.length) {
        // .is(viaje_id, null): si otro usuario lo subió a otro viaje en el medio, no se pisa
        const { data: hechos, error: uErr } = await supabase
          .from("pedidos")
          .update({ viaje_id: id })
          .in("id", ok)
          .is("viaje_id", null)
          .select("id")
        if (uErr) throw uErr
        agregados = (hechos || []).length
      }
    }

    let quitados = 0
    if (quitar.length) {
      const { data: hechos, error } = await supabase
        .from("pedidos")
        .update({ viaje_id: null })
        .in("id", quitar)
        .eq("viaje_id", id)
        .select("id")
      if (error) throw error
      quitados = (hechos || []).length
    }

    await sincronizarParadas(supabase, id)

    return NextResponse.json({ success: true, agregados, quitados, rechazados })
  } catch (error: any) {
    console.error("[viajes] Error en POST pedidos:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
