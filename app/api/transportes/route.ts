import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';

// GET /api/transportes — transportes activos con saldo de cuenta corriente
export async function GET() {
    const auth = await requireAuth();
    if (auth.error) return auth.error;

    const supabase = createAdminClient();

    const { data: transportes, error } = await supabase
        .from('transportes')
        .select('id, nombre, cuit, telefono, activo')
        .order('nombre');

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const { data: movs } = await supabase
        .from('cuenta_corriente_transportes')
        .select('transporte_id, monto');

    const saldos: Record<string, number> = {};
    for (const m of movs || []) {
        saldos[m.transporte_id] = (saldos[m.transporte_id] || 0) + Number(m.monto);
    }

    return NextResponse.json(
        (transportes || []).map((t: any) => ({ ...t, saldo: saldos[t.id] || 0 }))
    );
}
