// Google OAuth — Start Flow
import { NextResponse } from 'next/server'
import { getAuthUrl } from '@/lib/ai/gmail'
import { requireAuth } from '@/lib/auth'

export async function GET() {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    try {
        const authUrl = getAuthUrl(auth.user.id)
        return NextResponse.redirect(authUrl)
    } catch (error) {
        console.error('Error generating Google auth URL:', error)
        return NextResponse.json(
            { error: 'Error al generar la URL de autenticación de Google' },
            { status: 500 }
        )
    }
}
