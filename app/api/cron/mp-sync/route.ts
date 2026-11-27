import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { leerMercadoPago } from "@/lib/bancos/lectura-servidor"

export const maxDuration = 60

/**
 * Cron: sincroniza los movimientos de MercadoPago (últimos 7 días) como extracto fuente
 * 'api_mp' y corre el matching. Idempotente por referencia real de MP.
 * La lectura programada la hace /api/cron/bancos-lectura (pg_cron, migración 20261127a);
 * esta ruta queda para llamarla a mano. Requiere MP_ACCESS_TOKEN y CRON_SECRET.
 */
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get("authorization")
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const res = await leerMercadoPago(createAdminClient(), { dias: 7 })
    console.log("[CRON mp-sync]", res)
    return NextResponse.json({ success: res.conectado, ...res })
  } catch (error: any) {
    console.error("[CRON mp-sync] error:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
