import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { revisionDiaria } from "@/lib/jarvis/resumen"

// Revisión diaria de Jarvis (vercel.json → 8:00 hora argentina, lunes a sábado):
// vigías + foto de números + resumen del día. Exige CRON_SECRET siempre.
export const maxDuration = 120

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }
  try {
    const r = await revisionDiaria(createAdminClient(), null)
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    console.error("[jarvis] cron revisión", e)
    return NextResponse.json({ error: "Falló la revisión" }, { status: 500 })
  }
}
