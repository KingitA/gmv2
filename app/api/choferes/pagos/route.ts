import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const body = await request.json();
    const {
      cliente_id,
      vendedor_id,
      fecha_pago,
      observaciones,
      detalles,
      imputaciones,
    } = body;

    // Validación básica
    if (!cliente_id || !detalles || detalles.length === 0) {
      return NextResponse.json(
        { error: 'Faltan datos requeridos' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Calcular monto total
    const montoTotal = detalles.reduce(
      (sum: number, detalle: any) => sum + Number(detalle.monto),
      0
    );

    // Crear el pago principal
    const { data: pago, error: pagoError } = await supabase
      .from('pagos_clientes')
      .insert({
        cliente_id,
        vendedor_id,
        fecha_pago,
        monto: montoTotal,
        observaciones,
        estado: 'pendiente',
        forma_pago: 'mixto', // Se ajustará según los detalles
      })
      .select()
      .single();

    if (pagoError) throw pagoError;

    // Crear los detalles de pago (formas de pago)
    const detallesPago = detalles.map((detalle: any) => ({
      pago_id: pago.id,
      tipo_pago: detalle.tipo_pago,
      monto: detalle.monto,
      numero_cheque: detalle.numero_cheque,
      banco: detalle.banco,
      fecha_cheque: detalle.fecha_cheque,
    }));

    const { error: detallesError } = await supabase
      .from('pagos_detalle')
      .insert(detallesPago);

    if (detallesError) throw detallesError;

    // Crear las imputaciones si existen
    if (imputaciones && imputaciones.length > 0) {
      const imputacionesData = imputaciones.map((imp: any) => ({
        pago_id: pago.id,
        comprobante_id: imp.comprobante_id,
        monto_imputado: imp.monto_imputado,
        tipo_comprobante: 'venta',
      }));

      const { error: imputacionesError } = await supabase
        .from('imputaciones')
        .insert(imputacionesData);

      if (imputacionesError) throw imputacionesError;
    }

    return NextResponse.json({
      success: true,
      pago_id: pago.id,
      monto_total: montoTotal,
    });
  } catch (error) {
    console.error('[API] Error creando pago:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
