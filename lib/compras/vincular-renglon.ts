import { sumarDocumentado } from "@/lib/compras/documentado"
import { resolveFactorConversion } from "@/lib/services/conversion"
import { vinculosAutomaticos, type ArticuloOrdenCoincidencia } from "@/lib/compras/coincidencia-oc"
import { precioNeto } from "@/lib/compras/oc-totales"
import { tipoDescuentoProveedor } from "@/lib/compras/tipo-descuento-proveedor"

/**
 * Vincular un renglón de un comprobante de compra a un artículo (lo que hacía el PATCH de
 * /api/comprobantes-compra/[id]/detalle, ahora compartido con el vínculo automático):
 *  1. aprende la equivalencia proveedor ↔ artículo (RPC compras_aprender_equivalencia), para que
 *     la próxima factura del mismo proveedor matchee sola;
 *  2. suma lo documentado a la línea de recepción de la orden (la crea "fuera de la orden" si el
 *     artículo no estaba pedido);
 *  3. deja el renglón con su artículo y `match_estado` (manual = lo eligió una persona;
 *     auto_oc = vinculado solo porque coincidía con UN artículo de la orden).
 *
 * Re-vincular (el renglón ya tenía otro artículo, p. ej. un vínculo automático equivocado): antes
 * se RESTA lo documentado de la línea vieja (misma cuenta que revertirComprobanteOCR) y, si era una
 * línea fuera de la orden que quedó vacía, se borra. Solo con el comprobante sin validar.
 */
export async function vincularRenglon(
  supabase: any,
  p: { comprobante_id: string; detalle_id: string; articulo_id: string; match_estado?: "manual" | "auto_oc" },
): Promise<{ ok: true; detalle: any } | { ok: false; status: number; error: string }> {
  const matchEstado = p.match_estado || "manual"
  const { data: detalle } = await supabase
    .from("comprobantes_compra_detalle")
    .select("*")
    .eq("id", p.detalle_id)
    .eq("comprobante_id", p.comprobante_id)
    .maybeSingle()
  if (!detalle) return { ok: false, status: 404, error: "Línea de detalle no encontrada" }

  const { data: comprobante } = await supabase
    .from("comprobantes_compra")
    .select("id, proveedor_id, orden_compra_id, estado")
    .eq("id", p.comprobante_id)
    .maybeSingle()
  if (!comprobante?.proveedor_id) return { ok: false, status: 400, error: "Comprobante sin proveedor" }

  // Ya estaba vinculado a ESE artículo: no se vuelve a sumar (antes sumaba dos veces)
  if (detalle.articulo_id && detalle.articulo_id === p.articulo_id) {
    if (detalle.match_estado === matchEstado) return { ok: true, detalle }
    const { data: upd, error } = await supabase
      .from("comprobantes_compra_detalle")
      .update({ match_estado: matchEstado, articulo_sugerido_id: null })
      .eq("id", p.detalle_id)
      .select()
      .single()
    if (error) return { ok: false, status: 500, error: error.message }
    return { ok: true, detalle: upd }
  }

  let recepcionItemId: string | null = detalle.recepcion_item_id

  // Re-vincular: deshacer lo que el vínculo anterior sumó a la recepción
  if (detalle.articulo_id) {
    if (["validado", "cerrado"].includes(comprobante.estado)) {
      return { ok: false, status: 409, error: "El comprobante ya está validado: no se le puede cambiar el artículo a un renglón." }
    }
    if (detalle.recepcion_item_id) {
      const { data: item } = await supabase
        .from("recepciones_items")
        .select("id, factor_conversion, fuera_de_oc, cantidad_fisica")
        .eq("id", detalle.recepcion_item_id)
        .maybeSingle()
      if (item) {
        const factor = detalle.tipo_cantidad === "bulto" ? Number(item.factor_conversion || 1) : 1
        const restar = Number(detalle.cantidad_facturada || 0) * factor
        const quedo = (await sumarDocumentado(supabase, item.id, -restar)) ?? 0
        if (item.fuera_de_oc && quedo === 0 && Number(item.cantidad_fisica || 0) === 0) {
          await supabase.from("recepciones_items").delete().eq("id", item.id).eq("cantidad_documentada", 0)
        }
      }
    }
    recepcionItemId = null
  }

  // 1. Aprender la equivalencia proveedor↔artículo
  const { error: rpcError } = await supabase.rpc("compras_aprender_equivalencia", {
    p_articulo_id: p.articulo_id,
    p_proveedor_id: comprobante.proveedor_id,
    p_codigo_proveedor: detalle.codigo_proveedor || null,
    p_descripcion: detalle.descripcion_proveedor || null,
  })
  if (rpcError) console.error("[vincularRenglon] aprender_equivalencia:", rpcError.message)

  // 2. Vincular con la recepción de la OC (crear línea fuera_de_oc si no estaba pedida)
  // La línea sin vincular nació como 'unidad'; al vincularla se sabe si la factura la trae por bulto
  let tipoCantidad: string | null = null
  if (comprobante.orden_compra_id) {
    const { data: recepcion } = await supabase
      .from("recepciones")
      .select("id")
      .eq("orden_compra_id", comprobante.orden_compra_id)
      .neq("estado", "cancelada")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (recepcion) {
      let { data: recItem } = await supabase
        .from("recepciones_items")
        .select("*, articulo:articulos(id, unidades_por_bulto, precio_compra)")
        .eq("recepcion_id", recepcion.id)
        .eq("articulo_id", p.articulo_id)
        .maybeSingle()

      if (!recItem) {
        const { data: nueva } = await supabase
          .from("recepciones_items")
          .insert({
            recepcion_id: recepcion.id,
            articulo_id: p.articulo_id,
            cantidad_oc: 0,
            cantidad_fisica: 0,
            estado_linea: "pendiente",
            fuera_de_oc: true,
          })
          .select("*, articulo:articulos(id, unidades_por_bulto, precio_compra)")
          .single()
        recItem = nueva
      }

      if (recItem) {
        const { data: proveedor } = await supabase
          .from("proveedores")
          .select("default_unidad_factura")
          .eq("id", comprobante.proveedor_id)
          .maybeSingle()

        const conversion = resolveFactorConversion({
          proveedorDefaultUnidad: proveedor?.default_unidad_factura,
          articuloUnidadesPorBulto: recItem.articulo?.unidades_por_bulto,
          descripcionOcr: detalle.descripcion_proveedor,
          precioDocumento: detalle.precio_unitario,
          costoBaseArticulo: recItem.articulo?.precio_compra,
        })

        const cantBase = Number(detalle.cantidad_facturada || 0) * conversion.factor
        tipoCantidad = conversion.factor === 1 ? "unidad" : "bulto"

        await sumarDocumentado(supabase, recItem.id, cantBase, {
          precio_documentado: detalle.precio_unitario || 0,
          precio_real: detalle.precio_unitario || recItem.precio_oc || 0,
          cantidad_base: cantBase,
          factor_conversion: conversion.factor,
          conversion_source: conversion.source,
          requires_review: conversion.requiresReview,
        })

        recepcionItemId = recItem.id
      }
    }
  }

  // 3. Actualizar la línea del detalle
  const { data: updated, error: updError } = await supabase
    .from("comprobantes_compra_detalle")
    .update({
      articulo_id: p.articulo_id,
      articulo_sugerido_id: null,
      match_estado: matchEstado,
      recepcion_item_id: recepcionItemId,
      // misma convención que el OCR: cantidad tal cual la factura + si son bultos o unidades
      ...(tipoCantidad ? { tipo_cantidad: tipoCantidad } : {}),
    })
    .eq("id", p.detalle_id)
    .select()
    .single()
  if (updError) return { ok: false, status: 500, error: updError.message }
  return { ok: true, detalle: updated }
}

/** Artículo de la orden con lo que muestra la pantalla de vincular (foto, marca, lo pedido) */
export interface ArticuloDeLaOrden extends ArticuloOrdenCoincidencia {
  sku: string | null
  descripcion: string
  imagen_url: string | null
  marca: string | null
}

/**
 * Los artículos de la orden (uno por artículo: si está en más de un renglón se suman las unidades
 * y vale el precio del primero), con foto y marca.
 */
export async function articulosDeLaOrden(supabase: any, ordenId: string): Promise<ArticuloDeLaOrden[]> {
  const { data: det } = await supabase
    .from("ordenes_compra_detalle")
    .select("articulo_id, cantidad_pedida, tipo_cantidad, precio_unitario, descuento1, descuento2, descuento3, descuento4")
    .eq("orden_compra_id", ordenId)
    .limit(2000)
  const renglones: any[] = (det || []).filter((d: any) => d.articulo_id)
  if (renglones.length === 0) return []
  // La factura trae el precio NETO (con los descuentos de la orden aplicados), no el de lista
  const { data: oc } = await supabase.from("ordenes_compra").select("proveedor_id").eq("id", ordenId).maybeSingle()
  const tipoDescuento = await tipoDescuentoProveedor(supabase, oc?.proveedor_id)
  const ids = [...new Set(renglones.map((d) => d.articulo_id as string))]
  const { data: arts } = await supabase
    .from("articulos")
    .select("id, sku, descripcion, imagen_url, unidades_por_bulto, marca_id")
    .in("id", ids)
  const art = new Map<string, any>(((arts || []) as any[]).map((a) => [a.id, a]))
  const marcaIds = [...new Set(((arts || []) as any[]).map((a) => a.marca_id).filter(Boolean))]
  const marcas = new Map<string, string>()
  if (marcaIds.length > 0) {
    const { data: ms } = await supabase.from("marcas").select("id, descripcion").in("id", marcaIds)
    for (const m of (ms || []) as any[]) if (m.descripcion) marcas.set(m.id, String(m.descripcion))
  }

  const porArticulo = new Map<string, ArticuloDeLaOrden>()
  for (const d of renglones) {
    const a = art.get(d.articulo_id)
    const upb = Number(a?.unidades_por_bulto) > 1 ? Number(a.unidades_por_bulto) : 1
    const unidades = d.tipo_cantidad === "unidad" ? Number(d.cantidad_pedida || 0) : Number(d.cantidad_pedida || 0) * upb
    const previo = porArticulo.get(d.articulo_id)
    if (previo) {
      // Se juntan en unidades (el renglón combinado queda "por unidad" si alguno lo era)
      const unidadesPrevias = previo.tipo_cantidad === "unidad" ? previo.cantidad_pedida : previo.cantidad_pedida * upb
      const total = unidadesPrevias + unidades
      const porBulto = previo.tipo_cantidad !== "unidad" && d.tipo_cantidad !== "unidad"
      previo.tipo_cantidad = porBulto ? "bulto" : "unidad"
      previo.cantidad_pedida = porBulto ? total / upb : total
      continue
    }
    porArticulo.set(d.articulo_id, {
      articulo_id: d.articulo_id,
      cantidad_pedida: Number(d.cantidad_pedida || 0),
      tipo_cantidad: d.tipo_cantidad === "unidad" ? "unidad" : "bulto",
      unidades_por_bulto: upb,
      precio_unitario: precioNeto({
        precio_unitario: Number(d.precio_unitario || 0),
        descuento1: Number(d.descuento1 || 0), descuento2: Number(d.descuento2 || 0),
        descuento3: Number(d.descuento3 || 0), descuento4: Number(d.descuento4 || 0),
      }, tipoDescuento),
      sku: a?.sku ?? null,
      descripcion: a?.descripcion || "—",
      imagen_url: typeof a?.imagen_url === "string" && a.imagen_url.trim() ? a.imagen_url : null,
      marca: a?.marca_id ? marcas.get(a.marca_id) ?? null : null,
    })
  }
  return [...porArticulo.values()]
}

/**
 * Vínculo AUTOMÁTICO de los renglones sin vincular de un comprobante (decisión de Juan, 26/11):
 * si un renglón coincide en cantidad y precio con UN SOLO artículo de la orden
 * (lib/compras/coincidencia-oc.ts) se vincula solo, por el mismo camino que a mano
 * (vincularRenglon: aprende la equivalencia), con match_estado 'auto_oc' para que la pantalla lo
 * muestre como "vinculado automático" y se pueda cambiar. Nunca vincula artículos que no estén en
 * la orden. Si coincide con más de uno o con ninguno, queda para que elija una persona.
 * Devuelve cuántos vinculó. No tira: un error se registra y deja los renglones como estaban.
 */
export async function autoVincularPorOrden(supabase: any, comprobanteId: string): Promise<number> {
  try {
    const { data: comp } = await supabase
      .from("comprobantes_compra")
      .select("id, orden_compra_id, estado")
      .eq("id", comprobanteId)
      .maybeSingle()
    if (!comp?.orden_compra_id || ["validado", "cerrado", "esperada"].includes(comp.estado)) return 0

    const { data: det } = await supabase
      .from("comprobantes_compra_detalle")
      .select("id, articulo_id, match_estado, cantidad_facturada, precio_unitario")
      .eq("comprobante_id", comprobanteId)
    const filas: any[] = det || []
    const pendientes = filas.filter((r) => !r.articulo_id && (r.match_estado === "sin_match" || r.match_estado === "sugerido"))
    if (pendientes.length === 0) return 0

    const orden = await articulosDeLaOrden(supabase, comp.orden_compra_id)
    if (orden.length === 0) return 0
    const yaVinculados = filas.filter((r) => r.articulo_id).map((r) => r.articulo_id as string)
    const auto = vinculosAutomaticos(
      pendientes.map((r) => ({ id: r.id, cantidad: Number(r.cantidad_facturada || 0), precio: Number(r.precio_unitario || 0) })),
      orden,
      yaVinculados,
    )
    let n = 0
    for (const [detalleId, articuloId] of auto) {
      // Se "toma" el renglón en el mismo UPDATE que comprueba que sigue sin vincular: si dos
      // pantallas (o la lectura y la pantalla) corren esto a la vez, solo una suma a la recepción.
      const { data: tomado } = await supabase
        .from("comprobantes_compra_detalle")
        .update({ match_estado: "auto_oc", articulo_sugerido_id: articuloId })
        .eq("id", detalleId)
        .is("articulo_id", null)
        .in("match_estado", ["sin_match", "sugerido"])
        .select("id")
      if (!tomado || tomado.length === 0) continue
      const r = await vincularRenglon(supabase, { comprobante_id: comprobanteId, detalle_id: detalleId, articulo_id: articuloId, match_estado: "auto_oc" })
      if (r.ok) n++
      else console.error("[autoVincularPorOrden]", detalleId, r.error)
    }
    return n
  } catch (e: any) {
    console.error("[autoVincularPorOrden] error:", e?.message || e)
    return 0
  }
}
