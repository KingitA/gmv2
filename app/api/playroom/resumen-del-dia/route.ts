import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireJarvis } from "@/lib/jarvis/acceso"
import { resumenDeHoy } from "@/lib/jarvis/resumen"

// Resumen del día (contrato §4.4). Lee el guardado: abrir Playroom no gasta IA.
export async function GET() {
  const auth = await requireJarvis()
  if (auth.error) return auth.error
  return NextResponse.json(await resumenDeHoy(createAdminClient()))
}
