import { createAdminClient } from '@/lib/supabase/admin';
import { formatearNumeroComprobante } from '@/lib/services/numero-comprobante';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { parseFecha } from '@/lib/formato';
import { buscarComprobanteDuplicado, mensajeDuplicado } from '@/lib/services/documento-compra';

const TIPOS = ['FA', 'FB', 'FC', 'Adquisicion', 'Remito', 'Reversa', 'NC', 'NCA', 'NCB', 'NCC', 'ND', 'NDA', 'NDB', 'NDC'];

// POST /api/ordenes-compra/[id]/comprobantes
// Cargar un comprobante A MANO en la orden (E-95): para cuando la lectura automática falló
// o no hay foto. Crea solo la cabecera; los renglones se agregan después con "+".
// Body: { tipo_comprobante, numero_comprobante, fecha_comprobante, total_factura_declarado,
//         total_neto, total_iva, percepcion_iva_monto, percepcion_iibb_monto, documento_id? }
// `documento_id`: el documento "no leído" al que corresponde (queda vinculado y deja de
// figurar como pendiente de leer).
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    try {
        const { id: ordenId } = await params;
        const body = await request.json().catch(() => ({}));
        const supabase = createAdminClient();

        const { data: oc } = await supabase.from('ordenes_compra').select('id, proveedor_id, estado').eq('id', ordenId).maybeSingle();
        if (!oc) return NextResponse.json({ error: 'Orden de compra no encontrada' }, { status: 404 });
        if (['finalizada', 'cancelada'].includes(oc.estado)) return NextResponse.json({ error: 'La orden está cerrada: no se le pueden cargar comprobantes.' }, { status: 409 });

        const tipo = String(body.tipo_comprobante || '');
        // con el formato del papel: 0001-00008821
        const numero = formatearNumeroComprobante(String(body.numero_comprobante || '').trim());
        const fecha = parseFecha(body.fecha_comprobante);
        if (!TIPOS.includes(tipo)) return NextResponse.json({ error: 'Elegí el tipo de comprobante.' }, { status: 400 });
        if (!numero) return NextResponse.json({ error: 'Falta el número del comprobante.' }, { status: 400 });
        if (!fecha) return NextResponse.json({ error: 'Falta la fecha del comprobante.' }, { status: 400 });
        const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v) * 100) / 100 : 0);
        const total = num(body.total_factura_declarado);
        if (tipo !== 'Remito' && !(total > 0)) return NextResponse.json({ error: 'Falta el total del comprobante.' }, { status: 400 });

        const dup = await buscarComprobanteDuplicado(supabase, { proveedor_id: oc.proveedor_id, tipo, numero });
        if (dup) return NextResponse.json({ error: mensajeDuplicado(dup, ordenId), codigo: 'comprobante_duplicado', comprobante_id: dup.id }, { status: 409 });

        // Documento al que corresponde (opcional): tiene que ser de esta orden y no tener comprobante
        let doc: any = null;
        if (body.documento_id) {
            const { data } = await supabase.from('recepciones_documentos').select('id, recepcion_id, comprobante_id, url_imagen').eq('id', body.documento_id).maybeSingle();
            const { data: rec } = data ? await supabase.from('recepciones').select('orden_compra_id').eq('id', data.recepcion_id).maybeSingle() : { data: null };
            if (data && rec?.orden_compra_id === ordenId && !data.comprobante_id) doc = data;
        }

        const neto = num(body.total_neto);
        const iva = num(body.total_iva);
        const percIva = num(body.percepcion_iva_monto);
        const percIibb = num(body.percepcion_iibb_monto);
        const internos = num(body.impuestos_internos);
        const otros = num(body.otros_impuestos);
        const { data: comp, error } = await supabase.from('comprobantes_compra').insert({
            orden_compra_id: ordenId,
            proveedor_id: oc.proveedor_id,
            tipo_comprobante: tipo,
            numero_comprobante: numero,
            fecha_comprobante: fecha,
            total_factura_declarado: total,
            total_neto: neto,
            total_iva: iva,
            percepcion_iva_monto: percIva,
            percepcion_iibb_monto: percIibb,
            impuestos_internos: internos,
            otros_impuestos: otros,
            total_calculado: neto + iva + percIva + percIibb + internos + otros,
            foto_url: doc?.url_imagen || null,
            estado: 'pendiente_recepcion',
            ajusta_stock: true,
            descuento_fuera_factura: 0,
        }).select().single();
        if (error) return NextResponse.json({ error: `No se pudo crear el comprobante. Detalle para sistemas: ${error.message}` }, { status: 500 });

        if (doc) await supabase.from('recepciones_documentos').update({ comprobante_id: comp.id }).eq('id', doc.id);

        return NextResponse.json({ success: true, comprobante: comp });
    } catch (error: any) {
        console.error('[OC comprobante a mano] Error:', error);
        return NextResponse.json({ error: `No se pudo crear el comprobante. Detalle para sistemas: ${error.message || error}` }, { status: 500 });
    }
}
