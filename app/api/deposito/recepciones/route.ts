import { createClient } from "@/lib/supabase/server"
import { NextResponse, type NextRequest } from "next/server"
import { requireAuth } from "@/lib/auth"
import { ErrorDeposito } from "@/lib/deposito/picking"
import { aplicarItemRecepcion, cargarOrdenesPendientes, conFotosFirmadas, finalizarRecepcion, guardarConformidad, obtenerOCrearRecepcion } from "@/lib/deposito/recepciones"

// GET: Órdenes de compra pendientes de recibir
export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const ordenesConProgreso = await cargarOrdenesPendientes(supabase)

    return NextResponse.json(ordenesConProgreso)
  } catch (error: any) {
    console.error("[deposito] Error GET recepciones:", error)
    return NextResponse.json({ error: "Error al obtener órdenes" }, { status: 500 })
  }
}

// POST: Crear o retomar recepción de mercadería
// (lógica en lib/deposito/recepciones.ts: la comparte el outbox de la app Depósito)
export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { orden_compra_id } = await request.json()
    // Las fotos se firman al servir (bucket privado): ver firmarDocumentosRecepcion
    return NextResponse.json(await conFotosFirmadas(await obtenerOCrearRecepcion(supabase, orden_compra_id, auth.user?.id)))
  } catch (error: any) {
    if (error instanceof ErrorDeposito) return NextResponse.json({ error: error.message, ...error.extra }, { status: error.status })
    console.error("[deposito] Error POST recepcion:", error)
    return NextResponse.json({ error: "Error al crear recepción" }, { status: 500 })
  }
}

// PATCH: conformidad de bultos · conteo de un artículo · finalizar (sube stock)
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const supabase = await createClient()
    const { recepcion_id, articulo_id, cantidad_fisica, finalizar, conformidad } = await request.json()

    if (conformidad) return NextResponse.json(await guardarConformidad(supabase, recepcion_id, conformidad))
    if (finalizar) return NextResponse.json(await finalizarRecepcion(supabase, recepcion_id))
    return NextResponse.json(await aplicarItemRecepcion(supabase, recepcion_id, articulo_id, cantidad_fisica))
  } catch (error: any) {
    if (error instanceof ErrorDeposito) return NextResponse.json({ error: error.message, ...error.extra }, { status: error.status })
    console.error("[deposito] Error PATCH recepcion:", error)
    return NextResponse.json({ error: "Error al actualizar recepción" }, { status: 500 })
  }
}
