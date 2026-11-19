import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { consultaPeriodica } from "@/lib/bancos/consulta-periodica"

// Consulta periódica a Credicoop: actualiza las operaciones que esperan la firma y confirma solas
// las órdenes de pago que el banco ya procesó. La llama la base cada 15 minutos en horario
// bancario (pg_cron → bancos_consulta_periodica(), migración 20261119e). Exige CRON_SECRET siempre.
// ?forzar=1 la corre también fuera del horario bancario (para probar).
export const maxDuration = 120

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }
  try {
    const forzar = new URL(request.url).searchParams.get("forzar") === "1"
    return NextResponse.json({ ok: true, ...(await consultaPeriodica(createAdminClient(), { forzar })) })
  } catch (e) {
    console.error("[bancos] consulta periódica", e)
    return NextResponse.json({ error: "Falló la consulta a Credicoop" }, { status: 500 })
  }
}
