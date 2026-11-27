import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { procesarLote } from "@/lib/bancos/lectura-servidor"
import type { Lectura } from "@/lib/bancos/lectura"

export const maxDuration = 60

/**
 * POST /api/finanzas/bancos-lectura/lote — vista previa o guardado de lo leído de una cuenta.
 * Body: { cuenta_id, lecturas: Lectura[] (de /leer), guardar?: boolean, excluir?: string[] (claves) }
 *  guardar = false → cuántos son nuevos, cuántos ya estaban y cuáles no se pueden guardar (y por qué).
 *  guardar = true  → guarda los nuevos (y los "sin control" que no se excluyan) por el mismo
 *                    circuito de los extractos (extracto_matchear) y el saldo del banco si se leyó.
 * Todo se recalcula acá contra la base: no se duplica aunque la misma captura se suba muchas veces.
 */
export async function POST(request: Request) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  try {
    const body = await request.json()
    const cuentaId = typeof body?.cuenta_id === "string" ? body.cuenta_id : ""
    const lecturas = Array.isArray(body?.lecturas) ? (body.lecturas as Lectura[]) : []
    if (!cuentaId || !lecturas.length) return NextResponse.json({ error: "Faltan la cuenta o las capturas" }, { status: 400 })
    for (const l of lecturas) {
      if (!l || !Array.isArray(l.filas) || !["captura", "archivo", "pdf"].includes(l.origen)) {
        return NextResponse.json({ error: "Lectura inválida" }, { status: 400 })
      }
    }
    const res = await procesarLote(createAdminClient(), {
      cuentaId, lecturas, guardar: body.guardar === true,
      excluir: Array.isArray(body.excluir) ? body.excluir.map(String) : [],
      usuarioId: auth.user?.id ?? null,
    })
    return NextResponse.json({ ok: true, ...res })
  } catch (error: any) {
    console.error("[bancos-lectura/lote] error:", error)
    return NextResponse.json({ error: error.message ?? "No se pudo procesar" }, { status: 500 })
  }
}
