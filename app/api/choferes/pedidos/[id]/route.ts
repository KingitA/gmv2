import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient();
    const { id } = await params;

    const { data: pedido, error } = await supabase
      .from('pedidos')
      .select(`
        id,
        numero_pedido,
        cliente_id,
        clientes!inner (
          razon_social
        )
      `)
      .eq('id', id)
      .single();

    if (error || !pedido) {
      console.error('[v0] Error fetching pedido:', error);
      return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 });
    }

    const cliente = Array.isArray(pedido.clientes) ? pedido.clientes[0] : pedido.clientes;

    return NextResponse.json({
      id: pedido.id,
      numero_pedido: pedido.numero_pedido,
      cliente_id: pedido.cliente_id,
      cliente_nombre: (cliente as any)?.razon_social,
    });
  } catch (error) {
    console.error('[v0] Error en API pedidos:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
