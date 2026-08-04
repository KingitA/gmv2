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

        // 1. Update kardex pendiente → confirmado for this OC.
        // En OC mixtas (parte factura, parte adquisición de stock) cada
        // comprobante confirma solo las líneas de su régimen: una factura
        // confirma lo blanco, una adquisición lo negro; 'mixto' con cualquiera.
        if (ocId) {
            const esAdquisicion = ['Adquisicion', 'Reversa'].includes(comprobante.tipo_comprobante);
            const { data: pendientes } = await supabase.from('kardex')
                .select('id, articulo_iva_compras')
                .eq('orden_compra_id', ocId)
                .eq('estado', 'pendiente');

            const idsAConfirmar = (pendientes || [])
                .filter((k: any) => {
                    const regimen = k.articulo_iva_compras;
                    if (!regimen || regimen === 'mixto') return true;
                    return esAdquisicion ? regimen === 'adquisicion_stock' : regimen === 'factura';
                })
                .map((k: any) => k.id);

            if (idsAConfirmar.length > 0) {
                await supabase.from('kardex')
                    .update({
                        estado: 'confirmado',
                        comprobante_compra_id: comprobante_id,
                        fecha: comprobante.fecha_comprobante || nowArgentina(),
                        color_dinero: esAdquisicion ? 'NEGRO' : 'BLANCO',
                    })
                    .in('id', idsAConfirmar);
            }

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

        // 2. Mark comprobante as validated (con saldo para el circuito de imputación NC)
        const esCredito = ['NC', 'NCA', 'NCB', 'NCC', 'Reversa'].includes(comprobante.tipo_comprobante);
        const total = comprobante.total_factura_declarado || 0;
        await supabase.from('comprobantes_compra').update({
            estado: 'validado',
            validado_por: auth.user.id,
            validado_at: nowArgentina(),
            saldo_pendiente: esCredito ? -total : total,
            estado_pago: 'pendiente',
        }).eq('id', comprobante_id);

        // 3. Replace provisional CC entry: delete orden_compra provisional, insert real entry
        let ccMovId: string | null = null;
        if (ocId && proveedorId) {
            await supabase.from('cuenta_corriente_proveedores')
                .delete()
                .eq('referencia_id', ocId)
                .eq('referencia_tipo', 'orden_compra');

            const { data: ccMov } = await supabase.from('cuenta_corriente_proveedores').insert({
                proveedor_id: proveedorId,
                tipo_movimiento: esCredito ? 'nota_credito' : 'factura',
                monto: esCredito ? -total : total,
                descripcion: `${comprobante.tipo_comprobante} ${comprobante.numero_comprobante} — OC ${(comprobante.orden_compra as any)?.numero_orden}`,
                referencia_id: comprobante_id,
                referencia_tipo: 'comprobante_compra',
                numero_comprobante: comprobante.numero_comprobante,
                tipo_comprobante: comprobante.tipo_comprobante,
                fecha: comprobante.fecha_comprobante || nowArgentina(),
            }).select('id').single();
            ccMovId = ccMov?.id || null;
        }

        // 4. Create vencimiento (solo débitos). Si el comprobante no trae
        // fecha_vencimiento (típico OCR), calcularla con los días del proveedor.
        // Referenciado por movimiento de CC (referencia_tipo='cuenta_corriente'),
        // que es como op_confirmar los marca pagados.
        if (!esCredito) {
            // ── Vencimiento automático según el acuerdo de pago del CANAL ──
            // (Ficha Fiscal del proveedor, fase S3). Adquisición = canal negro.
            const canal = comprobante.tipo_comprobante === 'Adquisicion' ? 'negro' : 'blanco';
            let fechaVencimiento = comprobante.fecha_vencimiento;
            let formaPago: string | null = null;
            let modalidad: string | null = null;
            let fechaValidez: string | null = null;

            if (proveedorId) {
                const { data: prov } = await supabase
                    .from('proveedores')
                    .select('dias_vencimiento, pago_blanco_medio, pago_blanco_plazo_cheque, pago_blanco_entrega, pago_blanco_dias, pago_blanco_desde, pago_negro_medio, pago_negro_plazo_cheque, pago_negro_entrega, pago_negro_dias, pago_negro_desde')
                    .eq('id', proveedorId)
                    .maybeSingle();
                const p: any = prov || {};
                // Canal negro sin configurar → hereda el acuerdo blanco
                const cfg = canal === 'negro' && (p.pago_negro_medio || p.pago_negro_dias != null || p.pago_negro_entrega)
                    ? { medio: p.pago_negro_medio, plazoCheque: p.pago_negro_plazo_cheque, entrega: p.pago_negro_entrega, dias: p.pago_negro_dias, desde: p.pago_negro_desde }
                    : { medio: p.pago_blanco_medio, plazoCheque: p.pago_blanco_plazo_cheque, entrega: p.pago_blanco_entrega, dias: p.pago_blanco_dias, desde: p.pago_blanco_desde };

                // Medio → forma_pago del vencimiento (cheques y mixto = 'cheque')
                formaPago = cfg.medio === 'transferencia' ? 'transferencia'
                    : cfg.medio === 'efectivo' ? 'efectivo'
                    : (cfg.medio === 'cheques' || cfg.medio === 'cheques_y_efectivo') ? 'cheque'
                    : null;
                // Entrega → modalidad
                modalidad = cfg.entrega === 'deposito_bancario' ? 'deposito'
                    : cfg.entrega === 'retira_oficina' ? 'entrega'
                    : cfg.entrega === 'envio_grimar' ? 'grimar'
                    : null;

                if (!fechaVencimiento) {
                    // Base del plazo: fecha de factura o de recepción según el acuerdo
                    let fechaBase: string | null = comprobante.fecha_comprobante || null;
                    if (cfg.desde === 'recepcion' && ocId) {
                        const { data: rec } = await supabase
                            .from('recepciones')
                            .select('fecha_fin, fecha_inicio, created_at')
                            .eq('orden_compra_id', ocId)
                            .order('created_at', { ascending: false })
                            .limit(1)
                            .maybeSingle();
                        const f = (rec as any)?.fecha_fin || (rec as any)?.fecha_inicio || (rec as any)?.created_at;
                        if (f) fechaBase = String(f).slice(0, 10);
                    }
                    const dias = Number(cfg.dias ?? p.dias_vencimiento ?? 0);
                    if (fechaBase && dias > 0) {
                        const base = new Date(fechaBase + 'T00:00:00');
                        base.setDate(base.getDate() + dias);
                        fechaVencimiento = base.toISOString().slice(0, 10);
                        await supabase.from('comprobantes_compra')
                            .update({ fecha_vencimiento: fechaVencimiento })
                            .eq('id', comprobante_id);
                    }
                }
                // Cheques con plazo: validez = vencimiento + plazo del cheque
                if (fechaVencimiento && formaPago === 'cheque' && Number(cfg.plazoCheque ?? 0) > 0) {
                    const v = new Date(fechaVencimiento + 'T00:00:00');
                    v.setDate(v.getDate() + Number(cfg.plazoCheque));
                    fechaValidez = v.toISOString().slice(0, 10);
                }
            }

            if (fechaVencimiento && total > 0) {
                const { error: vencErr } = await supabase.from('vencimientos').insert({
                    proveedor_id: proveedorId,
                    tipo: 'factura',
                    canal,
                    concepto: `${comprobante.tipo_comprobante} ${comprobante.numero_comprobante} — OC ${(comprobante.orden_compra as any)?.numero_orden || ''}`,
                    monto: total,
                    fecha_vencimiento: fechaVencimiento,
                    estado: 'pendiente',
                    forma_pago: formaPago,
                    modalidad,
                    fecha_validez: fechaValidez,
                    referencia_id: ccMovId || comprobante_id,
                    referencia_tipo: ccMovId ? 'cuenta_corriente' : 'comprobante_compra',
                });
                if (vencErr) console.warn('[Validar] vencimiento insert skipped:', vencErr.message);
            }
        }

        return NextResponse.json({ success: true, comprobante_id });

    } catch (error: any) {
        console.error('[Validar Comprobante] Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
