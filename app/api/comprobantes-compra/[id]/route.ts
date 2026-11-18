import { createAdminClient } from '@/lib/supabase/admin';
import { formatearNumeroComprobante } from '@/lib/services/numero-comprobante';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { revertirComprobanteOCR } from '@/lib/services/detalle';

// PATCH /api/comprobantes-compra/[id] — editar a mano los datos del comprobante
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    try {
        const { id } = await params;
        const body = await request.json();
        const supabase = createAdminClient();

        const { data: comp } = await supabase
            .from('comprobantes_compra')
            .select('id, estado')
            .eq('id', id)
            .maybeSingle();
        if (!comp) return NextResponse.json({ error: 'Comprobante no encontrado' }, { status: 404 });
        if (comp.estado === 'validado' || comp.estado === 'cerrado') {
            return NextResponse.json({ error: 'El comprobante ya fue validado — no se puede editar' }, { status: 409 });
        }

        const CAMPOS = [
            'tipo_comprobante', 'numero_comprobante', 'fecha_comprobante', 'fecha_vencimiento',
            'total_factura_declarado', 'total_neto', 'total_iva',
            'percepcion_iva_monto', 'percepcion_iibb_monto', 'retencion_ganancias_monto',
            'impuestos_internos', 'otros_impuestos',
            'descuento_fuera_factura', 'ajusta_stock',
        ];
        const cambios: Record<string, any> = {};
        for (const campo of CAMPOS) {
            if (campo in body) cambios[campo] = body[campo];
        }
        if (Object.keys(cambios).length === 0) {
            return NextResponse.json({ error: 'Nada para actualizar' }, { status: 400 });
        }
        // con el formato del papel: 0001-00008821
        if (typeof cambios.numero_comprobante === 'string') cambios.numero_comprobante = formatearNumeroComprobante(cambios.numero_comprobante);
        cambios.updated_at = new Date().toISOString();

        const { data, error } = await supabase
            .from('comprobantes_compra')
            .update(cambios)
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;

        return NextResponse.json({ success: true, comprobante: data });
    } catch (error: any) {
        console.error('[comprobante PATCH] Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}

// DELETE /api/comprobantes-compra/[id] — elimina el comprobante revirtiendo
// lo que su OCR aplicó (detalle + cantidades documentadas). Bloquea validados.
export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    try {
        const { id } = await params;
        const supabase = createAdminClient();

        // Documentos (foto o PDF) de los que se leyó este comprobante: se van con él. Antes quedaban
        // en la lista de archivos de la orden, sin comprobante, y al volver a subir el mismo archivo
        // aparecía dos veces.
        const { data: docs } = await supabase.from('recepciones_documentos').select('id, storage_path').eq('comprobante_id', id);

        const { error: revertError } = await revertirComprobanteOCR(supabase, id);
        if (revertError) {
            return NextResponse.json({ error: revertError }, { status: 409 });
        }

        let documentosQuitados = 0;
        for (const d of docs || []) {
            const { error: delErr } = await supabase.from('recepciones_documentos').delete().eq('id', d.id);
            if (delErr) { console.error('[comprobante DELETE] documento:', delErr.message); continue; }
            documentosQuitados++;
            if (d.storage_path) await supabase.storage.from('comprobantes').remove([d.storage_path]);
        }
        return NextResponse.json({ success: true, documentos_quitados: documentosQuitados });
    } catch (error: any) {
        console.error('[comprobante DELETE] Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
