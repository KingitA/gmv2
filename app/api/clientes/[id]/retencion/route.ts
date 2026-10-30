import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requirePermiso } from "@/lib/auth"
import { liberarCliente, retenerCliente } from "@/lib/viajes/retencion"

// "Retener entregas" desde la ficha del cliente (P2-08): mismo efecto que Viajes
// y Jarvis (lib/viajes/retencion.ts: bloquea / destraba las paradas de los
// viajes armados). Lo decide oficina (admin / administrativo). Quién y cuándo
// lo anota la base (trigger clientes_registrar_retencion).
// Body: { retener: boolean, motivo?: string }

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermiso("emitir_comprobantes")
  if (auth.error) return auth.error
  const { id } = await params
  let b: { retener?: unknown; motivo?: unknown }
  try { b = await req.json() } catch { return NextResponse.json({ error: "Pedido inválido" }, { status: 400 }) }
  const retener = b.retener === true
  const motivo = typeof b.motivo === "string" ? b.motivo.trim() : ""
  if (retener && !motivo) return NextResponse.json({ error: "Escribí el motivo de la retención." }, { status: 400 })

  const db = createAdminClient()
  const { data: c } = await db.from("clientes").select("id, retener_entregas").eq("id", id).maybeSingle()
  if (!c) return NextResponse.json({ error: "Cliente no encontrado." }, { status: 404 })
  try {
    if (retener) {
      const r = await retenerCliente(db, id, motivo, auth.user.id)
      return NextResponse.json({ ok: true, retener_entregas: true, paradas: r.paradasBloqueadas })
    }
    if (!c.retener_entregas) return NextResponse.json({ ok: true, retener_entregas: false, paradas: 0 })
    const r = await liberarCliente(db, id, auth.user.id)
    return NextResponse.json({ ok: true, retener_entregas: false, paradas: r.paradasLiberadas })
  } catch (e: any) {
    console.error("[clientes/retencion]", e)
    return NextResponse.json({ error: e?.message || "No se pudo cambiar la retención." }, { status: 500 })
  }
}
