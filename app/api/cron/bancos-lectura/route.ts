import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { lecturaPeriodica } from "@/lib/bancos/lectura-periodica"

// Lectura periódica de movimientos y saldo de los bancos con API (MercadoPago siempre que haya
// token; Credicoop solo en producción). La llama la base cada 30 minutos (pg_cron →
// bancos_lectura_periodica(), migración 20261127a). Exige CRON_SECRET siempre.
// ?forzar=1 lee Credicoop también fuera del horario bancario (para probar).
export const maxDuration = 120

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }
  try {
    const forzar = new URL(request.url).searchParams.get("forzar") === "1"
    return NextResponse.json({ ok: true, ...(await lecturaPeriodica(createAdminClient(), { forzar })) })
  } catch (e) {
    console.error("[bancos] lectura periódica", e)
    return NextResponse.json({ error: "Falló la lectura de los bancos" }, { status: 500 })
  }
}
