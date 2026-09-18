import { createClient } from "@/lib/supabase/server"
import { NextResponse, type NextRequest } from "next/server"
import { requireAuth } from "@/lib/auth"
import { getPreparadoresPedido } from "@/lib/deposito/preparadores"
import { aplicarPickingItem, cerrarPicking, ErrorDeposito } from "@/lib/deposito/picking"

// GET ?pedido_id= — quién preparó cada renglón + resumen por persona (modal del ERP)
export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const pedido_id = new URL(request.url).searchParams.get("pedido_id")
    if (!pedido_id) return NextResponse.json({ error: "pedido_id requerido" }, { status: 400 })
    const supabase = await createClient()
    return NextResponse.json(await getPreparadoresPedido(supabase, pedido_id))
  } catch (error: any) {
    return NextResponse.json({ error: `Error: ${error?.message}` }, { status: 500 })
  }
}

// PATCH: Actualizar cantidad_preparada y estado_item en pedidos_detalle,
// registrando QUIÉN lo preparó (picking_items). Un renglón = un preparador.
// La lógica vive en lib/deposito/picking.ts (la comparte el outbox de la app).
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const body = await request.json()
    return NextResponse.json(await aplicarPickingItem(supabase, body))
  } catch (error: any) {
    if (error instanceof ErrorDeposito) return NextResponse.json({ error: error.message, ...error.extra }, { status: error.status })
    return NextResponse.json({ error: `Error: ${error?.message}` }, { status: 500 })
  }
}

// POST: Finalizar picking de un pedido
export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { pedido_id } = await request.json()
    return NextResponse.json(await cerrarPicking(supabase, pedido_id))
  } catch (error: any) {
    if (error instanceof ErrorDeposito) return NextResponse.json({ error: error.message, ...error.extra }, { status: error.status })
    return NextResponse.json({ error: `Error: ${error?.message}` }, { status: 500 })
  }
}
