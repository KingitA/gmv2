import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getHomeForRoles } from "@/lib/role-utils"
import Link from "next/link"

export default async function SeleccionarModuloPage() {
  const h = await headers()
  const roles = h.get("x-user-roles")?.split(",").filter(Boolean) ?? []

  const tieneDeposito = roles.includes("deposito") || roles.includes("admin")
  const tieneChofer   = roles.includes("chofer")   || roles.includes("admin")

  // Si el usuario no necesita seleccionar módulo, redirigir directamente
  if (!(tieneDeposito && tieneChofer)) {
    const home = getHomeForRoles(roles) ?? "/auth/login"
    redirect(home)
  }

  return (
    <div style={{
      minHeight: "100dvh",
      background: "linear-gradient(135deg, #f8fafc 0%, #e0e7ff 100%)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'DM Sans', system-ui, sans-serif",
      padding: "24px",
    }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#1e293b", letterSpacing: "-0.02em" }}>GM Distribuidora</div>
          <div style={{ color: "#64748b", fontSize: 15, marginTop: 6 }}>¿A qué módulo vas a ingresar?</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Link href="/deposito" style={{
            textDecoration: "none",
            background: "#fff",
            borderRadius: 20,
            padding: "24px 20px",
            display: "flex",
            alignItems: "center",
            gap: 16,
            border: "2px solid #fed7aa",
            boxShadow: "0 4px 12px rgba(234,88,12,0.10)",
            transition: "transform 0.15s",
          }}>
            <div style={{ width: 52, height: 52, borderRadius: 16, background: "#fff7ed", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, flexShrink: 0 }}>🏭</div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 700, color: "#111827" }}>App Depósito</div>
              <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>Preparar pedidos, recibir mercadería</div>
            </div>
          </Link>

          <Link href="/chofer" style={{
            textDecoration: "none",
            background: "#fff",
            borderRadius: 20,
            padding: "24px 20px",
            display: "flex",
            alignItems: "center",
            gap: 16,
            border: "2px solid #bbf7d0",
            boxShadow: "0 4px 12px rgba(22,163,74,0.10)",
            transition: "transform 0.15s",
          }}>
            <div style={{ width: 52, height: 52, borderRadius: 16, background: "#f0fdf4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, flexShrink: 0 }}>🚚</div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 700, color: "#111827" }}>App Chofer</div>
              <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>Viajes, entregas y cobranzas</div>
            </div>
          </Link>
        </div>
      </div>
    </div>
  )
}
