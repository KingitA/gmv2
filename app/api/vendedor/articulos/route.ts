import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"
import { hybridSearchIds } from "@/lib/search/hybrid"

const SELECT =
  "id, sku, ean13, descripcion, unidades_por_bulto, stock_actual, stock_reservado, descuento_propio, iva_ventas, marca:marca_id(descripcion), proveedor:proveedor_id(nombre)"

function mapArticulo(a: any, extra: Record<string, any> = {}) {
  return {
    id: a.id,
    sku: a.sku,
    ean13: a.ean13,
    descripcion: a.descripcion,
    unidades_por_bulto: a.unidades_por_bulto,
    stock_disponible: Math.max(0, (a.stock_actual || 0) - (a.stock_reservado || 0)),
    descuento_propio: a.descuento_propio || 0,
    iva_ventas: a.iva_ventas,
    marca: a.marca?.descripcion || null,
    proveedor: a.proveedor?.nombre || null,
    ...extra,
  }
}

// GET /api/vendedor/articulos?vista=habituales|ofertas|buscar&cliente=&q=
// - habituales: artículos más pedidos por el cliente (derivado de pedidos_detalle)
// - ofertas: artículos activos con descuento_propio > 0
// - buscar: motor híbrido (trigram + vector) sobre el catálogo completo
export async function GET(request: Request) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const vista = searchParams.get("vista") || "buscar"
    const clienteId = searchParams.get("cliente")
    const q = searchParams.get("q")?.trim() || ""

    if (vista === "habituales") {
      if (!clienteId) return NextResponse.json({ error: "Se requiere cliente." }, { status: 400 })

      const { data: cliente } = await supabase
        .from("clientes")
        .select("id")
        .eq("id", clienteId)
        .in("vendedor_id", session.vendedorIds)
        .maybeSingle()
      if (!cliente) return NextResponse.json({ error: "Cliente no asignado a vos." }, { status: 404 })

      // Últimos 30 pedidos del cliente → frecuencia por artículo
      const { data: pedidos } = await supabase
        .from("pedidos")
        .select("id")
        .eq("cliente_id", clienteId)
        .is("eliminado_at", null)
        .order("fecha", { ascending: false })
        .limit(30)

      const pedidoIds = (pedidos || []).map((p) => p.id)
      if (!pedidoIds.length) return NextResponse.json({ articulos: [] })

      const { data: detalle } = await supabase
        .from("pedidos_detalle")
        .select("articulo_id, cantidad")
        .in("pedido_id", pedidoIds)

      const frecuencia = new Map<string, { veces: number; ultCantidad: number }>()
      for (const d of detalle || []) {
        if (!d.articulo_id) continue
        const f = frecuencia.get(d.articulo_id)
        if (f) f.veces += 1
        else frecuencia.set(d.articulo_id, { veces: 1, ultCantidad: Number(d.cantidad) || 1 })
      }

      const topIds = [...frecuencia.entries()]
        .sort((a, b) => b[1].veces - a[1].veces)
        .slice(0, 60)
        .map(([id]) => id)
      if (!topIds.length) return NextResponse.json({ articulos: [] })

      const { data: articulos } = await supabase
        .from("articulos")
        .select(SELECT)
        .in("id", topIds)
        .eq("activo", true)

      const porId = new Map((articulos || []).map((a: any) => [a.id, a]))
      const resultado = topIds
        .map((id) => porId.get(id))
        .filter(Boolean)
        .map((a: any) =>
          mapArticulo(a, {
            veces_pedido: frecuencia.get(a.id)?.veces || 0,
            cantidad_habitual: frecuencia.get(a.id)?.ultCantidad || 1,
          })
        )
      return NextResponse.json({ articulos: resultado })
    }

    if (vista === "ofertas") {
      const { data: articulos } = await supabase
        .from("articulos")
        .select(SELECT)
        .eq("activo", true)
        .gt("descuento_propio", 0)
        .order("descuento_propio", { ascending: false })
        .limit(100)
      return NextResponse.json({ articulos: (articulos || []).map((a: any) => mapArticulo(a)) })
    }

    // buscar
    if (!q) return NextResponse.json({ articulos: [] })
    const ids = await hybridSearchIds("articulos", q, 50)
    if (!ids.length) return NextResponse.json({ articulos: [] })

    const { data: articulos } = await supabase
      .from("articulos")
      .select(SELECT)
      .in("id", ids)
      .eq("activo", true)

    const porId = new Map((articulos || []).map((a: any) => [a.id, a]))
    const resultado = ids
      .map((id) => porId.get(id))
      .filter(Boolean)
      .map((a: any) => mapArticulo(a))
    return NextResponse.json({ articulos: resultado })
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/articulos:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
