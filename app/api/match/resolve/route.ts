import { NextRequest, NextResponse } from 'next/server';
import { MatchingEngine } from '@/lib/matching/matcher';
import { requireAuth } from '@/lib/auth'

const engine = new MatchingEngine();

export async function POST(req: NextRequest) {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    try {
        const body = await req.json();
        const { item, provider_id } = body;

        if (!item || !provider_id) {
            return NextResponse.json({ error: "Missing item or provider_id" }, { status: 400 });
        }

        const start = Date.now();
        const result = await engine.resolveItem(item, provider_id);
        const duration = Date.now() - start;

        return NextResponse.json({
            result,
            meta: { duration_ms: duration }
        });
    } catch (error: any) {
        console.error("Match resolve error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
