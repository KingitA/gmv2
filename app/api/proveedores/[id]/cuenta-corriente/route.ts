import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from "next/server";
import { requireAuth } from '@/lib/auth'
import { fetchAllRows, fetchByIds } from '@/lib/supabase/fetch-all'

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
        const movimientos = await fetchAllRows(() => supabase
            .from("cuenta_corriente_proveedores")
            .select("*")
            .eq("proveedor_id", proveedorId)
            .order("fecha", { ascending: false }));

        if (movimientos.length === 0) {
            return NextResponse.json({
                totales: { comprobantes: 0, facturado: 0, pagado: 0, saldo: 0 },
                comprobantes: []
            });
        }

        const movIds = movimientos.map(m => m.id);

        // 2. Fetch Imputations (por tandas para evitar URLs gigantes)
        let allImputaciones: any[] = [];
        try {
            const [porPago, porDocumento] = await Promise.all([
                fetchByIds((chunk) => supabase
                    .from("imputaciones_proveedores")
                    .select("*")
                    .in("id_movimiento_pago", chunk), movIds),
                fetchByIds((chunk) => supabase
                    .from("imputaciones_proveedores")
                    .select("*")
                    .in("id_movimiento_documento", chunk), movIds),
            ]);
            const seen = new Set<string>();
            for (const imp of [...porPago, ...porDocumento]) {
                if (!seen.has(imp.id)) {
                    seen.add(imp.id);
                    allImputaciones.push(imp);
                }
            }
        } catch (impError) {
            console.warn("Error fetching imputations:", impError);
        }

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

            // FIX S4: los créditos (NC/pagos, monto negativo) mantienen su signo —
            // antes Math.abs() los mostraba como deuda positiva y la Nueva OP
            // los sumaba al pago en lugar de restarlos.
            const saldo_item = amount < 0
                ? Math.min(0, amount + imputado)      // crédito: consume hacia 0
                : amount - imputado;                  // débito: baja hacia 0

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
                estado: (Math.abs(saldo_item) < 0.01) ? 'pagado' : 'pendiente',
                referencia_id: mov.referencia_id || null,
                referencia_tipo: mov.referencia_tipo || null
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
