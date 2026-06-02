import { NextResponse } from 'next/server';

// Temporary diagnostic endpoint — lists Gemini models available for this API key
// Hit GET /api/debug/gemini-models after deploy to find valid model names
export async function GET() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not set' }, { status: 500 });

    const [v1betaRes, v1Res] = await Promise.all([
        fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`),
        fetch(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`),
    ]);

    const v1beta = await v1betaRes.json();
    const v1 = await v1Res.json();

    const filterModels = (data: any) =>
        (data.models || [])
            .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
            .map((m: any) => ({ name: m.name, displayName: m.displayName }));

    return NextResponse.json({
        v1beta: filterModels(v1beta),
        v1: filterModels(v1),
        v1beta_error: v1beta.error || null,
        v1_error: v1.error || null,
    });
}
