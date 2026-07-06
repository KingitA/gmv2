import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireVendedor } from "@/lib/vendedor/session"

// GET /api/vendedor/cuentas-bancarias
// Cuentas destino para transferencias (requisito del contrato de cobro).
export async function GET() {
  const session = await requireVendedor()
  if (session.error) return session.error

  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("cuentas_bancarias")
      .select("id, banco, nombre, alias")
      .eq("activo", true)
      .order("banco")
    if (error) throw error
    return NextResponse.json({ cuentas: data ?? [] })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
