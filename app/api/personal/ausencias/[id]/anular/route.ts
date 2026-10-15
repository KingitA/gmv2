import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireOficina } from "@/lib/viajes/servidor"

// Anular una ausencia: no se borra (queda quién y cuándo la anuló, en la bitácora).
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOficina()
  if (auth.error) return auth.error
  const { id } = await params
  const { data, error } = await createAdminClient().from("personal_ausencias")
    .update({ anulado_por: auth.user.id, anulado_at: new Date().toISOString() })
    .eq("id", id).is("anulado_at", null).select("id")
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: "Esa ausencia ya no está." }, { status: 404 })
  return NextResponse.json({ success: true })
}
