import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';

// POST /api/comprobantes-compra/[id]/registrar-nc
// Body: { numero_comprobante, fecha_comprobante?, total?, tipo_comprobante?, imputar? }
// Confirma una NC 'esperada' cuando llega el documento real del proveedor
// (RPC ncp_registrar: valida, acredita CC, deja saldo imputable) y, si
// imputar=true y hay factura asociada, la aplica con ccp_imputar_credito.
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    try {
        const { id: nc_id } = await params;
        const body = await request.json();
        const { numero_comprobante, fecha_comprobante, total, total_neto, total_iva, tipo_comprobante, imputar } = body;

        const supabase = createAdminClient();

        const { data: nc } = await supabase
            .from('comprobantes_compra')
            .select('id, estado, comprobante_asociado_id, ajusta_stock, proveedor_id')
            .eq('id', nc_id)
            .maybeSingle();

        if (!nc) return NextResponse.json({ error: 'NC no encontrada' }, { status: 404 });
        if (nc.estado !== 'esperada') {
            return NextResponse.json({ error: `La NC está en estado ${nc.estado}, no 'esperada'` }, { status: 409 });
        }

        const { data: registro, error: regError } = await supabase.rpc('ncp_registrar', {
            p_nc_id: nc_id,
            p_datos: {
                numero_comprobante,
                fecha_comprobante,
                total,
                total_neto,
                total_iva,
                tipo_comprobante,
            },
            p_usuario_id: auth.user.id,
        });

        if (regError) {
            return NextResponse.json({ error: regError.message }, { status: 500 });
        }

        let imputacion = null;
        if (imputar && nc.comprobante_asociado_id) {
            const { data: imp, error: impError } = await supabase.rpc('ccp_imputar_credito', {
                p_credito_id: nc_id,
                p_debito_id: nc.comprobante_asociado_id,
                p_monto: null, // máximo imputable
                p_usuario_id: auth.user.id,
            });
            if (impError) {
                // La NC quedó registrada igual; la imputación puede hacerse a mano después
                console.warn('[registrar-nc] Imputación no aplicada:', impError.message);
                imputacion = { error: impError.message };
            } else {
                imputacion = imp;
            }
        }

        return NextResponse.json({ success: true, registro, imputacion });
    } catch (error: any) {
        console.error('[registrar-nc] Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
