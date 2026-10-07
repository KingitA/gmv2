'use client'

// Barra principal del ERP: pestañas tipo explorador arriba + accesos de la
// pestaña activa. En celular las pestañas pasan a una barra inferior.
// Config en lib/navegacion.ts.

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { BarChart3, ChevronDown, Factory, LogOut, Settings, Smartphone, Tag, Users, Wallet } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  APPS, SECCIONES, accesoActivo, esRutaSinNav, hrefSeccion, puedeVer, seccionDeRuta, type Seccion,
} from '@/lib/navegacion'

const ICONOS: Record<Seccion['id'], React.ComponentType<{ className?: string }>> = {
  clientes: Users,
  proveedores: Factory,
  articulos: Tag,
  finanzas: Wallet,
  playroom: BarChart3,
  ajustes: Settings,
}

export function TopNav({ roles = [] }: { roles?: string[] }) {
  const pathname = usePathname()
  const router = useRouter()
  const [menuAbierto, setMenuAbierto] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuAbierto) return
    const cerrar = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuAbierto(false)
    }
    document.addEventListener('mousedown', cerrar)
    return () => document.removeEventListener('mousedown', cerrar)
  }, [menuAbierto])
  useEffect(() => setMenuAbierto(false), [pathname])

  const hasErpAccess = roles.includes('admin') || roles.includes('administrativo')
  if (esRutaSinNav(pathname) || !hasErpAccess) return null

  const secciones = SECCIONES.filter(s => puedeVer(s, roles))
  const activa = seccionDeRuta(pathname)
  const accesos = activa.accesos.filter(a => puedeVer(a, roles))
  const accesoSel = accesoActivo(activa, pathname)
  const apps = APPS.filter(a => puedeVer(a, roles))

  const handleLogout = async () => {
    await createClient().auth.signOut()
    router.push('/auth/login')
  }

  return (
    <>
      <header className="shrink-0 z-40 print:hidden">
        {/* Fila 1: marca + pestañas (en celular: marca + nombre de la pestaña) */}
        <div className="flex h-12 items-stretch gap-1 px-2 sm:px-3" style={{ background: '#1a1d23' }}>
          <Link href="/clientes-pedidos" className="flex flex-col justify-center pr-3 mr-1 border-r border-white/10 shrink-0">
            <span className="text-white font-bold text-sm leading-tight tracking-tight">GM</span>
            <span className="text-blue-400 text-[9px] font-semibold tracking-widest leading-tight">ERP</span>
          </Link>

          <nav className="hidden md:flex items-end gap-1 min-w-0 overflow-x-auto">
            {secciones.map(s => {
              const Icono = ICONOS[s.id]
              const sel = s.id === activa.id
              return (
                <Link
                  key={s.id}
                  href={hrefSeccion(s, roles)}
                  className={`flex items-center gap-2 h-10 px-4 rounded-t-lg text-[13px] font-semibold tracking-wide whitespace-nowrap transition-colors
                    ${sel ? 'bg-white text-slate-900' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}
                >
                  <Icono className="h-4 w-4" />
                  {s.label}
                </Link>
              )
            })}
          </nav>

          <div className="md:hidden flex items-center text-white font-semibold text-sm tracking-wide min-w-0 truncate">
            {activa.label}
          </div>

          {/* Menú del usuario: apps + cerrar sesión */}
          <div ref={menuRef} className="relative ml-auto flex items-center shrink-0">
            <button
              onClick={() => setMenuAbierto(v => !v)}
              className="flex items-center gap-1 h-9 px-3 rounded-md text-slate-300 hover:bg-white/10 hover:text-white text-xs font-medium"
              aria-label="Menú"
            >
              <Smartphone className="h-4 w-4" />
              <ChevronDown className="h-3 w-3" />
            </button>
            {menuAbierto && (
              <div className="absolute right-0 top-11 z-50 w-56 rounded-lg border bg-white py-1 shadow-xl">
                {apps.map(a => (
                  <Link key={a.href} href={a.href} className="block px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                    {a.label}
                  </Link>
                ))}
                {apps.length > 0 && <div className="my-1 border-t" />}
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50"
                >
                  <LogOut className="h-4 w-4" /> Cerrar sesión
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Fila 2: accesos de la pestaña activa */}
        {accesos.length > 0 && (
          <div className="flex h-10 items-center gap-1.5 overflow-x-auto border-b bg-white px-2 sm:px-4 [scrollbar-width:none]">
            {accesos.map(a => {
              const sel = a.href === accesoSel
              return (
                <Link
                  key={a.href}
                  href={a.href}
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors
                    ${sel ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  {a.label}
                </Link>
              )
            })}
          </div>
        )}
      </header>

      {/* Celular: pestañas abajo */}
      <nav
        className="md:hidden fixed inset-x-0 bottom-0 z-40 grid border-t bg-white print:hidden"
        style={{ gridTemplateColumns: `repeat(${secciones.length}, minmax(0, 1fr))`, paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {secciones.map(s => {
          const Icono = ICONOS[s.id]
          const sel = s.id === activa.id
          return (
            <Link
              key={s.id}
              href={hrefSeccion(s, roles)}
              className={`flex flex-col items-center justify-center gap-0.5 h-14 text-[10px] font-semibold ${sel ? 'text-blue-600' : 'text-slate-500'}`}
            >
              <Icono className="h-5 w-5" />
              <span className="truncate max-w-full px-0.5">{s.label}</span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
