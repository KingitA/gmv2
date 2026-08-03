import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

/**
 * GET /api/finanzas/proyeccion-retenciones — retención de Ganancias proyectada
 * por vencimiento pendiente (RPC ganancias_proyeccion_vencimientos, R4).
 * Devuelve un mapa { [vencimiento_id]: { retencion, neto, base } } para que
 * el panel muestre el neto real que va a salir de la caja.
 */
export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc('ganancias_proyeccion_vencimientos')
    if (error) throw error

    const mapa: Record<string, { retencion: number; neto: number; base: number }> = {}
    for (const r of (data as any[]) ?? []) {
      if (Number(r.retencion_proyectada) > 0) {
        mapa[r.vencimiento_id] = {
          retencion: Number(r.retencion_proyectada),
          neto: Number(r.neto_proyectado),
          base: Number(r.base),
        }
      }
    }
    return NextResponse.json({ proyeccion: mapa })
  } catch (error: any) {
    console.error('[finanzas/proyeccion-retenciones] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
