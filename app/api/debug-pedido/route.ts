import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
    const supabase = createAdminClient()
    const url = new URL(request.url)
    const numero = url.searchParams.get('numero') || '50'

    // get order ID first
    const { data: pedido, error: pe } = await supabase.from('pedidos').select('*').eq('numero_pedido', parseInt(numero)).single()

    if (pe || !pedido) {
        return NextResponse.json({ error: pe, pedido })
    }

    // get detalles
    const { data: detalles, error: pde } = await supabase.from('pedidos_detalle').select('*, articulos(*)').eq('pedido_id', pedido.id)

    return NextResponse.json({ pedido, detalles, pde })
}
