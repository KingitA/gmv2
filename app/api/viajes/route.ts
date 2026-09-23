import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from '@/lib/auth'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireOficina, errorJson, guardarChoferes, guardarZonas, nombrePorDefecto } from '@/lib/viajes/servidor'

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const chofer_id = searchParams.get("chofer_id")

    // Sin chofer_id: calendario de oficina (?desde=&hasta=&tipo=)
    if (!chofer_id) {
      return await listarCalendario(supabase, searchParams)
    }

    const { data: viajes, error } = await supabase
      .from("viajes")
      .select(`
        id,
        nombre,
        fecha,
        estado,
        vehiculo,
        dinero_nafta,
        gastos_peon,
        gastos_hotel,
        gastos_adicionales,
        observaciones,
        created_at
      `)
      .eq("chofer_id", chofer_id)
      .order("fecha", { ascending: false })

    if (error) {
      console.error("[v0] Error al obtener viajes:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const viajesConDatos = await Promise.all(
      viajes.map(async (viaje) => {
        const { count: pedidos_count } = await supabase
          .from("pedidos")
          .select("*", { count: "exact", head: true })
          .eq("viaje_id", viaje.id)

        const { data: pedidos } = await supabase
          .from("pedidos")
          .select("total")
          .eq("viaje_id", viaje.id)

        const total_facturado = pedidos?.reduce(
          (sum, p) => sum + (Number(p.total) || 0),
          0
        ) || 0

        const { data: pedidosConZona } = await supabase
          .from("pedidos")
          .select(`
            clientes!inner(
              localidad_id,
              localidades!inner(
                nombre,
                zona_id,
                zonas!inner(nombre)
              )
            )
          `)
          .eq("viaje_id", viaje.id)

        const zonas = [
          ...new Set(
            pedidosConZona
              ?.map((p: any) => p.clientes?.localidades?.zonas?.nombre)
              .filter(Boolean)
          ),
        ]

        return {
          ...viaje,
          pedidos_count: pedidos_count || 0,
          total_facturado,
          zonas: zonas.join(", "),
        }
      })
    )

    return NextResponse.json({ viajes: viajesConDatos }, { status: 200 })
  } catch (error: any) {
    console.error("[v0] Error en GET /api/viajes:", error)
    return NextResponse.json(
      { error: "Error al obtener viajes" },
      { status: 500 }
    )
  }
}

// Calendario de viajes para oficina: viajes con zonas, choferes, vehículo y
// totales de sus pedidos (cantidad, bultos, importe) en DOS consultas.
async function listarCalendario(supabase: SupabaseClient, searchParams: URLSearchParams) {
  const desde = searchParams.get("desde")
  const hasta = searchParams.get("hasta")
  const tipo = searchParams.get("tipo") || "reparto"

  let q = supabase
    .from("viajes")
    .select(`
      id, nombre, fecha, dias, estado, tipo, tipo_transporte, observaciones,
      chofer_id, vehiculo_id, transporte_id, zona_id,
      dinero_nafta, gastos_peon, gastos_hotel, gastos_adicionales,
      despachado_at,
      vehiculos(nombre, patente),
      transportes(nombre),
      viaje_zonas(zona_id, zonas(nombre)),
      viajes_choferes(usuario_id, rol)
    `)
    .eq("tipo", tipo)
    .neq("estado", "cancelado") // cancelado = fuera del calendario (queda el registro y su historial)
    .order("fecha", { ascending: true })
  if (desde) {
    const d = new Date(desde + "T00:00:00Z")
    d.setUTCDate(d.getUTCDate() - 14)
    q = q.gte("fecha", d.toISOString().slice(0, 10))
  }
  if (hasta) q = q.lte("fecha", hasta)

  const { data: viajesRaw, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Solo los que tocan el rango (fecha + dias − 1 >= desde)
  const viajes = (viajesRaw || []).filter((v: any) => {
    if (!desde) return true
    const fin = new Date(String(v.fecha).slice(0, 10) + "T00:00:00Z")
    fin.setUTCDate(fin.getUTCDate() + Math.max(1, Number(v.dias) || 1) - 1)
    return fin.toISOString().slice(0, 10) >= desde
  })

  const ids = (viajes || []).map((v: any) => v.id)
  const totales = new Map<string, { pedidos: number; bultos: number; total: number; clientes: Set<string> }>()
  const nombres = new Map<string, string>()
  if (ids.length) {
    const usuarioIds = [...new Set((viajes || []).flatMap((v: any) => (v.viajes_choferes || []).map((c: any) => c.usuario_id)))]
    const [{ data: pedidos }, { data: usuarios }] = await Promise.all([
      supabase.from("pedidos").select("viaje_id, cliente_id, bultos, total").in("viaje_id", ids).neq("estado", "eliminado"),
      usuarioIds.length
        ? supabase.from("usuarios").select("id, nombre").in("id", usuarioIds)
        : Promise.resolve({ data: [] as any[] }),
    ])
    for (const p of pedidos || []) {
      const t = totales.get(p.viaje_id) || { pedidos: 0, bultos: 0, total: 0, clientes: new Set<string>() }
      t.pedidos++
      t.bultos += Number(p.bultos) || 0
      t.total += Number(p.total) || 0
      t.clientes.add(p.cliente_id)
      totales.set(p.viaje_id, t)
    }
    for (const u of usuarios || []) nombres.set(u.id, u.nombre)
  }

  return NextResponse.json({
    viajes: (viajes || []).map((v: any) => {
      const t = totales.get(v.id)
      return {
        ...v,
        zonas: (v.viaje_zonas || []).map((z: any) => ({ id: z.zona_id, nombre: z.zonas?.nombre || "" })),
        choferes: (v.viajes_choferes || []).map((c: any) => ({
          usuario_id: c.usuario_id,
          rol: c.rol,
          nombre: nombres.get(c.usuario_id) || "",
        })),
        viaje_zonas: undefined,
        viajes_choferes: undefined,
        pedidos_count: t?.pedidos || 0,
        clientes_count: t?.clientes.size || 0,
        bultos: t?.bultos || 0,
        total: Math.round((t?.total || 0) * 100) / 100,
      }
    }),
  })
}

// POST /api/viajes — programar un viaje de reparto (calendario).
// Solo fecha + zonas son obligatorias: chofer, vehículo, acompañantes y pedidos
// se completan más cerca de la fecha (PATCH /api/viajes/[id] y .../pedidos).
// Body: { fecha, zona_ids[], nombre?, tipo_transporte?, transporte_id?,
//         chofer_id?, acompanante_ids?, vehiculo_id?, porcentaje_flete?,
//         dinero_nafta?, gastos_peon?, gastos_hotel?, gastos_adicionales?, observaciones? }
export async function POST(request: NextRequest) {
  const auth = await requireOficina()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const body = await request.json()
    const zonaIds: string[] = Array.isArray(body.zona_ids) ? body.zona_ids.filter(Boolean) : []

    if (!body.fecha || !/^\d{4}-\d{2}-\d{2}$/.test(body.fecha)) return errorJson("fecha (AAAA-MM-DD) es requerida")
    if (!zonaIds.length) return errorJson("Elegí al menos una zona")

    const { data: zonas } = await supabase.from("zonas").select("id, nombre").in("id", zonaIds)
    if ((zonas || []).length !== new Set(zonaIds).size) return errorJson("Alguna zona no existe")

    const porTransporte = body.tipo_transporte === "transporte"
    const num = (v: any) => Number(v) || 0
    const dias = Math.min(15, Math.max(1, Math.round(Number(body.dias)) || 1))

    const { data: viaje, error } = await supabase
      .from("viajes")
      .insert({
        nombre: (body.nombre || "").trim() || nombrePorDefecto(zonaIds.map((id) => zonas!.find((z) => z.id === id)!.nombre), body.fecha),
        fecha: body.fecha,
        dias,
        tipo: "reparto",
        estado: "programado",
        zona_id: zonaIds[0], // principal (legado: remitos y flete la leen)
        tipo_transporte: porTransporte ? "transporte" : "chofer_propio",
        transporte_id: porTransporte ? body.transporte_id || null : null,
        vehiculo_id: porTransporte ? null : body.vehiculo_id || null,
        porcentaje_flete: num(body.porcentaje_flete),
        dinero_nafta: num(body.dinero_nafta),
        gastos_peon: num(body.gastos_peon),
        gastos_hotel: num(body.gastos_hotel),
        gastos_adicionales: num(body.gastos_adicionales),
        observaciones: body.observaciones || null,
        creado_por: auth.user.id,
      })
      .select("id")
      .single()
    if (error) throw error

    await guardarZonas(supabase, viaje.id, zonaIds)
    if (!porTransporte) {
      await guardarChoferes(supabase, viaje.id, body.chofer_id || null, Array.isArray(body.acompanante_ids) ? body.acompanante_ids : [])
    }

    return NextResponse.json({ success: true, id: viaje.id }, { status: 201 })
  } catch (error: any) {
    console.error("[viajes] Error en POST /api/viajes:", error)
    return NextResponse.json({ error: error.message || "Error al crear el viaje" }, { status: 500 })
  }
}
