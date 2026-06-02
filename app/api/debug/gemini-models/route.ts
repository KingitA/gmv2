import { NextResponse } from 'next/server';

export async function GET() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not set' }, { status: 500 });

    const [v1Res, v1betaRes] = await Promise.all([
        fetch(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`),
        fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`),
    ]);
    const v1 = await v1Res.json();
    const v1beta = await v1betaRes.json();

    const embedModels = (data: any, version: string) =>
        (data.models || [])
            .filter((m: any) => m.supportedGenerationMethods?.includes('embedContent'))
            .map((m: any) => ({ name: m.name, displayName: m.displayName, version }));

    return NextResponse.json({
        embed_v1: embedModels(v1, 'v1'),
        embed_v1beta: embedModels(v1beta, 'v1beta'),
    });
}
