// Google OAuth — Start Flow
import { NextResponse, type NextRequest } from 'next/server'
import { getAuthUrl } from '@/lib/ai/gmail'
import { requireAuth, getUserRoles, tienePermiso } from '@/lib/auth'
import { armarEstado, conParametro, rutaInterna } from '@/lib/ai/gmail-vuelta'

/**
 * GET /api/auth/google?volver=/ruta — lleva a Google para conectar una cuenta de Gmail.
 *
 * SOLO ADMIN: el sistema lee y procesa el correo de todas las cuentas conectadas (sincronización
 * y avisos de Google), así que conectar una cuenta no es algo que pueda hacer cualquiera.
 * "volver" es la pantalla que lo pidió (solo rutas internas): ahí se muestra el resultado.
 */
export async function GET(request: NextRequest) {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const volver = rutaInterna(request.nextUrl.searchParams.get('volver'))
    const roles = await getUserRoles(auth.user.id)
    if (!tienePermiso(roles, 'conectar_gmail')) {
        return NextResponse.redirect(new URL(conParametro(volver, 'gmail_error', 'solo_admin'), request.url))
    }

    try {
        const authUrl = getAuthUrl(armarEstado(auth.user.id, volver))
        return NextResponse.redirect(authUrl)
    } catch (error) {
        console.error('Error generating Google auth URL:', error)
        return NextResponse.json(
            { error: 'Error al generar la URL de autenticación de Google' },
            { status: 500 }
        )
    }
}
