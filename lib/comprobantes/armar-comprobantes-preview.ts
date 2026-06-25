/**
 * Arma los comprobantes lógicos de un pedido para la VISTA PREVIA, replicando
 * fielmente la lógica de cálculo de precios y agrupación de la emisión real
 * (app/api/comprobantes-venta/generar/route.ts).
 *
 * ⚠️ ACOPLAMIENTO: si cambiás el cálculo de ítems o la agrupación en
 * generar/route.ts (item calc, vaEnComprobante, detectarSegmento, getBonifProfile,
 * key de grupos), actualizá también este archivo para que la vista previa
 * siga siendo una copia fiel. Las percepciones y el IVA usan los MISMOS helpers
 * que la emisión real (calcularPercepciones / resolverAlicuotaIIBB), no se replican.
 *
 * NO emite, NO toca ARCA, NO escribe en la DB, NO mueve stock ni cuenta corriente.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { determinarTipoFactura } from '@/lib/comprobantes/tipo-comprobante'
import { calcularPercepciones } from '@/lib/comprobantes/calcular-percepciones'
import { resolverAlicuotaIIBB } from '@/lib/comprobantes/percepcion-iibb'

const IVA_RATE = 0.21
const r2 = (n: number) => Math.round(n * 100) / 100

type Metodo = 'Factura' | 'Presupuesto' | 'Final'
const metodoDesdeRaw = (raw: string | null | undefined): Metodo =>
  raw === 'Factura (21% IVA)' || raw === 'Factura' ? 'Factura' :
  raw === 'Presupuesto' ? 'Presupuesto' : 'Final'

// Idénticas a las del route real
function detectarSegmento(art: { segmento_precio?: string | null; iva_ventas?: string | null }): string {
  if (art.segmento_precio === 'perfumeria')
    return art.iva_ventas === 'presupuesto' ? 'perf0' : 'perf_plus'
  return 'limpieza_bazar'
}
function getBonifProfile(itemSegmento: string, bonificaciones: any[]): string {
  return bonificaciones
    .filter((b: any) => !b.segmento || b.segmento === itemSegmento)
    .sort((a: any, b: any) => a.tipo.localeCompare(b.tipo))
    .map((b: any) => `${b.tipo}:${b.porcentaje}`)
    .join('|')
}

const CONDICION_PROVEEDOR_COLS =
  'proveedor_id, lista_precio_id, metodo_facturacion, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct'
const CONDICION_MARCA_COLS =
  'marca_id, lista_precio_id, metodo_facturacion, dto_general_pct, dto_viajante_pct, dto_mercaderia_pct'

export interface ComprobantePreview {
  tipo: string                      // 'FA' | 'FB' | 'PRES'
  total_neto: number
  total_iva: number
  percepcion_iva: number
  percepcion_iibb: number
  total_factura: number
  detalle: Array<{
    articulo_id: string | null
    descripcion: string
    sku: string
    cantidad: number
    precio_unitario: number
    precio_total: number
    precio_lista: number | null
    descuento_propio_pct: number
    bonif_general_pct: number
    bonif_viajante_pct: number
    es_bonificado: boolean
    articulos: { descripcion: string; sku: string; marca_id: string | null; descuento_propio: number }
  }>
}

export interface PreviewResult {
  cliente: any
  pedido: any
  comprobantes: ComprobantePreview[]
}

export async function armarComprobantesPreview(
  supabase: SupabaseClient,
  pedidoId: string,
): Promise<PreviewResult | { error: string; status: number }> {
  const { data: pedido, error } = await supabase
    .from('pedidos')
    .select(`
      id, numero_pedido, condicion_entrega, metodo_facturacion_pedido,
      cliente:clientes!pedidos_cliente_id_fkey(
        id, nombre_razon_social, nombre, condicion_iva, metodo_facturacion, cuit, direccion,
        exento_iva, exento_iibb, provincia, percepcion_iibb, telefono, condicion_pago
      ),
      detalle:pedidos_detalle(
        id, articulo_id, cantidad, precio_final, precio_base, es_bonificado, estado_item, metodo_facturacion_item,
        precio_lista, descuento_propio_pct, bonif_general_pct, bonif_viajante_pct,
        articulo:articulos!pedidos_detalle_articulo_id_fkey(
          id, descripcion, sku, iva_ventas, categoria, iva_compras, marca_id, proveedor_id, segmento_precio, descuento_propio
        )
      )
    `)
    .eq('id', pedidoId)
    .single()

  if (error || !pedido) return { error: 'Pedido no encontrado', status: 404 }

  const cliente = (pedido as any).cliente

  // Método de facturación del pedido (idéntico al route)
  const metodoRaw = (pedido as any).metodo_facturacion_pedido || cliente?.metodo_facturacion || 'Final'
  const metodoFacturacion = metodoDesdeRaw(metodoRaw)

  // Condiciones por proveedor: override del pedido > ficha del cliente
  const condProvMap = new Map<string, any>()
  const { data: cliCond } = await supabase
    .from('cliente_proveedor_condicion').select(CONDICION_PROVEEDOR_COLS).eq('cliente_id', cliente?.id)
  for (const r of cliCond || []) condProvMap.set((r as any).proveedor_id, r)
  const { data: pedCond } = await supabase
    .from('pedido_proveedor_condicion').select(CONDICION_PROVEEDOR_COLS).eq('pedido_id', pedidoId)
  for (const r of pedCond || []) condProvMap.set((r as any).proveedor_id, r)

  // Condiciones por MARCA (ganan sobre proveedor)
  const condMarcaMap = new Map<string, any>()
  const { data: cliCondM } = await supabase
    .from('cliente_marca_condicion').select(CONDICION_MARCA_COLS).eq('cliente_id', cliente?.id)
  for (const r of cliCondM || []) condMarcaMap.set((r as any).marca_id, r)
  const { data: pedCondM } = await supabase
    .from('pedido_marca_condicion').select(CONDICION_MARCA_COLS).eq('pedido_id', pedidoId)
  for (const r of pedCondM || []) condMarcaMap.set((r as any).marca_id, r)

  // Resuelve la condición de segmento de un ítem: MARCA gana sobre PROVEEDOR.
  const segCondDe = (marcaId: string | null, proveedorId: string | null): { cond: any | null; segKey: string } => {
    const m = marcaId ? condMarcaMap.get(marcaId) : null
    if (m) return { cond: m, segKey: `marca:${marcaId}` }
    const p = proveedorId ? condProvMap.get(proveedorId) : null
    if (p) return { cond: p, segKey: `prov:${proveedorId}` }
    return { cond: null, segKey: '' }
  }

  // ── Cálculo por ítem (idéntico al route) ──
  const items: any[] = []
  for (const det of (pedido as any).detalle ?? []) {
    const art = det.articulo
    if (!art) continue
    if (det.estado_item === 'FALTANTE' || (det.cantidad ?? 0) <= 0) continue

    // El método del ítem se decidió al crear el pedido (incluye condición por segmento
    // y por proveedor) y quedó en metodo_facturacion_item. Se usa ese; si falta, el general.
    const condItem = segCondDe(art.marca_id ?? null, art.proveedor_id ?? null).cond
    const metodoRawItem = det.metodo_facturacion_item || condItem?.metodo_facturacion || metodoRaw
    const metodoItem: Metodo = metodoDesdeRaw(metodoRawItem)
    const esPresupuesto = art.iva_ventas === 'presupuesto' || metodoItem === 'Presupuesto'
    const vaEnComprobante: 'factura' | 'presupuesto' =
      metodoItem === 'Presupuesto' ? 'presupuesto' :
      metodoItem === 'Factura'     ? 'factura'     :
      esPresupuesto ? 'presupuesto' : 'factura'

    const esBonificado = det.es_bonificado === true
    const precioAlCliente = det.precio_final || 0
    const precioNeto = det.precio_base > 0 ? det.precio_base : r2(precioAlCliente / (1 + IVA_RATE))

    let precioUnitario: number
    let ivaUnitario: number
    if (esBonificado) {
      // Mercadería bonificada: línea a $0 (no suma a la boleta).
      precioUnitario = 0
      ivaUnitario    = 0
    } else if (vaEnComprobante === 'factura') {
      precioUnitario = precioNeto
      ivaUnitario    = r2(precioAlCliente - precioNeto)
    } else {
      const esPerf = art.segmento_precio === 'perfumeria'
      precioUnitario = esPerf ? precioNeto : precioAlCliente
      ivaUnitario    = 0
    }
    const subtotalNeto = r2(precioUnitario * det.cantidad)
    const subtotalIva  = r2(ivaUnitario * det.cantidad)
    const subtotalFinal = r2(subtotalNeto + subtotalIva)
    const precioListaDisplay = (det.precio_lista && det.precio_lista > 0)
      ? det.precio_lista
      : (vaEnComprobante === 'factura' ? precioNeto : precioAlCliente)

    items.push({
      articulo_id: det.articulo_id,
      descripcion: art.descripcion || '',
      sku: art.sku || '',
      cantidad: det.cantidad,
      precioUnitario, subtotalNeto, subtotalIva, subtotalFinal,
      vaEnComprobante,
      segmento: detectarSegmento(art),
      proveedorId: art.proveedor_id ?? null,
      marcaId: art.marca_id ?? null,
      descuentoPropio: Number(art.descuento_propio ?? 0),
      esBonificado,
      precioListaDisplay,
      descuentoPropioPct: Number(det.descuento_propio_pct ?? 0),
      bonifGeneralPct: Number(det.bonif_general_pct ?? 0),
      bonifViajantePct: Number(det.bonif_viajante_pct ?? 0),
    })
  }

  // ── Bonificaciones del cliente ──
  const { data: bonificacionesCliente } = await supabase
    .from('bonificaciones').select('tipo, porcentaje, segmento')
    .eq('cliente_id', cliente?.id).eq('activo', true).in('tipo', ['general', 'viajante'])

  // ── Agrupar por (vaEnComprobante, perfil de descuento, proveedor) — idéntico al route ──
  // La mercadería bonificada NO se agrupa: se reparte luego entre los comprobantes
  // normales (no-especial) proporcional al neto, como ÚLTIMO ítem de cada uno.
  const keyDeItem = (item: any) => {
    const { cond, segKey } = segCondDe(item.marcaId, item.proveedorId)
    const bonifProfile = cond
      ? `seg:${cond.dto_general_pct || 0}:${cond.dto_viajante_pct || 0}`
      : getBonifProfile(item.segmento, bonificacionesCliente || [])
    return { key: `${item.vaEnComprobante}__${bonifProfile}__${segKey}`, esSegmento: !!cond }
  }

  const grupos = new Map<string, any[]>()
  const itemsBonificados: any[] = []
  for (const item of items) {
    const { key, esSegmento } = keyDeItem(item)
    if (item.esBonificado && !esSegmento) { itemsBonificados.push(item); continue }
    if (!grupos.has(key)) grupos.set(key, [])
    grupos.get(key)!.push(item)
  }

  if (itemsBonificados.length > 0) {
    const grupoEsProv = (g: any[]) => !!(g[0] && segCondDe(g[0].marcaId, g[0].proveedorId).cond)
    const netoGrupo = (g: any[]) => r2(g.reduce((s, i) => s + i.subtotalNeto, 0))
    const normales = [...grupos.values()].filter(g => !grupoEsProv(g))
    const netos = normales.map(netoGrupo)
    const netoTotal = r2(netos.reduce((s, n) => s + n, 0))
    if (normales.length > 0 && netoTotal > 0) {
      for (const bonif of itemsBonificados) {
        const Q = Math.abs(bonif.cantidad)
        let asignado = 0
        for (let i = 0; i < normales.length; i++) {
          const qtyG = i === normales.length - 1 ? (Q - asignado) : Math.round(Q * netos[i] / netoTotal)
          asignado += qtyG
          if (qtyG > 0) normales[i].push({ ...bonif, cantidad: qtyG })
        }
      }
    } else if (normales.length === 0 && grupos.size > 0) {
      ;[...grupos.values()][0].push(...itemsBonificados)
    }
  }

  const tipoFactura = determinarTipoFactura(cliente?.condicion_iva) ?? 'FA'
  const tasaIIBB = await resolverAlicuotaIIBB(supabase, cliente)

  const comprobantes: ComprobantePreview[] = []
  for (const grupoItems of grupos.values()) {
    const esFactura = grupoItems[0].vaEnComprobante === 'factura'
    const esPresupuesto = !esFactura
    const tipo = esFactura ? tipoFactura : 'PRES'

    // ── Totales (idéntico a generarComprobante) ──
    // Los descuentos general/viajante ya están en el neto por línea; la mercadería
    // bonificada es una línea a $0. No hay líneas negativas. Neto = Σ(líneas).
    const totalNeto = r2(grupoItems.reduce((s, i) => s + i.subtotalNeto, 0))
    const totalIva  = esPresupuesto ? 0 : r2(grupoItems.reduce((s, i) => s + i.subtotalIva, 0))

    // ── Percepciones sobre el neto (solo facturas) ──
    let percIva = 0, percIibb = 0
    if (esFactura) {
      const perc = calcularPercepciones(totalNeto, { ...cliente, percepcion_iibb: tasaIIBB }, true)
      percIva = perc.percepcion_iva
      percIibb = perc.percepcion_iibb
    }
    const totalFactura = (Math.round(totalNeto * 100) + Math.round(totalIva * 100) + Math.round((percIva + percIibb) * 100)) / 100

    comprobantes.push({
      tipo, total_neto: totalNeto, total_iva: totalIva,
      percepcion_iva: percIva, percepcion_iibb: percIibb, total_factura: totalFactura,
      detalle: grupoItems.map((i) => ({
        articulo_id: i.articulo_id, descripcion: i.descripcion, sku: i.sku,
        cantidad: i.cantidad, precio_unitario: i.precioUnitario, precio_total: i.subtotalNeto,
        precio_lista: i.precioListaDisplay ?? null,
        descuento_propio_pct: i.descuentoPropioPct,
        bonif_general_pct: i.bonifGeneralPct,
        bonif_viajante_pct: i.bonifViajantePct,
        es_bonificado: i.esBonificado,
        articulos: { descripcion: i.descripcion, sku: i.sku, marca_id: i.marcaId, descuento_propio: i.descuentoPropio },
      })),
    })
  }

  // Orden: facturas primero, presupuestos después (lectura más natural)
  comprobantes.sort((a, b) => (a.tipo === 'PRES' ? 1 : 0) - (b.tipo === 'PRES' ? 1 : 0))

  return { cliente, pedido, comprobantes }
}
