// Google OAuth — Start Flow
import { NextResponse } from 'next/server'
import { getAuthUrl } from '@/lib/ai/gmail'

export async function GET() {
    try {
        const authUrl = getAuthUrl()
        return NextResponse.redirect(authUrl)
    } catch (error) {
        console.error('Error generating Google auth URL:', error)
        return NextResponse.json(
            { error: 'Error al generar la URL de autenticación de Google' },
            { status: 500 }
        )
    }
}
