"use client"

import { useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import Link from "next/link"

const MODULES = [
  {
    href: "/deposito/preparar-pedidos",
    label: "Preparar Pedidos",
    icon: "📦",
    desc: "Picking de órdenes de venta",
    color: "from-blue-600 to-blue-700",
    border: "border-blue-500/30",
  },
  {
    href: "/deposito/recibir-mercaderia",
    label: "Recibir Mercadería",
    icon: "🚚",
    desc: "Recepción contra órdenes de compra",
    color: "from-emerald-600 to-emerald-700",
    border: "border-emerald-500/30",
  },
  {
    href: "/deposito/ajustar-stock",
    label: "Ajustar Stock",
    icon: "🔧",
    desc: "Correcciones de inventario",
    color: "from-amber-600 to-amber-700",
    border: "border-amber-500/30",
  },
  {
    href: "/deposito/devoluciones",
    label: "Devoluciones",
    icon: "↩️",
    desc: "Recibir y clasificar devoluciones",
    color: "from-purple-600 to-purple-700",
    border: "border-purple-500/30",
  },
]

export default function DepositoLayout({ children }: { children: React.ReactNode }) {
  const [userName, setUserName] = useState("")
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()

  const isHome = pathname === "/deposito"
  const currentModule = MODULES.find(m => pathname?.startsWith(m.href))

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push("/auth/login"); return }
      supabase.from("usuarios").select("nombre").eq("id", user.id).single()
        .then(({ data }) => {
          setUserName(data?.nombre || user.email?.split("@")[0] || "Operario")
          setLoading(false)
        })
        .catch(() => {
          setUserName(user.email?.split("@")[0] || "Operario")
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
      <div style={{ minHeight: "100dvh", background: "#030712", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <div style={{ width: 44, height: 44, border: "4px solid #3b82f6", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          <div style={{ color: "#6b7280", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.15em" }}>Cargando...</div>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  return (
    <div style={{ minHeight: "100dvh", background: "#030712", color: "#f9fafb", display: "flex", flexDirection: "column", fontFamily: "'DM Sans', system-ui, sans-serif", marginLeft: 0 }}>
      {/* HEADER */}
      <header style={{ background: "#111827", borderBottom: "1px solid #1f2937", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {!isHome && (
            <Link href="/deposito" style={{ width: 44, height: 44, borderRadius: 14, background: "#1f2937", border: "1px solid #374151", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, textDecoration: "none", color: "#f9fafb" }}>
              ←
            </Link>
          )}
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.15em" }}>
              {isHome ? "GM Distribuidora" : "Depósito"}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#f9fafb", lineHeight: 1.2 }}>
              {isHome ? "Depósito" : (currentModule?.label || "Depósito")}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.1em" }}>Operario</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#f9fafb" }}>{userName}</div>
          </div>
          <button onClick={handleLogout} style={{ width: 44, height: 44, borderRadius: 14, background: "#1f2937", border: "1px solid #374151", display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af", cursor: "pointer" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          </button>
        </div>
      </header>

      {/* MAIN */}
      <main style={{ flex: 1, overflow: "auto" }}>
        {isHome ? (
          <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100dvh - 64px)" }}>
            <div style={{ padding: "28px 20px 20px" }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#f9fafb" }}>Hola, {userName} 👋</div>
              <div style={{ color: "#9ca3af", fontSize: 14, marginTop: 4 }}>¿Qué vas a hacer hoy?</div>
            </div>
            <div style={{ padding: "0 16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, flex: 1 }}>
              {MODULES.map((mod) => (
                <Link
                  key={mod.href}
                  href={mod.href}
                  style={{
                    textDecoration: "none",
                    background: "linear-gradient(135deg, var(--c1), var(--c2))",
                    borderRadius: 24,
                    padding: "20px 16px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    border: "1px solid rgba(255,255,255,0.08)",
                    minHeight: 155,
                    boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
                    // gradient via CSS var trick
                    ...(mod.href.includes("preparar") ? { "--c1": "#2563eb", "--c2": "#1d4ed8" } as any :
                        mod.href.includes("recibir") ? { "--c1": "#059669", "--c2": "#047857" } as any :
                        mod.href.includes("ajustar") ? { "--c1": "#d97706", "--c2": "#b45309" } as any :
                        { "--c1": "#7c3aed", "--c2": "#6d28d9" } as any),
                  }}
                >
                  <span style={{ fontSize: 32 }}>{mod.icon}</span>
                  <div>
                    <div style={{ color: "#fff", fontWeight: 700, fontSize: 15, lineHeight: 1.2 }}>{mod.label}</div>
                    <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 11, marginTop: 4, lineHeight: 1.4 }}>{mod.desc}</div>
                  </div>
                </Link>
              ))}
            </div>
            <div style={{ height: 24 }} />
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  )
}
