import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { cargarColaResumen } from "@/lib/deposito/cola"

// GET: cola de pedidos a preparar, con su progreso.
// No embebe los renglones: con la cola real (1.285 pedidos / 53.867 renglones) esa
// consulta superaba el statement timeout y la respuesta pesaba 21 MB. Ver lib/deposito/cola.ts.
export const maxDuration = 30

export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    return NextResponse.json(await cargarColaResumen(supabase))
  } catch (error: any) {
    console.error("[deposito] Error GET pedidos:", error?.message || error)
    return NextResponse.json({ error: "Error al obtener pedidos" }, { status: 500 })
  }
}
