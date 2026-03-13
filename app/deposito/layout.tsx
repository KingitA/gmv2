"use client"

import { useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import Link from "next/link"

const MODULES = [
  { href: "/deposito/preparar-pedidos", label: "Preparar Pedidos", icon: "📦", color: "bg-blue-600 hover:bg-blue-700" },
  { href: "/deposito/recibir-mercaderia", label: "Recibir Mercadería", icon: "🚚", color: "bg-emerald-600 hover:bg-emerald-700" },
  { href: "/deposito/ajustar-stock", label: "Ajustar Stock", icon: "🔧", color: "bg-amber-600 hover:bg-amber-700" },
  { href: "/deposito/devoluciones", label: "Devoluciones", icon: "↩️", color: "bg-purple-600 hover:bg-purple-700" },
]

export default function DepositoLayout({ children }: { children: React.ReactNode }) {
  const [userName, setUserName] = useState("")
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()

  const isHome = pathname === "/deposito"

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push("/auth/login"); return }
      // Get display name from usuarios table or email
      supabase.from("usuarios").select("nombre").eq("id", user.id).single()
        .then(({ data }) => {
          setUserName(data?.nombre || user.email?.split("@")[0] || "Operario")
          setLoading(false)
        })
    })
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push("/auth/login")
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-white text-xl animate-pulse">Cargando...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          {!isHome && (
            <Link href="/deposito" className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center text-lg active:bg-gray-700">
              ←
            </Link>
          )}
          <div>
            <div className="text-xs text-gray-400 uppercase tracking-widest">GM Distribuidora</div>
            <div className="font-bold text-white text-lg leading-tight">Depósito</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-xs text-gray-400">Operario</div>
            <div className="text-sm font-semibold text-white">{userName}</div>
          </div>
          <button
            onClick={handleLogout}
            className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center text-gray-400 active:bg-gray-700"
          >
            ⏻
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        {isHome ? (
          <div className="p-6">
            <div className="mb-8 text-center">
              <div className="text-3xl font-bold text-white">Hola, {userName} 👋</div>
              <div className="text-gray-400 mt-1">¿Qué vas a hacer hoy?</div>
            </div>
            <div className="grid grid-cols-2 gap-4 max-w-lg mx-auto">
              {MODULES.map((mod) => (
                <Link
                  key={mod.href}
                  href={mod.href}
                  className={`${mod.color} rounded-2xl p-6 flex flex-col items-center justify-center gap-3 transition-all active:scale-95 min-h-[140px] shadow-lg`}
                >
                  <span className="text-4xl">{mod.icon}</span>
                  <span className="text-white font-bold text-center text-base leading-tight">{mod.label}</span>
                </Link>
              ))}
            </div>
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  )
}
