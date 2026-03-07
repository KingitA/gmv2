import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const body = await request.json();
    const { cliente_id, viaje_id, pedido_id, observaciones, items } = body;

    // Validación básica
    if (!cliente_id || !pedido_id || !items || items.length === 0) {
      return NextResponse.json({ error: 'Faltan datos requeridos' }, { status: 400 });
    }

    for (const item of items) {
      if (!item.motivo) {
        return NextResponse.json(
          { error: 'Todos los artículos deben tener un motivo de devolución' },
          { status: 400 }
        );
      }
      if (item.es_vendible === undefined || item.es_vendible === null) {
        return NextResponse.json(
          { error: 'Todos los artículos deben especificar si son vendibles' },
          { status: 400 }
        );
      }
    }

    const supabase = await createClient();

    // Calcular monto total
    let montoTotal = 0;
    for (const item of items) {
      const subtotal = Number(item.cantidad) * Number(item.precio_venta_original);
      montoTotal += subtotal;
    }

    const { data: ultimaDevolucion } = await supabase
      .from('devoluciones')
      .select('numero_devolucion')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    let numeroDevolucion = 'DEV-00001';
    if (ultimaDevolucion?.numero_devolucion) {
      const ultimoNumero = parseInt(ultimaDevolucion.numero_devolucion.split('-')[1]);
      numeroDevolucion = `DEV-${String(ultimoNumero + 1).padStart(5, '0')}`;
    }

    // Crear la devolución con estado inicial 'pendiente'
    const { data: devolucion, error: devolucionError } = await supabase
      .from('devoluciones')
      .insert({
        numero_devolucion: numeroDevolucion,
        cliente_id,
        viaje_id,
        pedido_id,
        observaciones,
        estado: 'pendiente',
        monto_total: montoTotal,
      })
      .select()
      .single();

    if (devolucionError) {
      console.error('[API] Error creando devolución:', devolucionError);
      throw devolucionError;
    }

    const detalles = items.map((item: any) => ({
      devolucion_id: devolucion.id,
      articulo_id: item.articulo_id,
      cantidad: item.cantidad,
      precio_venta_original: item.precio_venta_original,
      fecha_venta_original: item.fecha_venta_original,
      motivo: item.motivo,
      es_vendible: item.es_vendible,
    }));

    const { error: detallesError } = await supabase.from('devoluciones_detalle').insert(detalles);

    if (detallesError) {
      console.error('[API] Error creando detalle devolución:', detallesError);
      throw detallesError;
    }

    console.log(`[API] Devolución ${numeroDevolucion} registrada exitosamente por $${montoTotal}`);

    return NextResponse.json({
      success: true,
      devolucion_id: devolucion.id,
      numero_devolucion: numeroDevolucion,
      monto_total: montoTotal,
      estado: 'pendiente',
    });
  } catch (error) {
    console.error('[API] Error creando devolución:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
