import { createClient } from "@/lib/supabase/server"
import { NextResponse, type NextRequest } from "next/server"
import { requireAuth } from "@/lib/auth"
import { ErrorDeposito } from "@/lib/deposito/picking"
import { confirmarDevolucion } from "@/lib/deposito/devoluciones"
import { getUsuarioActual } from "@/lib/deposito/preparadores"

// GET: Devoluciones pendientes de recibir físicamente
export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()

    const { data: devoluciones, error } = await supabase
      .from("devoluciones")
      .select(`
        id,
        numero_devolucion,
        estado,
        observaciones,
        created_at,
        clientes(id, nombre, razon_social),
        devoluciones_detalle(
          id,
          cantidad,
          motivo,
          es_vendible,
          articulos(id, sku, descripcion, ean13)
        )
      `)
      .in("estado", ["pendiente"])
      .order("created_at", { ascending: true })

    if (error) throw error

    return NextResponse.json(devoluciones || [])
  } catch (error: any) {
    console.error("[deposito] Error GET devoluciones:", error)
    return NextResponse.json({ error: "Error al obtener devoluciones" }, { status: 500 })
  }
}

// POST: Confirmar recepción física de devolución
// (lógica en lib/deposito/devoluciones.ts: la comparte el outbox de la app Depósito)
export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { devolucion_id, items_confirmados } = await request.json()
    // items_confirmados: [{ detalle_id, articulo_id, cantidad_recibida, es_vendible }]
    const usuario = await getUsuarioActual(supabase)
    return NextResponse.json(await confirmarDevolucion(supabase, devolucion_id, items_confirmados, usuario.nombre))
  } catch (error: any) {
    if (error instanceof ErrorDeposito) return NextResponse.json({ error: error.message, ...error.extra }, { status: error.status })
    console.error("[deposito] Error POST devoluciones:", error)
    return NextResponse.json({ error: "Error al confirmar devolución" }, { status: 500 })
  }
}
