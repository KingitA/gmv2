// Google OAuth — Callback
import { NextResponse, type NextRequest } from 'next/server'
import { exchangeCodeForTokens, setupGmailWatch } from '@/lib/ai/gmail'
import { requireAuth, getUserRoles, tienePermiso } from '@/lib/auth'
import { conParametro, leerEstado } from '@/lib/ai/gmail-vuelta'

// Después de Google se vuelve a la pantalla que pidió la conexión (viaja en "state", solo rutas
// internas): Órdenes de compra → Envío de órdenes, el asistente, etc. Ahí se muestra
// ?gmail_connected=cuenta o ?gmail_error=motivo.
export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')
    const error = searchParams.get('error')
    const { userId, volver } = leerEstado(searchParams.get('state'))
    const volverCon = (clave: string, valor: string) =>
        NextResponse.redirect(new URL(conParametro(volver, clave, valor), request.url))

    if (error) {
        console.error('Google OAuth error:', error)
        return volverCon('gmail_error', error)
    }
    if (!code) return volverCon('gmail_error', 'no_code')
    if (!userId) {
        console.error('Google OAuth callback: no user_id in state')
        return volverCon('gmail_error', 'no_user')
    }

    // Solo admin, y el mismo que lo pidió: esta ruta guarda la conexión, así que no alcanza con
    // esconder el botón. (El navegador vuelve de Google con la sesión del sistema.)
    const auth = await requireAuth()
    if (auth.error) return volverCon('gmail_error', 'sin_sesion')
    if (auth.user.id !== userId) return volverCon('gmail_error', 'otro_usuario')
    if (!tienePermiso(await getUserRoles(auth.user.id), 'conectar_gmail')) return volverCon('gmail_error', 'solo_admin')

    try {
        const { email } = await exchangeCodeForTokens(code, userId)
        console.log(`Google OAuth completo para: ${email} (usuario: ${userId})`)

        // Set up Gmail Push Notifications (Pub/Sub) automatically
        setupGmailWatch(email).catch(err => {
            console.error('[Gmail OAuth Callback] Error setting up watch:', err)
        })

        return volverCon('gmail_connected', email)
    } catch (err) {
        console.error('Error exchanging Google code for tokens:', err)
        return volverCon('gmail_error', 'token_exchange_failed')
    }
}
