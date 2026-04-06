// Endpoint dedicado para renovar watches de Gmail
// Se puede llamar manualmente o desde Vercel Cron
// Protegido con CRON_SECRET
import { NextResponse } from 'next/server'
import { getConnectedAccounts, renewWatchIfNeeded } from '@/lib/ai/gmail'

export async function GET(request: Request) {
    // Verificar autorización
    const authHeader = request.headers.get('authorization')
    if (
        process.env.CRON_SECRET &&
        authHeader !== `Bearer ${process.env.CRON_SECRET}`
    ) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('[Renew Watch] Forzando renovación de watches de Gmail...')

    try {
        // Obtener TODAS las cuentas conectadas (sin filtro de usuario)
        const accounts = await getConnectedAccounts()

        if (accounts.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No hay cuentas de Gmail conectadas',
                accounts: 0,
            })
        }

        const results: { email: string; renewed: boolean; error?: string }[] = []

        for (const email of accounts) {
            try {
                const renewed = await renewWatchIfNeeded(email)
                results.push({ email, renewed })
                console.log(`[Renew Watch] ${email}: ${renewed ? '✅ renovado/ok' : '❌ falló'}`)
            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : 'Error desconocido'
                console.error(`[Renew Watch] Error para ${email}:`, errorMsg)
                results.push({ email, renewed: false, error: errorMsg })
            }
        }

        return NextResponse.json({
            success: true,
            accounts: results.length,
            results,
            timestamp: new Date().toISOString(),
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Error desconocido'
        console.error('[Renew Watch] Error fatal:', error)
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
