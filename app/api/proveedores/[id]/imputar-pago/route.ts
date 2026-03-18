import { nowArgentina, todayArgentina } from "@/lib/utils"
import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from "next/server";
import { requireAuth } from '@/lib/auth'

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    try {
        const { id: proveedorId } = await params;
        const body = await request.json();

        // 1. Extract and validate data
        // body: { fecha, monto_total, observaciones, imputaciones: [ { documento_id, monto_imputado } ] }
        const { fecha, monto_total, observaciones, imputaciones } = body;

        const supabase = createAdminClient();

        // 2. Create the PAGO movement in CC
        const { data: pagoMov, error: pagoError } = await supabase
            .from("cuenta_corriente_proveedores")
            .insert({
                proveedor_id: proveedorId,
                fecha: fecha || nowArgentina(),
                tipo_movimiento: 'pago',
                monto: -monto_total, // Payments are negative (CREDIT) in our debt-positive CC
                descripcion: `Pago: ${observaciones || ''}`,
                referencia_tipo: 'pago'
            })
            .select()
            .single();

        if (pagoError) throw pagoError;

        // 3. Process Imputations
        if (imputaciones && imputaciones.length > 0) {
            const imputacionesToInsert = imputaciones.map((imp: any) => ({
                id_movimiento_pago: pagoMov.id,
                id_movimiento_documento: imp.documento_id, // ID from cuenta_corriente_proveedores
                monto_imputado: imp.monto_imputado,
                fecha_imputacion: nowArgentina()
            }));

            const { error: impError } = await supabase
                .from("imputaciones_proveedores")
                .insert(imputacionesToInsert);

            if (impError) throw impError;
        }

        return NextResponse.json({ success: true, pago_id: pagoMov.id });

    } catch (error: any) {
        console.error("Error in imputar-pago:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
