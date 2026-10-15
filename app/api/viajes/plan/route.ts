import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireOficina, errorJson, crearViajeProgramado } from "@/lib/viajes/servidor"
import { estadoPlanMes, propuestaDesdeMesAnterior } from "@/lib/viajes/plan-mes"
import { createAdminClient } from "@/lib/supabase/admin"
import { hoyISO } from "@/lib/formato"

// Plan mensual de viajes (pantalla /viajes/planificar).
//
// GET  ?mes=AAAA-MM → zonas (con su duración habitual y los viajes del mes que
//      las cubren), viajes del mes, zonas faltantes y la propuesta armada con
//      el mes anterior (misma semana y día de la semana), feriados del mes,
//      ausencias del personal y días hábiles. No guarda nada.
// POST { viajes: [{ fecha, dias, zona_ids[] }] } → programa todos los
//      borradores de una (mismo alta que "Programar viaje"). Si alguno falla,
//      los demás quedan creados y se informa cuál falló.

export async function GET(request: NextRequest) {
  const auth = await requireOficina()
  if (auth.error) return auth.error
  try {
    const mes = new URL(request.url).searchParams.get("mes") || ""
    if (!/^\d{4}-\d{2}$/.test(mes)) return errorJson("mes (AAAA-MM) es requerido")
    // service key: feriados y ausencias están en tablas protegidas (RLS). El permiso ya lo controló requireOficina.
    const supabase = createAdminClient()
    const hoy = hoyISO()
    const [estado, propuesta] = await Promise.all([
      estadoPlanMes(supabase, mes, { desdeDia: hoy.slice(0, 7) === mes ? hoy : undefined }),
      propuestaDesdeMesAnterior(supabase, mes),
    ])
    return NextResponse.json({ ...estado, propuesta })
  } catch (error: any) {
    console.error("[viajes/plan] GET:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireOficina()
  if (auth.error) return auth.error
  try {
    const body = await request.json()
    const lista: any[] = Array.isArray(body.viajes) ? body.viajes : []
    if (!lista.length) return errorJson("No hay viajes para programar")
    if (lista.length > 80) return errorJson("Demasiados viajes de una vez")

    const supabase = await createClient()
    const creados: string[] = []
    const fallados: Array<{ indice: number; error: string }> = []
    for (let i = 0; i < lista.length; i++) {
      const v = lista[i]
      try {
        creados.push(await crearViajeProgramado(supabase, auth.user.id, { fecha: v.fecha, dias: v.dias, zona_ids: v.zona_ids }))
      } catch (e: any) {
        fallados.push({ indice: i, error: e?.message || "error" })
      }
    }
    return NextResponse.json({ success: fallados.length === 0, creados: creados.length, fallados }, { status: creados.length ? 201 : 400 })
  } catch (error: any) {
    console.error("[viajes/plan] POST:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
