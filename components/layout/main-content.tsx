'use client'

import { usePathname } from 'next/navigation'
import { TopNav } from '@/components/layout/top-nav'
import { esRutaSinNav } from '@/lib/navegacion'

// Estructura de pantalla del ERP: barra de pestañas fija arriba (TopNav) y el
// contenido scrollea en su propio contenedor (#erp-main), así los encabezados
// "sticky top-0" de cada pantalla quedan pegados debajo de la barra.
// Las apps (depósito, chofer, vendedor) y el login van sin barra, como siempre.
export function MainContent({ children, roles = [] }: { children: React.ReactNode; roles?: string[] }) {
  const pathname = usePathname()
  const hasErpAccess = roles.includes('admin') || roles.includes('administrativo')

  if (esRutaSinNav(pathname) || !hasErpAccess) {
    return <main className="min-h-screen">{children}</main>
  }

  return (
    <div className="erp-shell flex h-dvh flex-col">
      <TopNav roles={roles} />
      <main id="erp-main" className="relative flex-1 overflow-y-auto pb-16 md:pb-0">
        {children}
      </main>
    </div>
  )
}
