import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { nowArgentina } from '@/lib/utils';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    try {
        const { id: comprobante_id } = await params;
        const supabase = createAdminClient();

        // Get comprobante with details
        const { data: comprobante, error: compErr } = await supabase
            .from('comprobantes_compra')
            .select(`
                *,
                orden_compra:ordenes_compra(id, proveedor_id, numero_orden)
            `)
            .eq('id', comprobante_id)
            .single();

        if (compErr || !comprobante) return NextResponse.json({ error: 'Comprobante not found' }, { status: 404 });

        const proveedorId = comprobante.proveedor_id || (comprobante.orden_compra as any)?.proveedor_id;
        const ocId = (comprobante.orden_compra as any)?.id;

        // 1. Update kardex pendiente → confirmado for this OC
        if (ocId) {
            await supabase.from('kardex')
                .update({
                    estado: 'confirmado',
                    comprobante_compra_id: comprobante_id,
                    fecha: comprobante.fecha_comprobante || nowArgentina(),
                })
                .eq('orden_compra_id', ocId)
                .eq('estado', 'pendiente');
        }

        // 2. Mark comprobante as validated
        await supabase.from('comprobantes_compra').update({
            estado: 'validado',
            validado_por: auth.user.id,
            validado_at: nowArgentina(),
        }).eq('id', comprobante_id);

        // 3. Create vencimiento if fecha_vencimiento is set
        if (comprobante.fecha_vencimiento && comprobante.total_factura_declarado > 0) {
            try {
                await supabase.from('vencimientos').insert({
                    comprobante_compra_id: comprobante_id,
                    proveedor_id: proveedorId,
                    monto: comprobante.total_factura_declarado,
                    fecha_vencimiento: comprobante.fecha_vencimiento,
                    estado: 'pendiente',
                    descripcion: `${comprobante.tipo_comprobante} ${comprobante.numero_comprobante}`,
                });
            } catch (e: any) { console.warn('[Validar] vencimiento insert skipped:', e.message); }
        }

        // 4. Replace provisional CC entry: delete orden_compra provisional, insert real factura entry
        if (ocId && proveedorId) {
            await supabase.from('cuenta_corriente_proveedores')
                .delete()
                .eq('referencia_id', ocId)
                .eq('referencia_tipo', 'orden_compra');

            await supabase.from('cuenta_corriente_proveedores').insert({
                proveedor_id: proveedorId,
                tipo_movimiento: 'factura',
                monto: comprobante.total_factura_declarado || 0,
                descripcion: `${comprobante.tipo_comprobante} ${comprobante.numero_comprobante} — OC ${(comprobante.orden_compra as any)?.numero_orden}`,
                referencia_id: comprobante_id,
                referencia_tipo: 'comprobante_compra',
                fecha: comprobante.fecha_comprobante || nowArgentina(),
            });
        }

        return NextResponse.json({ success: true, comprobante_id });

    } catch (error: any) {
        console.error('[Validar Comprobante] Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
