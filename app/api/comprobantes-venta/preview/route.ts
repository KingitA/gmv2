/**
 * GET /api/comprobantes-venta/preview?pedido_id=...
 *
 * Vista previa de comprobantes: genera UN PDF con el PRESUPUESTO y la FACTURA
 * del pedido, tal como saldrían (precios, IVA discriminado, percepciones,
 * totales, layout). Es solo para revisar formato:
 *   - NO se guarda en comprobantes_venta
 *   - NO se numera ni se sincroniza con ARCA
 *   - NO contacta ARCA (sin CAE/QR reales)
 *   - NO mueve stock ni cuenta corriente
 *   - NO aparece en ningún reporte ni en la conciliación
 *
 * Reutiliza buildPDFData + el template + los mismos helpers de percepciones
 * que la emisión real, así los números coinciden con lo que se emitiría.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse, type NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import React, { type JSXElementConstructor, type ReactElement } from 'react'
import { ComprobantesPreviewPDF } from '@/lib/pdf/comprobante-template'
import { buildPDFData } from '@/lib/pdf/generar'
import { determinarTipoFactura } from '@/lib/comprobantes/tipo-comprobante'
import { calcularPercepciones } from '@/lib/comprobantes/calcular-percepciones'
import { resolverAlicuotaIIBB } from '@/lib/comprobantes/percepcion-iibb'
import { todayArgentina } from '@/lib/utils'

const IVA_RATE = 0.21
const r2 = (n: number) => Math.round(n * 100) / 100

export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = createAdminClient()
    const pedidoId = new URL(request.url).searchParams.get('pedido_id')
    if (!pedidoId) {
      return NextResponse.json({ error: 'Falta pedido_id' }, { status: 400 })
    }

    const { data: pedido, error } = await supabase
      .from('pedidos')
      .select(`
        id, numero_pedido, condicion_entrega,
        cliente:clientes!pedidos_cliente_id_fkey(
          id, nombre_razon_social, nombre, condicion_iva, cuit, direccion,
          exento_iva, exento_iibb, provincia, percepcion_iibb, telefono, condicion_pago
        ),
        detalle:pedidos_detalle(
          id, articulo_id, cantidad, precio_final, precio_base, estado_item,
          articulo:articulos!pedidos_detalle_articulo_id_fkey(
            id, descripcion, sku, marca_id, descuento_propio
          )
        )
      `)
      .eq('id', pedidoId)
      .single()

    if (error || !pedido) {
      return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 })
    }

    const cliente = (pedido as any).cliente
    const { data: empresaConfig } = await supabase.from('configuracion_empresa').select('*').single()
    const { data: marcasTbl } = await supabase.from('marcas').select('id, descripcion').eq('activo', true)
    const marcaDesc = new Map((marcasTbl ?? []).map((m: any) => [m.id, m.descripcion ?? '']))

    // Ítems válidos (mismo criterio que la emisión real)
    const items = ((pedido as any).detalle ?? []).filter(
      (d: any) => d.articulo && d.estado_item !== 'FALTANTE' && (d.cantidad ?? 0) > 0,
    )

    // Precios por línea (idéntico a generarComprobante)
    const lineas = items.map((d: any) => {
      const art = d.articulo
      const precioFinal = d.precio_final || 0                                   // con IVA
      const precioNeto  = d.precio_base > 0 ? d.precio_base : r2(precioFinal / (1 + IVA_RATE))
      const ivaUnit     = r2(precioFinal - precioNeto)
      return {
        cantidad: d.cantidad, precioFinal, precioNeto, ivaUnit, art,
        articulo_id: d.articulo_id,
      }
    })

    const pv = String(empresaConfig?.arca_punto_venta ?? 7).padStart(4, '0')
    const tipoFactura = determinarTipoFactura(cliente?.condicion_iva) ?? 'FA'
    const fecha = todayArgentina()

    const pedidoPDF = { numero_pedido: pedido.numero_pedido, condicion_entrega: (pedido as any).condicion_entrega }
    const articuloMeta = (art: any) => ({ descripcion: art.descripcion, sku: art.sku, marca_id: art.marca_id, descuento_propio: art.descuento_propio })

    // ── FACTURA: neto + IVA discriminado + percepciones ──
    const factDetalle = lineas.map((l: any) => ({
      articulo_id: l.articulo_id, descripcion: l.art.descripcion, sku: l.art.sku,
      cantidad: l.cantidad, precio_unitario: l.precioNeto, precio_total: r2(l.precioNeto * l.cantidad),
      articulos: articuloMeta(l.art),
    }))
    const factNeto = r2(lineas.reduce((s: number, l: any) => s + r2(l.precioNeto * l.cantidad), 0))
    const factIva  = r2(lineas.reduce((s: number, l: any) => s + r2(l.ivaUnit * l.cantidad), 0))
    const tasaIIBB = await resolverAlicuotaIIBB(supabase, cliente)
    const perc = calcularPercepciones(factNeto, { ...cliente, percepcion_iibb: tasaIIBB }, true)
    const factTotal = (Math.round(factNeto * 100) + Math.round(factIva * 100) + Math.round((perc.percepcion_iva + perc.percepcion_iibb) * 100)) / 100

    const factData = buildPDFData({
      comprobante: {
        id: 'preview', tipo_comprobante: tipoFactura, numero_comprobante: `${pv}-PREVIEW`,
        fecha, total_neto: factNeto, total_iva: factIva,
        percepcion_iva: perc.percepcion_iva, percepcion_iibb: perc.percepcion_iibb,
        total_factura: factTotal, cae: null, vencimiento_cae: null,
        observaciones: 'Vista previa — no es un comprobante emitido.', motivo_ajuste: null, qr_data_url: null,
      },
      cliente, empresa: empresaConfig, detalle: factDetalle, pedido: pedidoPDF, marcaDesc,
    })

    // ── PRESUPUESTO: precio final con IVA incluido, sin discriminar, sin percepciones ──
    const presDetalle = lineas.map((l: any) => ({
      articulo_id: l.articulo_id, descripcion: l.art.descripcion, sku: l.art.sku,
      cantidad: l.cantidad, precio_unitario: l.precioFinal, precio_total: r2(l.precioFinal * l.cantidad),
      articulos: articuloMeta(l.art),
    }))
    const presTotal = r2(lineas.reduce((s: number, l: any) => s + r2(l.precioFinal * l.cantidad), 0))

    const presData = buildPDFData({
      comprobante: {
        id: 'preview', tipo_comprobante: 'PRES', numero_comprobante: '0001-PREVIEW',
        fecha, total_neto: presTotal, total_iva: 0, percepcion_iva: 0, percepcion_iibb: 0,
        total_factura: presTotal, cae: null, vencimiento_cae: null,
        observaciones: 'Vista previa — no es un comprobante emitido.', motivo_ajuste: null, qr_data_url: null,
      },
      cliente, empresa: empresaConfig, detalle: presDetalle, pedido: pedidoPDF, marcaDesc,
    })

    const element = React.createElement(ComprobantesPreviewPDF, { presupuesto: presData, factura: factData }) as unknown as ReactElement<DocumentProps, JSXElementConstructor<DocumentProps>>
    const buffer = await renderToBuffer(element)

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="vista-previa-${pedido.numero_pedido ?? pedidoId}.pdf"`,
      },
    })
  } catch (err: any) {
    console.error('[preview] Error:', err)
    return NextResponse.json({ error: err.message || 'Error generando la vista previa' }, { status: 500 })
  }
}
