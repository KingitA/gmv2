import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from "next/server";
import { requireAuth } from '@/lib/auth'

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    const { id: proveedorId } = await params;

    const supabase = createAdminClient();

    try {
        // 1. Fetch Movements
        const { data: movimientos, error: movError } = await supabase
            .from("cuenta_corriente_proveedores")
            .select("*")
            .eq("proveedor_id", proveedorId)
            .order("fecha", { ascending: false });

        if (movError) throw movError;

        if (!movimientos || movimientos.length === 0) {
            return NextResponse.json({
                totales: { comprobantes: 0, facturado: 0, pagado: 0, saldo: 0 },
                comprobantes: []
            });
        }

        const movIds = movimientos.map(m => m.id);

        // 2. Fetch Imputations
        const { data: allImputaciones, error: impError } = await supabase
            .from("imputaciones_proveedores")
            .select("*")
            .or(`id_movimiento_pago.in.(${movIds.join(',')}),id_movimiento_documento.in.(${movIds.join(',')})`);

        if (impError) console.warn("Error fetching imputations:", impError);

        // 3. Calculate Balance and Totals
        let totalFacturado = 0;
        let totalPagado = 0;
        let saldoPendienteGlobal = 0;

        const formattedMovimientos = movimientos.map((mov: any) => {
            const tipo = mov.tipo_movimiento;
            let amount = Number(mov.monto);

            // Calculate settled amount from imputations
            const imputado = allImputaciones?.reduce((sum, imp) => {
                if (imp.id_movimiento_pago === mov.id || imp.id_movimiento_documento === mov.id) {
                    return sum + Number(imp.monto_imputado);
                }
                return sum;
            }, 0) || 0;

            const saldo_item = Math.abs(amount) - imputado;

            if (['pago', 'nota_credito'].includes(tipo)) {
                totalPagado += Math.abs(amount);
            } else if (tipo !== 'orden_compra') {
                totalFacturado += amount;
            }

            saldoPendienteGlobal += amount;

            return {
                id: mov.id,
                fecha: mov.fecha,
                tipo: tipo.replace('_', ' ').toUpperCase(),
                numero: mov.numero_comprobante || mov.descripcion,
                tipo_comprobante: mov.tipo_comprobante || null,
                vencimiento: mov.fecha_vencimiento || null,
                total: amount,
                saldo_pendiente: saldo_item,
                estado: (Math.abs(saldo_item) < 0.01) ? 'pagado' : 'pendiente'
            };
        });

        return NextResponse.json({
            totales: {
                comprobantes: movimientos.length,
                facturado: totalFacturado,
                pagado: totalPagado,
                saldo: saldoPendienteGlobal
            },
            comprobantes: formattedMovimientos
        });

    } catch (error: any) {
        console.error("Error fetching provider CC:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
