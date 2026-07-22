import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { generarYSubirRemitoPDF, type RemitoPDFData } from '@/lib/remitos/generar-remito'
import { REQUIERE_CAE } from '@/lib/arca/tipos'

/**
 * POST — regenera el PDF de un remito huérfano (estado_pdf != 'generado').
 * Re-renderiza desde la fila ya numerada de `remitos` + `remitos_detalle`:
 * misma numeración y mismo contenido, no viola la inmutabilidad.
 * Si el PDF ya está generado → 409 (el remito emitido jamás se reemplaza).
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const supabase = createAdminClient()
    const { id }   = await params

    const { data: remito, error } = await supabase
      .from('remitos')
      .select(`
        *,
        cliente:clientes(nombre_razon_social, cuit, direccion, localidad, condicion_iva),
        transporte_rel:transportes(nombre, cuit),
        comprobante:comprobantes_venta(tipo_comprobante, numero_comprobante),
        pedido:pedidos(numero_pedido),
        remitos_detalle(articulo_id, descripcion, cantidad, articulos(sku))
      `)
      .eq('id', id)
      .single()

    if (error || !remito) {
      return NextResponse.json({ error: 'Remito no encontrado' }, { status: 404 })
    }
    if (remito.estado_pdf === 'generado') {
      return NextResponse.json(
        { error: `El remito ${remito.numero_remito} ya tiene PDF generado. Los remitos emitidos son inmutables.` },
        { status: 409 },
      )
    }

    const esFiscal = REQUIERE_CAE.has(remito.comprobante?.tipo_comprobante ?? '') || remito.tipo_remito === 'REM'

    let empresa = null
    if (esFiscal && remito.tipo_remito === 'REM') {
      const { data } = await supabase
        .from('configuracion_empresa')
        .select('razon_social, cuit, direccion, telefono, condicion_iva, iibb, numero_iibb, inicio_actividades, logo_url')
        .single()
      empresa = data ?? null
    }

    const copias = remito.copias === 3
      ? ['ORIGINAL', 'DUPLICADO', 'TRIPLICADO']
      : ['ORIGINAL', 'DUPLICADO']

    const pdfData: RemitoPDFData = {
      remito: {
        id:                 remito.id,
        tipo_remito:        remito.tipo_remito,
        numero_remito:      remito.numero_remito,
        fecha:              remito.fecha,
        valor_declarado:    Number(remito.valor_declarado ?? 0),
        bultos:             remito.bultos ?? null,
        observaciones:      remito.observaciones ?? null,
        comprobante_numero: remito.comprobante?.numero_comprobante ?? null,
        comprobante_tipo:   remito.comprobante?.tipo_comprobante ?? null,
      },
      empresa,
      cliente: {
        nombre_razon_social: remito.cliente?.nombre_razon_social ?? '—',
        cuit:                remito.cliente?.cuit ?? null,
        direccion:           remito.cliente?.direccion ?? null,
        localidad:           remito.cliente?.localidad ?? null,
        condicion_iva:       remito.cliente?.condicion_iva ?? null,
      },
      transporte: remito.transporte_rel
        ? { nombre: remito.transporte_rel.nombre, cuit: remito.transporte_rel.cuit ?? null }
        : (remito.transporte ? { nombre: remito.transporte, cuit: null } : null),
      condicion_entrega: remito.condicion_entrega ?? '',
      copias,
      detalle: (remito.remitos_detalle ?? []).map((d: any) => ({
        sku:         d.articulos?.sku ?? null,
        descripcion: d.descripcion ?? '—',
        cantidad:    Number(d.cantidad ?? 0),
      })),
      numero_pedido: remito.pedido?.numero_pedido ?? null,
    }

    // upsert:true — reemplaza el archivo huérfano de una generación fallida.
    const { pdfUrl, pdfPath, pdfHash } = await generarYSubirRemitoPDF(supabase, remito.id, pdfData, { upsert: true })

    return NextResponse.json({ success: true, pdf_url: pdfUrl, pdf_path: pdfPath, pdf_hash: pdfHash })
  } catch (error: any) {
    console.error('[Remitos regenerar-pdf] Error:', error)
    return NextResponse.json({ error: error.message || 'Error regenerando PDF' }, { status: 500 })
  }
}
