import { createClient } from "@/lib/supabase/server"
import { NextResponse, type NextRequest } from "next/server"
import { requireAuth } from "@/lib/auth"
import { insertarKardex } from "@/lib/kardex/insertar-kardex"
import { nowArgentina } from "@/lib/utils"

// GET: Órdenes de compra pendientes de recibir
export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()

    const { data: ordenes, error } = await supabase
      .from("ordenes_compra")
      .select(`
        id,
        numero_orden,
        estado,
        fecha_orden,
        observaciones,
        proveedores(id, nombre),
        ordenes_compra_detalle(
          id,
          cantidad_pedida,
          articulo_id,
          precio_unitario,
          articulos(id, sku, descripcion, ean13, unidades_por_bulto)
        )
      `)
      .in("estado", ["pendiente", "recibida_parcial"])
      .order("fecha_orden", { ascending: true })

    if (error) throw error

    // Enrich with recepcion progress
    const ordenesConProgreso = await Promise.all(
      (ordenes || []).map(async (orden) => {
        const { data: recepcion } = await supabase
          .from("recepciones")
          .select(`
            id, estado, fecha_inicio, numero_tanda,
            recepciones_items(id, articulo_id, cantidad_oc, cantidad_fisica, estado_linea),
            recepciones_documentos(id, tipo_documento, url_imagen, procesado)
          `)
          .eq("orden_compra_id", orden.id)
          .neq("estado", "cancelada")
          .order("numero_tanda", { ascending: false })
          .limit(1)
          .maybeSingle()

        return { ...orden, recepcion: recepcion || null }
      })
    )

    return NextResponse.json(ordenesConProgreso)
  } catch (error: any) {
    console.error("[deposito] Error GET recepciones:", error)
    return NextResponse.json({ error: "Error al obtener órdenes" }, { status: 500 })
  }
}

// POST: Crear o retomar recepción de mercadería
export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { orden_compra_id } = await request.json()

    const { data: { user } } = await supabase.auth.getUser()

    // Buscar la última tanda de recepción de la OC
    const { data: ultima } = await supabase
      .from("recepciones")
      .select(`*, recepciones_items(*), recepciones_documentos(*)`)
      .eq("orden_compra_id", orden_compra_id)
      .not("estado", "eq", "cancelada")
      .order("numero_tanda", { ascending: false })
      .limit(1)
      .maybeSingle()

    // Tanda en curso → retomarla
    if (ultima && ultima.estado !== "finalizada") {
      return NextResponse.json(ultima)
    }

    // Detalle de la OC (cantidades pedidas y precios) + proveedor
    const { data: ocData } = await supabase
      .from("ordenes_compra")
      .select("proveedor_id")
      .eq("id", orden_compra_id)
      .maybeSingle()

    const { data: detalles } = await supabase
      .from("ordenes_compra_detalle")
      .select("articulo_id, cantidad_pedida, precio_unitario")
      .eq("orden_compra_id", orden_compra_id)

    // Cantidades ya recibidas en tandas anteriores (por artículo)
    const recibidas: Record<string, number> = {}
    if (ultima) {
      const { data: previas } = await supabase
        .from("recepciones")
        .select("recepciones_items(articulo_id, cantidad_fisica)")
        .eq("orden_compra_id", orden_compra_id)
        .not("estado", "eq", "cancelada")
      for (const rec of previas || []) {
        for (const it of (rec as any).recepciones_items || []) {
          recibidas[it.articulo_id] = (recibidas[it.articulo_id] || 0) + Number(it.cantidad_fisica || 0)
        }
      }
    }

    // Items de la nueva tanda: lo pendiente de cada artículo
    const itemsNuevos = (detalles || [])
      .map((d: any) => ({
        articulo_id: d.articulo_id,
        pendiente: Number(d.cantidad_pedida || 0) - (recibidas[d.articulo_id] || 0),
        precio_oc: d.precio_unitario || 0,
      }))
      .filter((d) => d.pendiente > 0)

    if (ultima && itemsNuevos.length === 0) {
      // Nada pendiente: devolver la última tanda finalizada
      return NextResponse.json(ultima)
    }

    // Crear recepción (tanda 1 o siguiente)
    const { data: nueva, error } = await supabase
      .from("recepciones")
      .insert({
        orden_compra_id,
        proveedor_id: ocData?.proveedor_id || null,
        estado: "en_proceso",
        usuario_id: user?.id,
        numero_tanda: (ultima?.numero_tanda || 0) + 1,
      })
      .select()
      .single()

    if (error) throw error

    if (itemsNuevos.length > 0) {
      await supabase.from("recepciones_items").insert(
        itemsNuevos.map((d) => ({
          recepcion_id: nueva.id,
          articulo_id: d.articulo_id,
          cantidad_oc: d.pendiente,
          cantidad_fisica: 0,
          estado_linea: "pendiente",
          precio_oc: d.precio_oc,
        }))
      )
    }

    // Update OC estado
    await supabase
      .from("ordenes_compra")
      .update({ estado: "recibida_parcial" })
      .eq("id", orden_compra_id)

    const { data: full } = await supabase
      .from("recepciones")
      .select(`*, recepciones_items(*), recepciones_documentos(*)`)
      .eq("id", nueva.id)
      .single()

    return NextResponse.json(full)
  } catch (error: any) {
    console.error("[deposito] Error POST recepcion:", error)
    return NextResponse.json({ error: "Error al crear recepción" }, { status: 500 })
  }
}

// PATCH: Actualizar item de recepción + ajustar stock
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { recepcion_id, articulo_id, cantidad_fisica, finalizar, conformidad } = await request.json()

    // Control de bultos / conformidad al transporte (paso previo al escaneo)
    if (conformidad) {
      const { transporte_id, bultos_declarados, bultos_recibidos, estado, observaciones } = conformidad
      if (!["conforme", "no_conforme", "omitida"].includes(estado)) {
        return NextResponse.json({ error: "Estado de conformidad inválido" }, { status: 400 })
      }
      if (estado === "no_conforme" && !observaciones?.trim()) {
        return NextResponse.json({ error: "Si los bultos no coinciden, la observación es obligatoria" }, { status: 400 })
      }
      const { data, error } = await supabase
        .from("recepciones")
        .update({
          transporte_id: transporte_id || null,
          bultos_declarados: bultos_declarados ?? null,
          bultos_recibidos: bultos_recibidos ?? null,
          conformidad_transporte: estado,
          conformidad_observaciones: observaciones || null,
          conformidad_at: nowArgentina(),
        })
        .eq("id", recepcion_id)
        .select()
        .single()
      if (error) throw error
      return NextResponse.json(data)
    }

    if (finalizar) {
      // Finalizar recepción: actualizar stock y cerrar
      const { data: items } = await supabase
        .from("recepciones_items")
        .select("articulo_id, cantidad_fisica, precio_documentado, precio_oc")
        .eq("recepcion_id", recepcion_id)

      // Update stock for each item
      for (const item of items || []) {
        if (item.cantidad_fisica > 0) {
          const { data: art } = await supabase
            .from("articulos")
            .select("stock_actual, sku, descripcion, categoria, proveedor_id, iva_compras, iva_ventas, precio_compra")
            .eq("id", item.articulo_id)
            .single()

          const stockAntes = art?.stock_actual || 0
          const nuevoStock = stockAntes + item.cantidad_fisica

          await supabase
            .from("articulos")
            .update({ stock_actual: nuevoStock })
            .eq("id", item.articulo_id)

          // Movimiento de stock (legacy — mantener para compatibilidad)
          await supabase.from("movimientos_stock").insert({
            articulo_id: item.articulo_id,
            tipo_movimiento: "entrada",
            cantidad: item.cantidad_fisica,
            observaciones: `Recepción depósito #${recepcion_id}`,
          })

          // Kardex unificado, valorizado con el mejor precio disponible:
          // factura OCR → precio de la OC → costo del artículo. Si todo es 0,
          // validar el comprobante después lo revaloriza.
          const precio = Number(item.precio_documentado || item.precio_oc || art?.precio_compra || 0)
          const subtotal = Math.round(precio * item.cantidad_fisica * 100) / 100

          await insertarKardex(
            supabase,
            {
              tipo_movimiento: "compra",
              fecha: nowArgentina(),
              articulo_id: item.articulo_id,
              cantidad: item.cantidad_fisica,
              precio_lista: precio,
              precio_unitario_final: precio,
              subtotal_neto: subtotal,
              subtotal_total: subtotal,
              recepcion_id,
              stock_antes: stockAntes,
              stock_despues: nuevoStock,
            },
            {
              sku: art?.sku,
              descripcion: art?.descripcion,
              categoria: art?.categoria,
              proveedor_id: art?.proveedor_id,
              iva_compras: art?.iva_compras,
              iva_ventas: art?.iva_ventas,
            },
          )
        }
      }

      // Cerrar recepción
      await supabase
        .from("recepciones")
        .update({ estado: "finalizada", fecha_fin: nowArgentina() })
        .eq("id", recepcion_id)

      // Update OC: recibida_completa solo si el acumulado de todas las tandas
      // cubre lo pedido; si queda pendiente, sigue recibida_parcial (multi-tanda).
      const { data: rec } = await supabase
        .from("recepciones")
        .select("orden_compra_id")
        .eq("id", recepcion_id)
        .single()

      if (rec?.orden_compra_id) {
        const { data: detallesOC } = await supabase
          .from("ordenes_compra_detalle")
          .select("articulo_id, cantidad_pedida")
          .eq("orden_compra_id", rec.orden_compra_id)

        const { data: todasRec } = await supabase
          .from("recepciones")
          .select("recepciones_items(articulo_id, cantidad_fisica, estado_linea)")
          .eq("orden_compra_id", rec.orden_compra_id)
          .not("estado", "eq", "cancelada")

        const recibidas: Record<string, number> = {}
        let hayFaltantesMarcados = false
        for (const r of todasRec || []) {
          for (const it of (r as any).recepciones_items || []) {
            recibidas[it.articulo_id] = (recibidas[it.articulo_id] || 0) + Number(it.cantidad_fisica || 0)
            if (it.estado_linea === "faltante") hayFaltantesMarcados = true
          }
        }

        const quedaPendiente = (detallesOC || []).some(
          (d: any) => Number(d.cantidad_pedida || 0) - (recibidas[d.articulo_id] || 0) > 0
        )

        // Los faltantes marcados explícitamente se resuelven en verificación
        // (empresa/transporte/proveedor) — no dejan la OC abierta.
        const estadoOC = quedaPendiente && !hayFaltantesMarcados ? "recibida_parcial" : "recibida_completa"

        await supabase
          .from("ordenes_compra")
          .update({ estado: estadoOC })
          .eq("id", rec.orden_compra_id)
      }

      return NextResponse.json({ ok: true })
    }

    // Update single item — cantidad_fisica = -1 means "return to pendiente"
    let estadoLinea: string
    let cantidadReal: number
    if (cantidad_fisica === -1) {
      estadoLinea = "pendiente"
      cantidadReal = 0
    } else if (cantidad_fisica === 0) {
      estadoLinea = "faltante"
      cantidadReal = 0
    } else {
      estadoLinea = "ok"
      cantidadReal = cantidad_fisica
    }
    const { data: item, error } = await supabase
      .from("recepciones_items")
      .update({ cantidad_fisica: cantidadReal, estado_linea: estadoLinea })
      .eq("recepcion_id", recepcion_id)
      .eq("articulo_id", articulo_id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json(item)
  } catch (error: any) {
    console.error("[deposito] Error PATCH recepcion:", error)
    return NextResponse.json({ error: "Error al actualizar recepción" }, { status: 500 })
  }
}
