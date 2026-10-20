import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { buscarDadoDeBajaPorCodigo, cambiarEstadoArticulos, type OrigenEstadoArticulo } from "@/lib/articulos/estado"

const ORIGENES: OrigenEstadoArticulo[] = ["articulos", "deposito", "app_deposito", "importacion"]

// POST /api/articulos/estado  { ids: string[], activo: boolean, origen?: "articulos"|"deposito"|… }
// Dar de baja o REACTIVAR artículos. Registra quién (usuario de la sesión) y desde dónde
// (historial articulos_estado_historial).
export async function POST(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  const body = await request.json().catch(() => ({}))
  const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : []
  if (!ids.length || typeof body.activo !== "boolean") {
    return NextResponse.json({ error: "Faltan ids o activo" }, { status: 400 })
  }
  const origen: OrigenEstadoArticulo = ORIGENES.includes(body.origen) ? body.origen : "articulos"
  try {
    const cambiados = await cambiarEstadoArticulos(createAdminClient(), ids, body.activo, auth.user!.id, origen)
    return NextResponse.json({ cambiados })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "No se pudo cambiar el estado" }, { status: 500 })
  }
}

// GET /api/articulos/estado?codigo=062216  → { articulo: {id, sku, descripcion, activo:false} | null }
// Para depósito: un código que no aparece entre los activos, ¿es de un artículo dado de baja?
export async function GET(request: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  const codigo = new URL(request.url).searchParams.get("codigo") || ""
  const articulo = await buscarDadoDeBajaPorCodigo(createAdminClient(), codigo)
  return NextResponse.json({ articulo })
}
