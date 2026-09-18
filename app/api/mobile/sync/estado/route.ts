import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireMobile } from "@/lib/mobile/sesion"
import { seqActual } from "@/lib/mobile/sync/motor"
import { MOBILE_PROTOCOLO, type EstadoSync } from "@/lib/mobile/contrato"

// GET /api/mobile/sync/estado — sondeo liviano (1 fila) que los dispositivos
// consultan cada ~15 s con la app abierta: si cambios_seq avanzó, disparan el
// sync delta de los datasets de precios. Es la "invalidación push" (ver
// MOBILE.md → "Por qué polling corto y no Realtime").
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const sesion = await requireMobile(request)
  if (sesion.error) return sesion.error
  const admin = createAdminClient()
  // Materializa programados vencidos (barato: índice parcial por estado) para
  // que el log de cambios refleje la vigencia sin esperar al cron.
  await admin.rpc("aplicar_precios_programados").then(() => {}, () => {})
  const body: EstadoSync = {
    server_time: new Date().toISOString(),
    cambios_seq: await seqActual(admin),
    protocolo: MOBILE_PROTOCOLO,
  }
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } })
}
