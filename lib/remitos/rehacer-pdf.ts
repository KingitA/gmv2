import type { SupabaseClient } from "@supabase/supabase-js"
import { generarYSubirRemitoPDF, type RemitoPDFData } from "@/lib/remitos/generar-remito"
import { REQUIERE_CAE } from "@/lib/arca/tipos"
import { palletsDePedidos } from "@/lib/viajes/bultos"

/**
 * Re-renderiza el PDF de un remito YA numerado desde su fila (`remitos` +
 * `remitos_detalle`): mismo número y mismo contenido, salvo lo que haya cambiado
 * en la fila (bultos). Lo usan:
 *  - POST /api/remitos/[id]/regenerar-pdf (remitos huérfanos, PDF que falló);
 *  - sincronizarBultosRemitos (R12 / #22: bultos cargados después de facturar,
 *    ANTES de despachar el viaje).
 * Necesita el cliente de servicio (el bucket de remitos es privado).
 */
export async function rehacerPDFRemito(admin: SupabaseClient, remitoId: string) {
  const { data: remito, error } = await admin
    .from("remitos")
    .select(`
      *,
      cliente:clientes(nombre_razon_social, cuit, direccion, localidad, condicion_iva),
      transporte_rel:transportes(nombre, cuit),
      comprobante:comprobantes_venta(tipo_comprobante, numero_comprobante),
      pedido:pedidos(numero_pedido),
      remitos_detalle(articulo_id, descripcion, cantidad, articulos(sku))
    `)
    .eq("id", remitoId)
    .single()
  if (error || !remito) throw new Error("Remito no encontrado")

  const esFiscal = REQUIERE_CAE.has(remito.comprobante?.tipo_comprobante ?? "") || remito.tipo_remito === "REM"
  let empresa = null
  if (esFiscal && remito.tipo_remito === "REM") {
    const { data } = await admin
      .from("configuracion_empresa")
      .select("razon_social, cuit, direccion, telefono, condicion_iva, iibb, numero_iibb, inicio_actividades, logo_url")
      .single()
    empresa = data ?? null
  }
  const pallets = remito.pedido_id ? (await palletsDePedidos(admin, [remito.pedido_id])).get(remito.pedido_id) || 0 : 0

  const pdfData: RemitoPDFData = {
    remito: {
      id: remito.id,
      tipo_remito: remito.tipo_remito,
      numero_remito: remito.numero_remito,
      fecha: remito.fecha,
      valor_declarado: Number(remito.valor_declarado ?? 0),
      bultos: remito.bultos ?? null,
      pallets: pallets || null,
      observaciones: remito.observaciones ?? null,
      comprobante_numero: remito.comprobante?.numero_comprobante ?? null,
      comprobante_tipo: remito.comprobante?.tipo_comprobante ?? null,
    },
    empresa,
    cliente: {
      nombre_razon_social: remito.cliente?.nombre_razon_social ?? "—",
      cuit: remito.cliente?.cuit ?? null,
      direccion: remito.cliente?.direccion ?? null,
      localidad: remito.cliente?.localidad ?? null,
      condicion_iva: remito.cliente?.condicion_iva ?? null,
    },
    transporte: remito.transporte_rel
      ? { nombre: remito.transporte_rel.nombre, cuit: remito.transporte_rel.cuit ?? null }
      : remito.transporte
        ? { nombre: remito.transporte, cuit: null }
        : null,
    condicion_entrega: remito.condicion_entrega ?? "",
    copias: remito.copias === 3 ? ["ORIGINAL", "DUPLICADO", "TRIPLICADO"] : ["ORIGINAL", "DUPLICADO"],
    detalle: (remito.remitos_detalle ?? []).map((d: any) => ({
      sku: d.articulos?.sku ?? null,
      descripcion: d.descripcion ?? "—",
      cantidad: Number(d.cantidad ?? 0),
    })),
    numero_pedido: remito.pedido?.numero_pedido ?? null,
  }

  // upsert:true — mismo archivo (mismo número); el hash y el snapshot se actualizan.
  return generarYSubirRemitoPDF(admin, remito.id, pdfData, { upsert: true })
}

/**
 * R12 (#22): los bultos y pallets se cargan en el ERP, a veces después de
 * facturar. Mientras el viaje NO salió, el remito activo de cada pedido toma los
 * bultos/pallets del pedido y se rehace su PDF. Devuelve los remitos rehechos y
 * los errores (nunca frena la carga ni el despacho).
 */
export async function sincronizarBultosRemitos(
  admin: SupabaseClient,
  pedidoIds: string[],
): Promise<{ rehechos: number; errores: string[] }> {
  const errores: string[] = []
  let rehechos = 0
  if (!pedidoIds.length) return { rehechos, errores }

  const [{ data: pedidos }, pallets, { data: remitos }] = await Promise.all([
    admin.from("pedidos").select("id, bultos").in("id", pedidoIds),
    palletsDePedidos(admin, pedidoIds),
    admin.from("remitos").select("id, pedido_id, bultos, numero_remito, pdf_snapshot").in("pedido_id", pedidoIds).eq("estado", "activo"),
  ])
  const bultosDe = new Map((pedidos || []).map((p: any) => [p.id as string, Number(p.bultos) || 0]))

  for (const r of (remitos || []) as any[]) {
    const bultos = bultosDe.get(r.pedido_id) ?? 0
    const pal = pallets.get(r.pedido_id) ?? 0
    const palletsImpresos = Number(r.pdf_snapshot?.remito?.pallets) || 0
    if ((Number(r.bultos) || 0) === bultos && palletsImpresos === pal) continue
    try {
      const { error } = await admin.from("remitos").update({ bultos: bultos > 0 ? bultos : null }).eq("id", r.id)
      if (error) throw error
      await rehacerPDFRemito(admin, r.id)
      rehechos++
    } catch (e: any) {
      errores.push(`remito ${r.numero_remito}: ${e?.message || e}`)
    }
  }
  return { rehechos, errores }
}
