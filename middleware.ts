import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

/**
 * MIDDLEWARE DE AUTENTICACION — ACTIVADO
 * Protege todas las rutas excepto las publicas (login, assets, webhooks, cron).
 * Redirige a /auth/login si el usuario no está autenticado.
 */
export async function middleware(request: NextRequest) {
    return await updateSession(request)
}

export const config = {
    matcher: [
        /*
         * Aplica middleware a todas las rutas EXCEPTO:
         * - _next/static (archivos estáticos de Next.js)
         * - _next/image (optimización de imágenes)
         * - favicon.ico, sitemap.xml, robots.txt
         * - Archivos de assets públicos (svg, png, jpg, etc.)
         * - /api/auth/* (endpoints de autenticación)
         * - /api/ai/gmail/webhook (webhook de Google, tiene su propia auth)
         * - /api/imports/webhook (webhook externo, tiene su propia auth)
         * - /api/cron/* (cron jobs, tienen su propia auth con CRON_SECRET)
         */
        '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$|api/auth|api/ai/gmail/webhook|api/imports/webhook|api/cron).*)',
    ],
}
