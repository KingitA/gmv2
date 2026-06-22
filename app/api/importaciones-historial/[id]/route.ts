/**
 * GET /api/importaciones-historial/[id]
 * Devuelve un registro de historial con el detalle completo (resultado fila por fila).
 */

import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireAuth } from "@/lib/auth"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  const { id } = await params
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("importaciones_historial")
    .select("*")
    .eq("id", id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json({ registro: data })
}
