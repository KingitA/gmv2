import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

/**
 * POST /api/proveedores/[id]/nc — alta STANDALONE de una nota de crédito
 * comercial (ej. "3% del trimestre") o Reversa (crédito canal negro), sin
 * orden de compra asociada. Crea la fila 'esperada' y la registra en el acto
 * vía ncp_registrar (CC del proveedor con monto negativo) — queda disponible
 * para descontar en la próxima OP.
 *
 * Body: { tipo (NC|NCA|NCB|NCC|Reversa), numero, fecha (YYYY-MM-DD),
 *         total, total_neto?, origen? (default descuento_fuera_factura),
 *         observaciones? }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  const { id } = await params
  try {
    const body = await request.json()
    const tipo = String(body.tipo || 'NC')
    const total = Number(body.total)
    if (!['NC', 'NCA', 'NCB', 'NCC', 'Reversa'].includes(tipo)) {
      return NextResponse.json({ error: 'tipo inválido (NC/NCA/NCB/NCC/Reversa)' }, { status: 400 })
    }
    if (!total || total <= 0) {
      return NextResponse.json({ error: 'total inválido' }, { status: 400 })
    }
    if (!body.fecha || !/^\d{4}-\d{2}-\d{2}$/.test(body.fecha)) {
      return NextResponse.json({ error: 'fecha inválida (YYYY-MM-DD)' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Reversa (canal negro) no discrimina IVA: neto = total. NC fiscal: neto
    // informado o total/1,21.
    const totalNeto = tipo === 'Reversa'
      ? total
      : Number(body.total_neto) > 0 ? Number(body.total_neto) : Math.round((total / 1.21) * 100) / 100

    const { data: nc, error: insErr } = await supabase
      .from('comprobantes_compra')
      .insert({
        proveedor_id: id,
        orden_compra_id: null,
        tipo_comprobante: tipo,
        estado: 'esperada',
        origen_nc: body.origen || 'descuento_fuera_factura',
        total_factura_declarado: 0,
        ajusta_stock: false,
      })
      .select('id')
      .single()
    if (insErr) throw insErr

    const { data: reg, error: regErr } = await supabase.rpc('ncp_registrar', {
      p_nc_id: nc.id,
      p_datos: {
        numero_comprobante: body.numero || null,
        fecha_comprobante: body.fecha,
        total,
        total_neto: totalNeto,
        total_iva: tipo === 'Reversa' ? 0 : Math.round((total - totalNeto) * 100) / 100,
        tipo_comprobante: tipo,
      },
      p_usuario_id: auth.user?.id ?? null,
    })
    if (regErr) {
      // rollback de la fila esperada para no dejar basura
      await supabase.from('comprobantes_compra').delete().eq('id', nc.id)
      return NextResponse.json({ error: regErr.message }, { status: 400 })
    }

    return NextResponse.json({ success: true, nc_id: nc.id, ...reg })
  } catch (error: any) {
    console.error('[proveedores/nc] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
