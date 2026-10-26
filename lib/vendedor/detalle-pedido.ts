// Detalle de un pedido del vendedor (ítems, comprobantes, remitos y cabecera de
// descuentos). Extraído de GET /api/vendedor/pedidos/[id] (misma lógica y respuesta)
// para que también lo use la réplica de la app Vendedor. Ver MOBILE.md → "Vendedor".

import { SEGMENTOS_BONIF, normalizarBonifPedido, type SegmentoBonif } from "@/lib/pricing/segmento"

/** null = pedido inexistente, eliminado o de otro vendedor. */
export async function cargarDetallePedido(supabase: any, vendedorIds: string[], id: string) {
  const { data: pedido, error } = await supabase
    .from("pedidos")
    .select(
      `id, numero_pedido, fecha, estado, total, observaciones, metodo_facturacion_pedido, lista_precio_pedido_id, bonif_pedido, bonif_mercaderia_pct, vendedor_id, cliente_id, created_at,
       clientes:cliente_id(id, nombre, localidad, metodo_facturacion, lista_precio_id, lista:lista_precio_id(nombre)),
       pedidos_detalle(id, articulo_id, cantidad, precio_base, precio_final, subtotal, es_bonificado, estado_item,
         precio_lista, descuento_propio_pct, bonif_general_pct, bonif_viajante_pct, metodo_facturacion_item,
         articulos:articulo_id(id, sku, descripcion, unidades_por_bulto, imagen_url, marca_id, proveedor_id, marca:marca_id(descripcion)))`
    )
    .eq("id", id)
    .is("eliminado_at", null)
    .maybeSingle()

  if (error) throw error
  if (!pedido || !vendedorIds.includes((pedido as any).vendedor_id)) return null
  const clienteId = (pedido as any).cliente_id as string

  // Comprobantes y remitos del pedido (para abrir los PDF desde la app)
  const [{ data: comprobantes }, { data: remitos }, { data: fichaRows }, { data: condMarcaPed }, { data: condProvPed }, { data: condMarcaCli }, { data: condProvCli }] =
    await Promise.all([
      supabase.from("comprobantes_venta").select("id, tipo_comprobante, numero_comprobante, anulado_en, estado_pdf, total_factura, saldo_pendiente").eq("pedido_id", id).is("anulado_en", null),
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
      // general también puede venir "solo este pedido" (lo carga el ERP)
      const o = ovr?.[tipo]?.[seg]
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

  const cuentaPedido = await cuentaDelPedido(supabase, comprobantes ?? [])

  return {
    pedido,
    comprobantes: comprobantes ?? [],
    cuenta_pedido: cuentaPedido,
    remitos: remitos ?? [],
    descuentos: { segmentos, condiciones, solo_este_pedido: !!ovr },
  }
}

const DEBITOS = new Set(["FA", "FB", "FC", "PRES"])
const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * CUENTA DEL PEDIDO (V3, #31 del 26/10): comprobantes del pedido − reversas/NC aplicadas
 * (devoluciones, 10 % contado) − pagos = lo que debe. Las reversas salen de las imputaciones
 * con `credito_comprobante_id` a los comprobantes del pedido (la REV del 10 % contado no tiene
 * pedido_id: está imputada a sus PRES). Lo que no cierra (ajuste de redondeo) va aparte.
 * null = el pedido no tiene comprobantes de débito.
 */
async function cuentaDelPedido(supabase: any, comprobantes: any[]) {
  const debitos = comprobantes.filter((c) => DEBITOS.has(c.tipo_comprobante))
  if (!debitos.length) return null
  const { data: imps, error } = await supabase
    .from("imputaciones")
    .select("comprobante_id, monto_imputado, pago_id, credito_comprobante_id, credito:comprobantes_venta!imputaciones_credito_comprobante_id_fkey(id, tipo_comprobante, numero_comprobante, observaciones, anulado_en, estado_pago, estado_pdf)")
    .in("comprobante_id", debitos.map((c) => c.id))
    .eq("estado", "confirmado")
  if (error) throw error
  const reversas = new Map<string, { id: string; tipo_comprobante: string; numero_comprobante: string; motivo: string; monto: number; estado_pdf: string | null }>()
  let pagado = 0
  for (const i of imps || []) {
    const monto = Number(i.monto_imputado) || 0
    if (!i.credito_comprobante_id) {
      pagado += monto
      continue
    }
    const cr: any = Array.isArray(i.credito) ? i.credito[0] : i.credito
    if (!cr || cr.anulado_en || cr.estado_pago === "anulado") continue
    const obs = String(cr.observaciones || "")
    const motivo = obs.startsWith("Devolución") ? obs.split(/\s+/).slice(0, 2).join(" ") : /contado/i.test(obs) ? "10% contado" : obs.split(/[—·\[]/)[0].trim() || "Crédito"
    const r = reversas.get(cr.id) || { id: cr.id, tipo_comprobante: cr.tipo_comprobante, numero_comprobante: cr.numero_comprobante, motivo, monto: 0, estado_pdf: cr.estado_pdf ?? null }
    r.monto = r2(r.monto + monto)
    reversas.set(cr.id, r)
  }
  const total = r2(debitos.reduce((s, c) => s + Number(c.total_factura || 0), 0))
  const debe = r2(debitos.reduce((s, c) => s + Math.max(0, Number(c.saldo_pendiente || 0)), 0))
  const totalReversas = r2([...reversas.values()].reduce((s, r) => s + r.monto, 0))
  pagado = r2(pagado)
  return {
    total,
    reversas: [...reversas.values()],
    total_reversas: totalReversas,
    pagado,
    ajuste: r2(total - totalReversas - pagado - debe),
    debe,
  }
}
