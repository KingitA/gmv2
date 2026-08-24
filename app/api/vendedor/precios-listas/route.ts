import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"

// GET /api/vendedor/precios-listas
// Listas de precio que este usuario puede consultar/comparar en el módulo
// PRECIOS: admin ve todas; un vendedor ve Neco más las listas que imponen
// sus viajantes (ej. Freije: FREIJE DANIEL → Viajante ⇒ Neco + Viajante).
export async function GET() {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const { data: listas } = await supabase
      .from("listas_precio")
      .select("id, nombre, codigo")
      .eq("activo", true)
      .order("nombre")

    const esAdmin = session.roles.includes("admin")
    const propias = new Set(session.vendedores.map((v) => v.lista_precio_id).filter(Boolean))
    const permitidas = (listas || []).filter(
      (l: any) => esAdmin || l.codigo === "neco" || propias.has(l.id)
    )

    return NextResponse.json({
      listas: permitidas,
      metodos: [
        { key: "Factura", label: "c/IVA" },
        { key: "Final", label: "Final" },
        { key: "Presupuesto", label: "Presup." },
      ],
    })
  } catch (error: any) {
    console.error("[vendedor] Error en GET /api/vendedor/precios-listas:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
