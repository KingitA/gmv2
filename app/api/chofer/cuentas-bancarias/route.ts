import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

// GET /api/chofer/cuentas-bancarias — cuentas destino para una transferencia
// cobrada en la calle (misma forma que /api/vendedor/cuentas-bancarias, que exige
// rol vendedor). La usa el cobro web del chofer y la réplica de la app Chofer.
export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.from("cuentas_bancarias").select("id, banco, nombre, alias").eq("activo", true).order("banco")
    if (error) throw error
    return NextResponse.json({ cuentas: data ?? [] })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
