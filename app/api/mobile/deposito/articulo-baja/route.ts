import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireMobile } from "@/lib/mobile/sesion"
import { buscarDadoDeBajaPorCodigo } from "@/lib/articulos/estado"

// GET /api/mobile/deposito/articulo-baja?codigo=062216 → { articulo: {id, sku, descripcion, activo:false} | null }
// Online-only (MOBILE.md §17 → "Artículo dado de baja"): la app Depósito lo consulta cuando
// un código escaneado o tipeado no está en su réplica (que solo trae artículos ACTIVOS).
// Si devuelve un artículo, la app ofrece reactivarlo con la operación `articulo.reactivar`.
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const sesion = await requireMobile(request, "deposito")
  if (sesion.error) return sesion.error
  const codigo = (new URL(request.url).searchParams.get("codigo") || "").trim()
  if (!codigo || codigo.length > 60) return NextResponse.json({ articulo: null })
  try {
    const articulo = await buscarDadoDeBajaPorCodigo(createAdminClient(), codigo)
    return NextResponse.json({ articulo }, { headers: { "Cache-Control": "no-store" } })
  } catch (e: any) {
    console.error("[mobile/deposito/articulo-baja]", e)
    return NextResponse.json({ error: "No se pudo consultar" }, { status: 503 })
  }
}
