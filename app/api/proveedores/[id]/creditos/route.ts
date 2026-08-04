import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

/**
 * GET /api/proveedores/[id]/creditos — créditos con saldo disponible del
 * proveedor (NC fiscales y Reversas de canal negro) para descontar en la
 * Nueva OP. saldo_pendiente negativo = crédito disponible.
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
    const { data, error } = await supabase
      .from('comprobantes_compra')
      .select('id, tipo_comprobante, numero_comprobante, fecha_comprobante, total_factura_declarado, total_neto, saldo_pendiente, origen_nc')
      .eq('proveedor_id', id)
      .eq('estado', 'validado')
      .in('tipo_comprobante', ['NC', 'NCA', 'NCB', 'NCC', 'Reversa'])
      .lt('saldo_pendiente', -0.01)
      .order('fecha_comprobante', { ascending: true })
    if (error) throw error

    return NextResponse.json({
      creditos: (data ?? []).map((c) => ({
        ...c,
        disponible: Math.abs(Number(c.saldo_pendiente)),
        es_fiscal: ['NC', 'NCA', 'NCB', 'NCC'].includes(c.tipo_comprobante), // fiscal = resta base de retención
      })),
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
