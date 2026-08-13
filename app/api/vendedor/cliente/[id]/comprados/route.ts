import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"
import { fetchAllRows } from "@/lib/supabase/fetch-all"

// GET /api/vendedor/cliente/[id]/comprados?q=
// Artículos que el cliente COMPRÓ (facturados en comprobantes_venta), con el
// último precio al que se LE FACTURÓ y el comprobante de origen — es la base
// de la pantalla de devoluciones: se devuelve lo que se vendió, al precio
// facturado, y la NC después se asocia a ese comprobante.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const { id } = await params
    const q = new URL(request.url).searchParams.get("q")?.trim().toLowerCase() || ""

    const { data: cliente } = await supabase
      .from("clientes")
      .select("id")
      .eq("id", id)
      .in("vendedor_id", session.vendedorIds)
      .maybeSingle()
    if (!cliente) {
      return NextResponse.json({ error: "Cliente inexistente o no asignado a vos." }, { status: 404 })
    }

    // Líneas facturadas del cliente (excluye NC/REV: solo lo que se le vendió)
    const rows = await fetchAllRows(() =>
      supabase
        .from("comprobantes_venta_detalle")
        .select(
          "articulo_id, cantidad, precio_unitario, comprobante:comprobante_venta_id!inner(id, cliente_id, fecha, tipo_comprobante, numero_comprobante, anulado_en)"
        )
        .eq("comprobante.cliente_id", id)
        .in("comprobante.tipo_comprobante", ["FA", "FB", "FC", "PRES"])
        .is("comprobante.anulado_en", null)
    )

    // Última factura por artículo + cantidad acumulada
    type Compra = {
      articulo_id: string
      ultimo_precio: number
      ultima_fecha: string
      comprobante_venta_id: string
      numero_comprobante: string
      tipo_comprobante: string
      cantidad_total: number
    }
    const porArticulo = new Map<string, Compra>()
    for (const r of rows as any[]) {
      if (!r.articulo_id) continue
      const fecha = r.comprobante?.fecha || ""
      const actual = porArticulo.get(r.articulo_id)
      if (!actual || fecha > actual.ultima_fecha) {
        porArticulo.set(r.articulo_id, {
          articulo_id: r.articulo_id,
          ultimo_precio: Number(r.precio_unitario || 0),
          ultima_fecha: fecha,
          comprobante_venta_id: r.comprobante?.id,
          numero_comprobante: r.comprobante?.numero_comprobante || "—",
          tipo_comprobante: r.comprobante?.tipo_comprobante || "",
          cantidad_total: (actual?.cantidad_total || 0) + Number(r.cantidad || 0),
        })
      } else {
        actual.cantidad_total += Number(r.cantidad || 0)
      }
    }

    if (!porArticulo.size) return NextResponse.json({ comprados: [] })

    const { data: articulos } = await supabase
      .from("articulos")
      .select("id, sku, ean13, descripcion, imagen_url, unidades_por_bulto")
      .in("id", [...porArticulo.keys()])

    let comprados = (articulos || []).map((a: any) => ({
      ...porArticulo.get(a.id)!,
      sku: a.sku,
      ean13: a.ean13,
      descripcion: a.descripcion,
      imagen_url: a.imagen_url,
      unidades_por_bulto: a.unidades_por_bulto,
    }))

    if (q) {
      comprados = comprados.filter(
        (c) =>
          c.descripcion?.toLowerCase().includes(q) ||
          c.sku?.toLowerCase?.().includes(q) ||
          (Array.isArray(c.ean13) ? c.ean13.some((e: string) => e?.includes(q)) : String(c.ean13 || "").includes(q))
      )
    }

    comprados.sort((a, b) => (b.ultima_fecha || "").localeCompare(a.ultima_fecha || ""))
    return NextResponse.json({ comprados: comprados.slice(0, 100) })
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/cliente/[id]/comprados:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
