"use client"

import { useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import Link from "next/link"

const MODULES = [
  { href: "/deposito/preparar-pedidos", label: "Preparar Pedidos", icon: "📦", desc: "Picking de órdenes de venta", bg: "#fff7ed", accent: "#ea580c", border: "#fed7aa" },
  { href: "/deposito/recibir-mercaderia", label: "Recibir Mercadería", icon: "🚚", desc: "Recepción contra OC", bg: "#f0fdf4", accent: "#16a34a", border: "#bbf7d0" },
  { href: "/deposito/ajustar-stock", label: "Ajustar Stock", icon: "🔧", desc: "Correcciones de inventario", bg: "#fffbeb", accent: "#d97706", border: "#fde68a" },
  { href: "/deposito/devoluciones", label: "Devoluciones", icon: "↩️", desc: "Recibir devoluciones", bg: "#faf5ff", accent: "#9333ea", border: "#e9d5ff" },
]

function getBackHref(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean)
  if (parts.length <= 2) return "/deposito"
  return "/" + parts.slice(0, -1).join("/")
}

export default function DepositoLayout({ children }: { children: React.ReactNode }) {
  const [userName, setUserName] = useState("")
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()

  const isHome = pathname === "/deposito"
  const currentModule = MODULES.find(m => pathname?.startsWith(m.href))
  const backHref = getBackHref(pathname || "")

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push("/auth/login"); return }
      supabase.from("usuarios").select("nombre").eq("id", user.id).single()
        .then(({ data }) => setUserName(data?.nombre || user.email?.split("@")[0] || "Operario"))
        .catch(() => setUserName(user.email?.split("@")[0] || "Operario"))
        .finally(() => setLoading(false))
    })
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push("/auth/login")
  }

  const S = {
    root: { minHeight: "100dvh", background: "#f4f6f9", color: "#111827", display: "flex", flexDirection: "column" as const, fontFamily: "'DM Sans', system-ui, sans-serif" },
    header: { background: "#ffffff", borderBottom: "1px solid #e5e7eb", padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky" as const, top: 0, zIndex: 50, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" },
    backBtn: { width: 40, height: 40, borderRadius: 12, background: "#f3f4f6", border: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, textDecoration: "none", color: "#374151", flexShrink: 0 as const },
    logoutBtn: { width: 40, height: 40, borderRadius: 12, background: "#f3f4f6", border: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7280", cursor: "pointer", flexShrink: 0 as const },
    main: { flex: 1, overflow: "auto" },
  }

  if (loading) return (
    <div style={{ ...S.root, alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", gap: 12 }}>
        <div style={{ width: 40, height: 40, border: "3px solid #ea580c", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <div style={{ color: "#9ca3af", fontSize: 13 }}>Cargando...</div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  return (
    <div style={S.root}>
      <header style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {!isHome && (
            <Link href={backHref} style={S.backBtn}>‹</Link>
          )}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase" as const, letterSpacing: "0.12em" }}>
              {isHome ? "GM Distribuidora" : "Depósito"}
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#111827", lineHeight: 1.2 }}>
              {isHome ? "Depósito" : (currentModule?.label || "Depósito")}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ textAlign: "right" as const }}>
            <div style={{ fontSize: 10, color: "#9ca3af", textTransform: "uppercase" as const, letterSpacing: "0.1em" }}>Operario</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>{userName}</div>
          </div>
          <button onClick={handleLogout} style={S.logoutBtn}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          </button>
        </div>
      </header>

      <main style={S.main}>
        {isHome ? (
          <div style={{ padding: "24px 16px" }}>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#111827" }}>Hola, {userName} 👋</div>
              <div style={{ color: "#6b7280", fontSize: 14, marginTop: 2 }}>¿Qué vas a hacer hoy?</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {MODULES.map(mod => (
                <Link key={mod.href} href={mod.href} style={{ textDecoration: "none", background: mod.bg, borderRadius: 20, padding: "20px 16px", display: "flex", flexDirection: "column" as const, gap: 12, border: `1px solid ${mod.border}`, minHeight: 140, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                  <div style={{ width: 44, height: 44, borderRadius: 14, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
                    {mod.icon}
                  </div>
                  <div>
                    <div style={{ color: "#111827", fontWeight: 700, fontSize: 15, lineHeight: 1.2 }}>{mod.label}</div>
                    <div style={{ color: "#6b7280", fontSize: 12, marginTop: 3 }}>{mod.desc}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ) : children}
      </main>
    </div>
  )
}
