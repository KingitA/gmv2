import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireJarvis } from "@/lib/jarvis/acceso"
import { actualizarConIA, actualizarFuentesFijas, estadoIndicadores, indicadoresNecesarios, INDICADORES } from "@/lib/jarvis/exterior"
import { clasificarPendientes, cobertura, dudas, revisarArticulo } from "@/lib/jarvis/clasificador"

// Materias primas y precios de afuera (Ajustes de Jarvis).
// GET: indicadores + cobertura de la clasificación + dudas.
// POST { accion: "actualizar_precios" | "clasificar" | "revisar", articulo_id?, insumo? }
export const maxDuration = 300

export async function GET() {
  const auth = await requireJarvis()
  if (auth.error) return auth.error
  const db = createAdminClient()
  try {
    const [indicadores, cob, ds, { data: insumos }] = await Promise.all([
      estadoIndicadores(db), cobertura(db), dudas(db, 30),
      db.from("ai_insumos").select("insumo, nombre").eq("activo", true).order("nombre"),
    ])
    return NextResponse.json({ indicadores, cobertura: cob, dudas: ds, insumos: insumos ?? [] })
  } catch (e) {
    console.error("[jarvis] exterior GET", e)
    return NextResponse.json({ error: "No se pudo leer (¿falta aplicar la migración 20261014g?)." }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireJarvis()
  if (auth.error) return auth.error
  let b: { accion?: unknown; articulo_id?: unknown; insumo?: unknown }
  try { b = await req.json() } catch { return NextResponse.json({ error: "Pedido inválido" }, { status: 400 }) }
  const db = createAdminClient()
  try {
    if (b.accion === "actualizar_precios") {
      const fijas = await actualizarFuentesFijas(db)
      const claves = await indicadoresNecesarios(db)
      // si todavía no hay artículos clasificados, se buscan todos los de IA
      const ia = await actualizarConIA(db, claves.length ? claves : INDICADORES.filter((i) => i.fuente === "ia").map((i) => i.clave), auth.user.id)
      const errores = [...fijas.errores, ...ia.errores]
      return NextResponse.json({ ok: true, detalle: `Actualizado: ${fijas.guardados + ia.guardados} valores.${errores.length ? ` Sin dato: ${errores.join("; ")}.` : ""}` })
    }
    if (b.accion === "clasificar") {
      const r = await clasificarPendientes(db, 400, auth.user.id)
      return NextResponse.json({ ok: true, detalle: r.clasificados ? `Clasifiqué ${r.clasificados} artículos. Quedan ${r.quedan}.` : "No quedan artículos sin clasificar." })
    }
    if (b.accion === "revisar") {
      if (typeof b.articulo_id !== "string" || typeof b.insumo !== "string") return NextResponse.json({ error: "Faltan datos." }, { status: 400 })
      await revisarArticulo(db, b.articulo_id, b.insumo, auth.user.id)
      return NextResponse.json({ ok: true, detalle: "Guardado a tu nombre. Jarvis no lo va a cambiar." })
    }
    return NextResponse.json({ error: "Acción desconocida." }, { status: 400 })
  } catch (e) {
    console.error("[jarvis] exterior POST", e)
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo." }, { status: 500 })
  }
}
