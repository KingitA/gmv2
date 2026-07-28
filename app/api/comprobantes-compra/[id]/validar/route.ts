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

            // 1b. Revalorizar kardex ingresado a $0 (flujo depósito sin factura):
            // usar los precios del detalle de este comprobante.
            const { data: detalle } = await supabase
                .from('comprobantes_compra_detalle')
                .select('articulo_id, precio_unitario, descuento1')
                .eq('comprobante_id', comprobante_id)
                .not('articulo_id', 'is', null);

            if (detalle && detalle.length > 0) {
                // El kardex de depósito lleva recepcion_id (no orden_compra_id)
                const { data: recs } = await supabase
                    .from('recepciones').select('id').eq('orden_compra_id', ocId);
                const recIds = (recs || []).map((r: any) => r.id);

                const orFilter = recIds.length > 0
                    ? `orden_compra_id.eq.${ocId},recepcion_id.in.(${recIds.join(',')})`
                    : `orden_compra_id.eq.${ocId}`;

                const { data: kardexCero } = await supabase
                    .from('kardex')
                    .select('id, articulo_id, cantidad')
                    .or(orFilter)
                    .eq('tipo_movimiento', 'compra')
                    .eq('precio_unitario_final', 0);

                for (const k of kardexCero || []) {
                    const det = detalle.find((d: any) => d.articulo_id === k.articulo_id);
                    if (!det) continue;
                    const precio = Number(det.precio_unitario || 0) * (1 - Number(det.descuento1 || 0) / 100);
                    if (precio <= 0) continue;
                    const cantidad = Number(k.cantidad || 0);
                    await supabase.from('kardex').update({
                        precio_lista: det.precio_unitario,
                        precio_unitario_final: precio,
                        subtotal_neto: Math.round(precio * cantidad * 100) / 100,
                        subtotal_total: Math.round(precio * cantidad * 100) / 100,
                        comprobante_compra_id: comprobante_id,
                    }).eq('id', k.id);
                }
            }
        }

        // 2. Mark comprobante as validated
        await supabase.from('comprobantes_compra').update({
            estado: 'validado',
            validado_por: auth.user.id,
            validado_at: nowArgentina(),
        }).eq('id', comprobante_id);

        // 3. Create vencimiento. Si el comprobante no trae fecha_vencimiento
        // (típico de los creados por OCR), calcularla con los días de pago del proveedor.
        let fechaVencimiento = comprobante.fecha_vencimiento;
        if (!fechaVencimiento && proveedorId && comprobante.fecha_comprobante) {
            const { data: prov } = await supabase
                .from('proveedores')
                .select('dias_vencimiento')
                .eq('id', proveedorId)
                .maybeSingle();
            const dias = Number(prov?.dias_vencimiento || 0);
            if (dias > 0) {
                const base = new Date(comprobante.fecha_comprobante + 'T00:00:00');
                base.setDate(base.getDate() + dias);
                fechaVencimiento = base.toISOString().slice(0, 10);
                await supabase.from('comprobantes_compra')
                    .update({ fecha_vencimiento: fechaVencimiento })
                    .eq('id', comprobante_id);
            }
        }
        if (fechaVencimiento && comprobante.total_factura_declarado > 0) {
            try {
                await supabase.from('vencimientos').insert({
                    comprobante_compra_id: comprobante_id,
                    proveedor_id: proveedorId,
                    monto: comprobante.total_factura_declarado,
                    fecha_vencimiento: fechaVencimiento,
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
