import { createClient } from "@/lib/supabase/server"
import { NextResponse, type NextRequest } from "next/server"
import { requireAuth } from "@/lib/auth"

// POST: Crear ajuste de stock (queda pendiente de confirmación en ERP)
export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { articulo_id, tipo, cantidad, motivo } = await request.json()

    if (!articulo_id || !tipo || cantidad === undefined) {
      return NextResponse.json({ error: "Faltan datos requeridos" }, { status: 400 })
    }

    const { data: { user } } = await supabase.auth.getUser()
    let userName = user?.email?.split("@")[0] || "Operario"
    if (user?.id) {
      const { data: u } = await supabase.from("usuarios").select("nombre").eq("id", user.id).single()
      if (u?.nombre) userName = u.nombre
    }

    // Get current stock
    const { data: art } = await supabase
      .from("articulos")
      .select("stock_actual, descripcion, sku")
      .eq("id", articulo_id)
      .single()

    const { data: ajuste, error } = await supabase
      .from("deposito_ajustes_stock")
      .insert({
        articulo_id,
        tipo,
        cantidad,
        stock_anterior: art?.stock_actual || 0,
        motivo,
        usuario_id: user?.id,
        usuario_nombre: userName,
        estado: "pendiente",
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json(ajuste)
  } catch (error: any) {
    console.error("[deposito] Error POST ajuste:", error)
    return NextResponse.json({ error: "Error al crear ajuste" }, { status: 500 })
  }
}

// GET: Ajustes pendientes (para ver historial)
export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()

    const { data: ajustes, error } = await supabase
      .from("deposito_ajustes_stock")
      .select(`
        *,
        articulos(sku, descripcion)
      `)
      .order("created_at", { ascending: false })
      .limit(50)

    if (error) throw error

    return NextResponse.json(ajustes || [])
  } catch (error: any) {
    return NextResponse.json({ error: "Error" }, { status: 500 })
  }
}
