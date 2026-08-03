import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import React, { type JSXElementConstructor, type ReactElement } from 'react'
import { OrdenPagoPDF, type OrdenPagoPDFData } from '@/lib/pdf/orden-pago-template'

/**
 * GET /api/ordenes-pago/[id]/pdf — PDF de la orden de pago con el detalle
 * completo: qué se paga (imputaciones), cómo (medios con cheques/transferencia/
 * efectivo), retenciones y neto. Se genera on-demand desde los datos.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  const { id } = await params
  try {
    const supabase = createAdminClient()

    const [{ data: op }, { data: empresa }] = await Promise.all([
      supabase
        .from('ordenes_pago')
        .select('*, proveedores(nombre, cuit, direccion, localidad), ordenes_pago_detalle(*), ordenes_pago_imputaciones(*)')
        .eq('id', id)
        .single(),
      supabase.from('configuracion_empresa').select('*').limit(1).single(),
    ])
    if (!op) return NextResponse.json({ error: 'Orden de pago no encontrada' }, { status: 404 })

    // Etiquetas de imputaciones (mismo resolver que el cálculo de retención)
    const { data: bases } = await supabase.rpc('op_ganancias_bases', {
      p_imputaciones: (op.ordenes_pago_imputaciones || []).map((i: any) => ({
        movimiento_cc_id: i.movimiento_cc_id,
        vencimiento_id: i.vencimiento_id,
        comprobante_compra_id: i.comprobante_compra_id,
        monto_imputado: i.monto_imputado,
      })),
    })

    const { data: cert } = await supabase
      .from('retenciones_emitidas')
      .select('numero_certificado')
      .eq('orden_pago_id', id)
      .eq('estado', 'emitida')
      .limit(1)
      .maybeSingle()

    const detalleMedio = (m: any): string => {
      if (m.medio === 'cheque' || m.medio === 'cheque_propio') {
        return [m.cheque_banco, m.cheque_numero ? `N° ${m.cheque_numero}` : null,
                m.cheque_fecha_vencimiento ? `vto ${m.cheque_fecha_vencimiento.split('-').reverse().join('/')}` : null]
          .filter(Boolean).join(' · ') || 'Cheque'
      }
      if (m.medio === 'transferencia') {
        return [m.banco_destino, m.cbu ? `CBU ${m.cbu}` : null,
                m.numero_transferencia ? `op. ${m.numero_transferencia}` : null]
          .filter(Boolean).join(' · ') || 'Transferencia bancaria'
      }
      return m.observaciones || '—'
    }

    const data: OrdenPagoPDFData = {
      empresa: {
        razon_social: empresa?.razon_social ?? '—',
        cuit: empresa?.cuit ?? '—',
        direccion: empresa?.direccion,
        logo_url: empresa?.logo_url,
        condicion_iva: empresa?.condicion_iva,
      },
      op: {
        numero_op: op.numero_op,
        fecha: op.fecha,
        estado: op.estado,
        observaciones: op.observaciones,
        monto_total: Number(op.monto_total ?? 0),
        retencion_ganancias: Number(op.retencion_ganancias ?? 0),
        total_retenciones: Number(op.total_retenciones ?? 0),
        neto_a_pagar: Number(op.neto_a_pagar ?? 0),
        numero_certificado: cert?.numero_certificado ?? null,
      },
      proveedor: {
        nombre: op.proveedores?.nombre ?? '—',
        cuit: op.proveedores?.cuit,
        direccion: op.proveedores?.direccion,
        localidad: op.proveedores?.localidad,
      },
      imputaciones: ((bases as any)?.detalle ?? []).map((b: any) => ({
        etiqueta: b.etiqueta,
        fecha: op.fecha,
        monto: Number(b.monto_imputado ?? 0),
      })),
      medios: (op.ordenes_pago_detalle ?? []).map((m: any) => ({
        medio: m.medio,
        monto: Number(m.monto ?? 0),
        detalle: detalleMedio(m),
      })),
    }

    const element = React.createElement(OrdenPagoPDF, { data }) as unknown as ReactElement<DocumentProps, JSXElementConstructor<DocumentProps>>
    const buffer = await renderToBuffer(element)

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="OP_${op.numero_op}.pdf"`,
      },
    })
  } catch (error: any) {
    console.error('[ordenes-pago/pdf] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
