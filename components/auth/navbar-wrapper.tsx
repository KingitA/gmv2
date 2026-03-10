'use client'

import { usePathname } from 'next/navigation'

/**
 * Oculta su contenido (navbar, chat widget) en rutas de autenticación.
 */
export function NavbarWrapper({ children }: { children: React.ReactNode }) {
    const pathname = usePathname()
    const isAuthRoute = pathname?.startsWith('/auth')

    // No mostrar navbar ni chat widget en rutas de login
    if (isAuthRoute) return null
    return <>{children}</>
}
