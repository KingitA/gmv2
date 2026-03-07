import { nowArgentina, todayArgentina } from "@/lib/utils"
import { createClient } from '@/lib/supabase/server';
import { type NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireAuth();
    if (auth.error) return auth.error;
    try {
        const supabase = await createClient();
        const { id } = await params;

        // Aquí iría la lógica de envío al ERP. Por ahora solo actualizamos el estado.
        const { data, error } = await supabase
            .from('pedidos')
            .update({
                estado: 'cerrado', // o el estado que represente "confirmado en ERP"
                fecha_cierre: nowArgentina(),
            })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        // TODO: integrar llamada real al ERP (webhook, API, etc.)
        return NextResponse.json({ success: true, pedido: data });
    } catch (err: any) {
        console.error('[v0] Error cerrando pedido:', err);
        return NextResponse.json({ error: err.message || 'Error cerrando pedido' }, { status: 500 });
    }
}
