'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { createBrowserClient } from '@supabase/ssr'

interface NavItem {
  label: string
  href: string
  icon: string
}

interface NavSection {
  title: string
  items: NavItem[]
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Principal',
    items: [
      { label: 'Dashboard', href: '/', icon: '📊' },
      { label: 'Pedidos', href: '/clientes-pedidos', icon: '📦' },
    ],
  },
  {
    title: 'Ventas',
    items: [
      { label: 'Clientes', href: '/clientes', icon: '👥' },
      { label: 'Comprobantes Venta', href: '/comprobantes-venta', icon: '🧾' },
      { label: 'Viajes', href: '/viajes', icon: '🚚' },
      { label: 'Revisión Pagos', href: '/revision-pagos', icon: '💳' },
      { label: 'Revisión Devoluciones', href: '/revision-devoluciones', icon: '↩️' },
    ],
  },
  {
    title: 'Compras',
    items: [
      { label: 'Proveedores', href: '/proveedores', icon: '🏭' },
      { label: 'Órdenes de Compra', href: '/ordenes-compra', icon: '📋' },
      { label: 'Comprobantes Compra', href: '/comprobantes', icon: '📄' },
    ],
  },
  {
    title: 'Inventario',
    items: [
      { label: 'Artículos', href: '/articulos/precios', icon: '🏷️' },
    ],
  },
  {
    title: 'Finanzas',
    items: [
      { label: 'Panel Finanzas', href: '/finanzas', icon: '💵' },
    ],
  },
  {
    title: 'Configuración',
    items: [
      { label: 'Tablas', href: '/tablas', icon: '⚙️' },
      { label: 'Usuarios', href: '/usuarios-crm', icon: '👤' },
    ],
  },
  {
    title: 'Apps',
    items: [
      { label: 'App Depósito', href: '/deposito', icon: '🏭' },
    ],
  },
]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()

  // No mostrar sidebar en rutas de auth ni en app depósito
  const isAuthRoute = pathname?.startsWith('/auth')
  const isDepositoRoute = pathname?.startsWith('/deposito')
  if (isAuthRoute || isDepositoRoute) return null

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname?.startsWith(href)
  }

  const handleLogout = async () => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  return (
    <aside
      className="fixed top-0 left-0 bottom-0 z-50 w-[230px] flex flex-col"
      style={{ background: '#1a1d23' }}
    >
      {/* Logo */}
      <div className="px-5 py-4 border-b border-white/[0.08]">
        <Link href="/" className="block">
          <span className="text-white font-bold text-base tracking-tight block">GM Distribuidora</span>
          <span className="text-blue-400 text-[10px] font-semibold tracking-widest uppercase">Sistema ERP</span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title} className="mb-3">
            <div className="px-5 mb-1.5 text-[10px] uppercase tracking-[1.5px] text-white/25 font-semibold">
              {section.title}
            </div>
            <div className="px-3">
              {section.items.map((item) => {
                const active = isActive(item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2.5 px-3 py-[7px] my-[1px] rounded-lg text-[13px] font-medium transition-all
                      ${active
                        ? 'bg-blue-500/15 text-white'
                        : 'text-[#a0a4b0] hover:bg-white/[0.06] hover:text-[#d1d5db]'
                      }`}
                  >
                    <span className="text-[15px] w-[18px] text-center">{item.icon}</span>
                    <span className="truncate">{item.label}</span>
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-white/[0.08] p-3">
        <button
          onClick={handleLogout}
          className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors text-[13px] font-medium"
        >
          <LogOut className="h-4 w-4" />
          <span>Cerrar Sesión</span>
        </button>
      </div>
    </aside>
  )
}
