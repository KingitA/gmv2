import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/auth'

export async function POST(req: NextRequest) {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const auth = await requireAuth()
    if (auth.error) return auth.error
    try {
        const body = await req.json();
        const { import_item_id, reason } = body;

        if (!import_item_id) {
            return NextResponse.json({ error: "Missing import_item_id" }, { status: 400 });
        }

        // Update Import Item Status
        const { error } = await supabase
            .from('import_items')
            .update({
                status: 'rejected',
                match_details: { rejection_reason: reason, rejected_at: new Date() }
            })
            .eq('id', import_item_id);

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error("Match reject error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
