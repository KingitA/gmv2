import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { cargarOrdenCompleta } from '@/lib/compras/orden-completa';
import { datosEmpresa, excelDeOrden, nombreArchivoOrden, pdfDeOrden } from '@/lib/compras/orden-archivos';

// GET /api/ordenes-compra/[id]/pdf              → PDF de la orden
// GET /api/ordenes-compra/[id]/pdf?formato=xlsx → Excel de la orden
// GET …&ver=1                                   → se abre en el navegador en vez de descargarse
//
// Los dos archivos salen de la misma lectura de la orden que usan la pantalla y el mail al
// proveedor (lib/compras/orden-completa.ts): mismos precios, mismas unidades, mismo total,
// con la condición de pago y los impuestos reales (antes: IVA 21 % fijo y sin condición).
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    try {
        const { id: ordenId } = await params;
        const sp = new URL(request.url).searchParams;
        const formato = sp.get('formato') || 'pdf';
        const disposicion = sp.get('ver') === '1' ? 'inline' : 'attachment';
        const supabase = createAdminClient();

        const oc = await cargarOrdenCompleta(supabase, ordenId);
        if (!oc) return NextResponse.json({ error: 'Orden no encontrada' }, { status: 404 });
        const nombreBase = nombreArchivoOrden(oc.orden.numero_orden);

        if (formato === 'xlsx') {
            return new NextResponse(new Uint8Array(excelDeOrden(oc)), {
                headers: {
                    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'Content-Disposition': `attachment; filename="${nombreBase}.xlsx"`,
                },
            });
        }

        const buffer = await pdfDeOrden(oc, await datosEmpresa(supabase));
        return new NextResponse(new Uint8Array(buffer), {
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `${disposicion}; filename="${nombreBase}.pdf"`,
            },
        });
    } catch (error: any) {
        console.error('[OC PDF] Error:', error);
        return NextResponse.json({ error: error.message || 'Error interno' }, { status: 500 });
    }
}
