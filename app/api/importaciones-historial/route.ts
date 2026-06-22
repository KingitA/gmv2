/**
 * GET /api/importaciones-historial?modulo=clientes|proveedores|articulos
 * Lista el historial de importaciones de un módulo (sin el detalle pesado).
 */

import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireAuth } from "@/lib/auth"

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  const modulo = req.nextUrl.searchParams.get("modulo")
  if (!modulo || !["clientes", "proveedores", "articulos"].includes(modulo)) {
    return NextResponse.json({ error: "Parámetro 'modulo' inválido." }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("importaciones_historial")
    .select("id, created_at, archivo_nombre, conector, total_filas, actualizados, sin_cambios, no_encontrados, nuevos, errores")
    .eq("modulo", modulo)
    .order("created_at", { ascending: false })
    .limit(100)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ historial: data ?? [] })
}
