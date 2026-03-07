import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { nowArgentina, todayArgentina } from "@/lib/utils"
import { requireAuth } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const searchParams = request.nextUrl.searchParams;
    const articuloId = searchParams.get('articulo_id');
    const clienteId = searchParams.get('cliente_id');
    const pedidoId = searchParams.get('pedido_id');

    if (!articuloId || !clienteId) {
      return NextResponse.json(
        { error: 'Faltan parámetros requeridos' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // 1. Buscar en el pedido actual
    if (pedidoId) {
      const { data: itemPedido } = await supabase
        .from('pedidos_detalle')
        .select('precio_final, cantidad')
        .eq('pedido_id', pedidoId)
        .eq('articulo_id', articuloId)
        .single();

      if (itemPedido) {
        return NextResponse.json({
          encontrado: true,
          precio: Number(itemPedido.precio_final) / Number(itemPedido.cantidad),
          origen: 'pedido_actual',
          fecha: todayArgentina(),
        });
      }
    }

    // 2. Buscar en la última factura del cliente
    const { data: ultimaVenta } = await supabase
      .from('comprobantes_venta_detalle')
      .select(`
        precio_unitario,
        comprobantes_venta!inner(
          fecha,
          cliente_id
        )
      `)
      .eq('articulo_id', articuloId)
      .eq('comprobantes_venta.cliente_id', clienteId)
      .order('comprobantes_venta(fecha)', { ascending: false })
      .limit(1)
      .single();

    if (ultimaVenta) {
      const comp = Array.isArray(ultimaVenta.comprobantes_venta)
        ? ultimaVenta.comprobantes_venta[0]
        : ultimaVenta.comprobantes_venta;

      return NextResponse.json({
        encontrado: true,
        precio: Number(ultimaVenta.precio_unitario),
        origen: 'ultima_factura',
        fecha: (comp as any)?.fecha,
      });
    }

    // 3. No se encontró el artículo
    return NextResponse.json({
      encontrado: false,
      mensaje: 'No le hemos vendido este artículo',
    });
  } catch (error) {
    console.error('[API] Error buscando último precio:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
