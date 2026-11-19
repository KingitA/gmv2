import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from "next/server";
import { requirePermiso } from '@/lib/auth'
import { fetchAllRows, fetchByIds } from '@/lib/supabase/fetch-all'
import { armarExtracto, type OrdenPagoResumen } from '@/lib/proveedores/extracto-cc'
import { parseFecha } from '@/lib/formato'

/**
 * GET /api/proveedores/[id]/cuenta-corriente[?desde=AAAA-MM-DD&hasta=AAAA-MM-DD]
 *
 * Una sola fuente de saldo (E-56): los movimientos de cuenta_corriente_proveedores y
 * sus imputaciones. Devuelve:
 *   totales       saldo = suma de todos los movimientos (positivo = le debemos)
 *   comprobantes  cada movimiento con su saldo pendiente (lo usa la Nueva OP para tildar)
 *   extracto      E-68: cronológico con saldo corrido, cada orden de pago en UNA fila
 *                 (pago + retenciones) con sus medios; filtrable por fecha
 *   nc_esperadas  notas de crédito que el proveedor todavía nos debe mandar
 *   proveedor     nombre y CUIT (para el encabezado y la exportación)
 */

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    // Revisión 19/11: la cuenta corriente del proveedor muestra órdenes de pago, medios (CBU,
    // cheques) y certificados de retención: permiso de órdenes de pago (solo admin), no cualquier rol.
    const auth = await requirePermiso('ordenes_pago')
    if (auth.error) {
        if (auth.error.status !== 403) return auth.error
        return NextResponse.json({
            error: 'La cuenta corriente del proveedor (pagos, órdenes de pago, cheques y certificados de retención) la ven solo los administradores.',
            error_code: 'SIN_PERMISO', permiso: 'ordenes_pago',
        }, { status: 403 })
    }
    const { id: proveedorId } = await params;
    const sp = new URL(request.url).searchParams
    // parseFecha (lib/formato): devuelve AAAA-MM-DD o null si no es una fecha válida
    const desde = parseFecha(sp.get('desde')), hasta = parseFecha(sp.get('hasta'))

    const supabase = createAdminClient();

    try {
        // 1. Fetch Movements
        const movimientos = await fetchAllRows(() => supabase
            .from("cuenta_corriente_proveedores")
            .select("*")
            .eq("proveedor_id", proveedorId)
            .order("fecha", { ascending: false }));

        const [{ data: prov }, { data: esperadas }] = await Promise.all([
            supabase.from('proveedores').select('id, nombre, sigla, cuit').eq('id', proveedorId).maybeSingle(),
            supabase.from('comprobantes_compra')
                .select('id, tipo_comprobante, numero_comprobante, fecha_comprobante, total_factura_declarado, orden_compra_id, origen_nc')
                .eq('proveedor_id', proveedorId).eq('estado', 'esperada').order('fecha_comprobante', { ascending: true }),
        ])
        const ncEsperadas = (esperadas ?? []).map((c: any) => ({ ...c, total: Math.abs(Number(c.total_factura_declarado) || 0) }))

        if (movimientos.length === 0) {
            return NextResponse.json({
                totales: { comprobantes: 0, facturado: 0, pagado: 0, saldo: 0, comprometido: 0 },
                comprobantes: [],
                extracto: { filas: [], saldo_anterior: 0, saldo_final: 0, desde, hasta },
                nc_esperadas: ncEsperadas,
                proveedor: prov ?? null,
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
        let comprometido = 0;

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

            // Las provisiones de órdenes de compra (mercadería pedida, sin facturar) NO son deuda:
            // van aparte como "comprometido", fuera del saldo.
            if (tipo === 'orden_compra') comprometido += amount;
            else saldoPendienteGlobal += amount;

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

        // ── Extracto (E-68): órdenes de pago referenciadas, con medios y certificado ──
        const opIds = [...new Set(movimientos
            .filter((m: any) => (m.referencia_tipo === 'orden_pago' || m.referencia_tipo === 'orden_pago_anulacion') && m.referencia_id)
            .map((m: any) => m.referencia_id as string))]
        const ops = new Map<string, OrdenPagoResumen>()
        if (opIds.length) {
            const [filasOp, certs] = await Promise.all([
                fetchByIds((chunk) => supabase.from('ordenes_pago')
                    .select('id, numero_op, estado, neto_a_pagar, retencion_ganancias, total_retenciones, ordenes_pago_detalle(medio, monto, cheque_numero, cheque_banco, observaciones)')
                    .in('id', chunk), opIds),
                fetchByIds((chunk) => supabase.from('retenciones_emitidas')
                    .select('orden_pago_id, numero_certificado, estado').in('orden_pago_id', chunk), opIds),
            ])
            for (const o of filasOp as any[]) ops.set(o.id, o)
            for (const c of certs as any[]) {
                const o = ops.get(c.orden_pago_id)
                if (o && c.estado === 'emitida') o.numero_certificado = c.numero_certificado
            }
        }
        const ext = armarExtracto(movimientos as any[], ops, { desde, hasta })

        return NextResponse.json({
            totales: {
                comprobantes: movimientos.length,
                facturado: totalFacturado,
                pagado: totalPagado,
                saldo: Math.round(saldoPendienteGlobal * 100) / 100,
                comprometido: Math.round(comprometido * 100) / 100
            },
            comprobantes: formattedMovimientos,
            extracto: { filas: ext.filas, saldo_anterior: ext.saldoAnterior, saldo_final: ext.saldoFinal, desde, hasta },
            comprometido_oc: ext.comprometido,
            nc_esperadas: ncEsperadas,
            proveedor: prov ?? null,
        });

    } catch (error: any) {
        console.error("Error fetching provider CC:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
