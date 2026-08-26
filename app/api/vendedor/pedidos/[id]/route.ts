import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"
import { SEGMENTOS_BONIF, normalizarBonifPedido, type SegmentoBonif } from "@/lib/pricing/segmento"

// GET /api/vendedor/pedidos/[id]
// Detalle de un pedido propio: items con artículo, cliente, totales y la
// CABECERA DE DESCUENTOS con datos reales (lo que efectivamente se aplicó a
// cada renglón + de dónde salió cada %: "solo este pedido" o ficha del cliente).
// 404 si el pedido no existe o no pertenece a un vendedor del usuario.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const { id } = await params

    const { data: pedido, error } = await supabase
      .from("pedidos")
      .select(
        `id, numero_pedido, fecha, estado, total, observaciones, metodo_facturacion_pedido, lista_precio_pedido_id, bonif_pedido, bonif_mercaderia_pct, vendedor_id, cliente_id, created_at,
         clientes:cliente_id(id, nombre, localidad, metodo_facturacion, lista_precio_id, lista:lista_precio_id(nombre)),
         pedidos_detalle(id, articulo_id, cantidad, precio_base, precio_final, subtotal, es_bonificado, estado_item,
           precio_lista, descuento_propio_pct, bonif_general_pct, bonif_viajante_pct, metodo_facturacion_item,
           articulos:articulo_id(id, sku, descripcion, unidades_por_bulto, imagen_url, marca_id, proveedor_id))`
      )
      .eq("id", id)
      .is("eliminado_at", null)
      .maybeSingle()

    if (error) throw error
    if (!pedido || !session.vendedorIds.includes((pedido as any).vendedor_id)) {
      return NextResponse.json({ error: "Pedido inexistente o no asignado a vos." }, { status: 404 })
    }
    const clienteId = (pedido as any).cliente_id as string

    // Comprobantes y remitos del pedido (para abrir los PDF desde la app)
    const [{ data: comprobantes }, { data: remitos }, { data: fichaRows }, { data: condMarcaPed }, { data: condProvPed }, { data: condMarcaCli }, { data: condProvCli }] =
      await Promise.all([
        supabase.from("comprobantes_venta").select("id, tipo_comprobante, numero_comprobante, anulado_en, estado_pdf").eq("pedido_id", id).is("anulado_en", null),
        supabase.from("remitos").select("id, tipo_remito, numero_remito, estado_pdf").eq("pedido_id", id).eq("estado", "activo"),
        supabase.from("bonificaciones").select("tipo, segmento, porcentaje").eq("cliente_id", clienteId).eq("activo", true).in("tipo", ["general", "viajante", "mercaderia"]),
        supabase.from("pedido_marca_condicion").select("marca_id, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct, metodo_facturacion").eq("pedido_id", id),
        supabase.from("pedido_proveedor_condicion").select("proveedor_id, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct, metodo_facturacion").eq("pedido_id", id),
        supabase.from("cliente_marca_condicion").select("marca_id, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct, metodo_facturacion").eq("cliente_id", clienteId),
        supabase.from("cliente_proveedor_condicion").select("proveedor_id, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct, metodo_facturacion").eq("cliente_id", clienteId),
      ])

    // ── Descuentos por segmento efectivos: override del pedido > ficha (segmento > "todos") ──
    const ficha = fichaRows || []
    const fichaPct = (tipo: string, seg: SegmentoBonif): number | null => {
      const esp = ficha.find((b: any) => b.tipo === tipo && b.segmento === seg)
      if (esp) return Number(esp.porcentaje) || 0
      const todos = ficha.find((b: any) => b.tipo === tipo && (b.segmento === null || b.segmento === ""))
      return todos ? Number(todos.porcentaje) || 0 : null
    }
    const ovr = normalizarBonifPedido((pedido as any).bonif_pedido)
    const segmentos = SEGMENTOS_BONIF.map((seg) => {
      const fila: Record<string, any> = { segmento: seg }
      for (const tipo of ["general", "viajante", "mercaderia"] as const) {
        const o = tipo !== "general" ? ovr?.[tipo]?.[seg] : undefined
        const f = fichaPct(tipo, seg)
        fila[tipo] = {
          pct: typeof o === "number" ? o : f ?? 0,
          origen: typeof o === "number" ? "pedido" : f != null ? "ficha" : "ninguno",
        }
      }
      return fila
    })

    // ── Condiciones por marca / proveedor (pedido pisa ficha) ──
    const marcaIds = [...new Set([...(condMarcaPed || []), ...(condMarcaCli || [])].map((c: any) => c.marca_id))]
    const provIds = [...new Set([...(condProvPed || []), ...(condProvCli || [])].map((c: any) => c.proveedor_id))]
    const [{ data: marcas }, { data: provs }] = await Promise.all([
      marcaIds.length ? supabase.from("marcas").select("id, descripcion").in("id", marcaIds) : Promise.resolve({ data: [] as any[] }),
      provIds.length ? supabase.from("proveedores").select("id, nombre").in("id", provIds) : Promise.resolve({ data: [] as any[] }),
    ])
    const nombreMarca = new Map((marcas || []).map((m: any) => [m.id, m.descripcion]))
    const nombreProv = new Map((provs || []).map((p: any) => [p.id, p.nombre]))
    const condiciones: any[] = []
    const vistas = new Set<string>()
    for (const [origen, rows, ambito] of [
      ["pedido", condMarcaPed || [], "marca"],
      ["pedido", condProvPed || [], "proveedor"],
      ["ficha", condMarcaCli || [], "marca"],
      ["ficha", condProvCli || [], "proveedor"],
    ] as const) {
      for (const c of rows as any[]) {
        const refId = ambito === "marca" ? c.marca_id : c.proveedor_id
        const k = `${ambito}:${refId}`
        if (vistas.has(k)) continue // el pedido pisa la ficha
        vistas.add(k)
        condiciones.push({
          ambito,
          origen,
          nombre: ambito === "marca" ? nombreMarca.get(refId) || "Marca" : nombreProv.get(refId) || "Proveedor",
          dto_general_pct: Number(c.dto_general_pct || 0),
          dto_viajante_pct: Number(c.dto_viajante_pct || 0),
          dto_mercaderia_pct: Number(c.dto_mercaderia_pct || 0),
          metodo_facturacion: c.metodo_facturacion || null,
        })
      }
    }

    return NextResponse.json({
      pedido,
      comprobantes: comprobantes ?? [],
      remitos: remitos ?? [],
      descuentos: { segmentos, condiciones, solo_este_pedido: !!ovr },
    })
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/pedidos/[id]:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
