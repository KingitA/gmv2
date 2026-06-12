/**
 * GET /api/arca/huerfanos
 * Lista las solicitudes de CAE en estado 'huerfano': comprobantes que ARCA
 * autorizó pero cuyo insert local falló. Se recuperan con el endpoint de
 * reintento — NUNCA se vuelven a facturar.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('arca_solicitudes_cae')
      .select('id, tipo_comprobante, punto_venta, numero, cae, vencimiento_cae, importe, cliente_cuit, error_insert, created_at')
      .eq('estado', 'huerfano')
      .order('created_at', { ascending: false })

    if (error) throw error
    return NextResponse.json({ huerfanos: data ?? [] })
  } catch (err: any) {
    console.error('[arca/huerfanos] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
