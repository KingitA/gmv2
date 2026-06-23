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
        id, articulo_id, cantidad, precio_final, precio_base, es_bonificado, estado_item,
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

  // ── Cálculo por ítem (idéntico al route) ──
  const items: any[] = []
  for (const det of (pedido as any).detalle ?? []) {
    const art = det.articulo
    if (!art) continue
    if (det.estado_item === 'FALTANTE' || (det.cantidad ?? 0) <= 0) continue

    const condItem = art.proveedor_id ? condProvMap.get(art.proveedor_id) : null
    const metodoItem: Metodo = condItem?.metodo_facturacion ? metodoDesdeRaw(condItem.metodo_facturacion) : metodoFacturacion
    const esPresupuesto = art.iva_ventas === 'presupuesto' || metodoItem === 'Presupuesto'
    const vaEnComprobante: 'factura' | 'presupuesto' =
      metodoItem === 'Presupuesto' ? 'presupuesto' :
      metodoItem === 'Factura'     ? 'factura'     :
      esPresupuesto ? 'presupuesto' : 'factura'

    const precioAlCliente = det.precio_final || 0
    const precioNeto = det.precio_base > 0 ? det.precio_base : r2(precioAlCliente / (1 + IVA_RATE))

    let precioUnitario: number
    let ivaUnitario: number
    if (vaEnComprobante === 'factura') {
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
      esBonificado: det.es_bonificado === true,
    })
  }

  // ── Bonificaciones del cliente ──
  const { data: bonificacionesCliente } = await supabase
    .from('bonificaciones').select('tipo, porcentaje, segmento')
    .eq('cliente_id', cliente?.id).eq('activo', true).in('tipo', ['general', 'viajante'])

  // ── Agrupar por (vaEnComprobante, perfil de descuento, proveedor) — idéntico al route ──
  const grupos = new Map<string, any[]>()
  for (const item of items) {
    const cond = item.proveedorId ? condProvMap.get(item.proveedorId) : null
    const provKey = cond ? item.proveedorId : ''
    const bonifProfile = cond
      ? `prov:${cond.dto_general_pct || 0}:${cond.dto_viajante_pct || 0}`
      : getBonifProfile(item.segmento, bonificacionesCliente || [])
    const key = `${item.vaEnComprobante}__${bonifProfile}__${provKey}`
    if (!grupos.has(key)) grupos.set(key, [])
    grupos.get(key)!.push(item)
  }

  const tipoFactura = determinarTipoFactura(cliente?.condicion_iva) ?? 'FA'
  const tasaIIBB = await resolverAlicuotaIIBB(supabase, cliente)

  const comprobantes: ComprobantePreview[] = []
  for (const grupoItems of grupos.values()) {
    const esFactura = grupoItems[0].vaEnComprobante === 'factura'
    const esPresupuesto = !esFactura
    const tipo = esFactura ? tipoFactura : 'PRES'
    const segmentoGrupo = grupoItems[0].segmento

    // ── Bonificaciones aplicables (idéntico al route): condición de proveedor o
    //    bonificaciones del cliente filtradas por segmento ──
    const condGrupo = grupoItems[0].proveedorId ? condProvMap.get(grupoItems[0].proveedorId) : null
    const bonifAplicables: Array<{ tipo: string; porcentaje: number }> = condGrupo
      ? [
          ...(condGrupo.dto_general_pct  ? [{ tipo: 'general',  porcentaje: Number(condGrupo.dto_general_pct) }]  : []),
          ...(condGrupo.dto_viajante_pct ? [{ tipo: 'viajante', porcentaje: Number(condGrupo.dto_viajante_pct) }] : []),
        ]
      : (bonificacionesCliente || []).filter((b: any) => !b.segmento || b.segmento === segmentoGrupo)

    // ── Líneas de descuento (idéntico al route) ──
    const lineasDescuento: { descripcion: string; monto: number }[] = []
    const totalGrupo = r2(grupoItems.reduce((s, i) => s + i.subtotalFinal, 0))
    const totalBonificados = r2(grupoItems.filter((i) => i.esBonificado).reduce((s, i) => s + i.subtotalFinal, 0))
    if (totalBonificados > 0) {
      lineasDescuento.push({ descripcion: 'Bonificación Mercadería 100%', monto: totalBonificados })
    }
    const baseNormal = r2(totalGrupo - totalBonificados)
    for (const bonif of bonifAplicables) {
      const monto = r2(baseNormal * bonif.porcentaje / 100)
      const label = bonif.tipo === 'general' ? 'Bonificación General' : 'Desc. Viajante'
      lineasDescuento.push({ descripcion: `${label} ${bonif.porcentaje}%`, monto })
    }

    // ── Totales + descuento (idéntico a generarComprobante) ──
    let totalNeto = r2(grupoItems.reduce((s, i) => s + i.subtotalNeto, 0))
    let totalIva  = esPresupuesto ? 0 : r2(grupoItems.reduce((s, i) => s + i.subtotalIva, 0))

    const descuentoTotal = r2(lineasDescuento.reduce((s, l) => s + l.monto, 0))
    const lineasDescuentoDetalle: { descripcion: string; monto: number }[] = []
    if (descuentoTotal > 0) {
      const descNeto = esPresupuesto ? descuentoTotal : r2(descuentoTotal / (1 + IVA_RATE))
      const descIva  = esPresupuesto ? 0 : r2(descuentoTotal - descNeto)
      totalNeto = r2(totalNeto - descNeto)
      totalIva  = r2(totalIva  - descIva)
      let acumulado = 0
      for (let i = 0; i < lineasDescuento.length; i++) {
        const l = lineasDescuento[i]
        const esUltima = i === lineasDescuento.length - 1
        const montoLinea = esPresupuesto ? l.monto : esUltima ? r2(descNeto - acumulado) : r2(l.monto / (1 + IVA_RATE))
        acumulado = r2(acumulado + montoLinea)
        lineasDescuentoDetalle.push({ descripcion: l.descripcion, monto: montoLinea })
      }
    }

    // ── Percepciones sobre el neto YA descontado (solo facturas) ──
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
      detalle: [
        ...grupoItems.map((i) => ({
          articulo_id: i.articulo_id, descripcion: i.descripcion, sku: i.sku,
          cantidad: i.cantidad, precio_unitario: i.precioUnitario, precio_total: i.subtotalNeto,
          articulos: { descripcion: i.descripcion, sku: i.sku, marca_id: i.marcaId, descuento_propio: i.descuentoPropio },
        })),
        // Líneas negativas de bonificación (el template las muestra con "-$" por precio_unitario < 0)
        ...lineasDescuentoDetalle.map((l) => ({
          articulo_id: null, descripcion: l.descripcion, sku: '',
          cantidad: 1, precio_unitario: -l.monto, precio_total: -l.monto,
          articulos: { descripcion: l.descripcion, sku: '', marca_id: null, descuento_propio: 0 },
        })),
      ],
    })
  }

  // Orden: facturas primero, presupuestos después (lectura más natural)
  comprobantes.sort((a, b) => (a.tipo === 'PRES' ? 1 : 0) - (b.tipo === 'PRES' ? 1 : 0))

  return { cliente, pedido, comprobantes }
}
