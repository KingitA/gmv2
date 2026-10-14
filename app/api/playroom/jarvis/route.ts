import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireJarvis, esAdmin } from "@/lib/jarvis/acceso"
import { leerReglas, REGLAS_POR_DEFECTO } from "@/lib/jarvis/reglas"
import { ESFUERZOS, leerAjustes, olvidarAjustes } from "@/lib/jarvis/modelos"
import { gastoDelMes } from "@/lib/jarvis/uso"
import { nombresDeUsuarios } from "@/lib/jarvis/agenda"

// Ajustes de Jarvis: reglas (umbrales), notas del negocio, modelo y tope de gasto.
// Cada cambio queda en la bitácora (trigger de ai_ajustes: quién, cuándo, de qué a qué).
// Reglas y notas: admin y administrativo. Modelo y tope: solo admin.

const CLAVES_SOLO_ADMIN = new Set(["modelo_pensador", "modelo_rapido", "modelo_respaldo", "tope_mensual_usd", "esfuerzo_chat"])
const MODELO_VALIDO = /^claude-[a-z0-9-]+$/

export async function GET() {
  const auth = await requireJarvis()
  if (auth.error) return auth.error
  const db = createAdminClient()
  const [{ reglas, notas }, ajustes, gasto, filas] = await Promise.all([
    leerReglas(db), leerAjustes(db), gastoDelMes(db),
    db.from("ai_ajustes").select("clave, descripcion, actualizado_por, actualizado_at").then((r) => r.data ?? []),
  ])
  const meta = new Map((filas as { clave: string; descripcion: string | null; actualizado_por: string | null; actualizado_at: string }[]).map((f) => [f.clave, f]))
  const nombres = await nombresDeUsuarios(db, [...meta.values()].map((f) => f.actualizado_por))
  const quien = (clave: string) => {
    const m = meta.get(clave)
    return m ? { descripcion: m.descripcion, por: m.actualizado_por ? nombres.get(m.actualizado_por) ?? "alguien" : "valor inicial", at: m.actualizado_at } : null
  }
  return NextResponse.json({
    reglas: Object.keys(REGLAS_POR_DEFECTO).map((k) => ({ clave: k, valor: reglas[k as keyof typeof reglas], ...quien(k) })),
    notas: notas.map((n) => ({ clave: n.clave, texto: n.texto, por: n.actualizado_por ? nombres.get(n.actualizado_por) ?? "alguien" : "—", at: n.actualizado_at })),
    modelos: ajustes.modelos,
    esfuerzo_chat: ajustes.esfuerzoChat,
    tope_mensual_usd: ajustes.topeMensualUsd,
    gasto_mes_usd: Math.round(gasto * 100) / 100,
    soy_admin: esAdmin(auth.roles),
  })
}

export async function PUT(req: NextRequest) {
  const auth = await requireJarvis()
  if (auth.error) return auth.error
  let b: { clave?: unknown; valor?: unknown }
  try { b = await req.json() } catch { return NextResponse.json({ error: "Pedido inválido" }, { status: 400 }) }
  const clave = typeof b.clave === "string" ? b.clave : ""
  let valor: unknown = b.valor

  if (CLAVES_SOLO_ADMIN.has(clave)) {
    if (!esAdmin(auth.roles)) return NextResponse.json({ error: "El modelo y el tope de gasto los cambia solo un admin." }, { status: 403 })
    if (clave === "esfuerzo_chat") {
      if (!ESFUERZOS.includes(valor as never)) return NextResponse.json({ error: "Esfuerzo inválido." }, { status: 400 })
    } else if (clave === "tope_mensual_usd") {
      if (typeof valor !== "number" || !(valor >= 0 && valor <= 10_000)) return NextResponse.json({ error: "Tope inválido." }, { status: 400 })
    } else if (typeof valor !== "string" || !MODELO_VALIDO.test(valor)) {
      return NextResponse.json({ error: "Nombre de modelo inválido (ej. claude-opus-5-5)." }, { status: 400 })
    }
  } else if (clave in REGLAS_POR_DEFECTO) {
    if (clave === "regla_avisos") {
      if (valor !== "todo" && valor !== "urgentes") return NextResponse.json({ error: "Valor inválido." }, { status: 400 })
    } else if (typeof valor !== "number" || !isFinite(valor) || valor < 0) {
      return NextResponse.json({ error: "Tiene que ser un número positivo." }, { status: 400 })
    }
  } else if (clave === "nota:nueva" || clave.startsWith("nota:")) {
    // valor = texto (o null para borrarla; el borrado queda registrado)
    if (valor !== null && (typeof valor !== "string" || !valor.trim())) return NextResponse.json({ error: "La nota está vacía." }, { status: 400 })
    if (typeof valor === "string") valor = valor.trim().slice(0, 500)
  } else {
    return NextResponse.json({ error: "Ajuste desconocido." }, { status: 400 })
  }

  const db = createAdminClient()
  const claveFinal = clave === "nota:nueva" ? `nota:${Date.now()}` : clave
  const { error } = await db.from("ai_ajustes").upsert({
    clave: claveFinal, valor, actualizado_por: auth.user.id, actualizado_at: new Date().toISOString(),
    ...(claveFinal.startsWith("nota:") ? { descripcion: "Nota del negocio para Jarvis" } : {}),
  }, { onConflict: "clave" })
  if (error) return NextResponse.json({ error: "No se pudo guardar." }, { status: 500 })
  olvidarAjustes()
  return NextResponse.json({ ok: true, clave: claveFinal })
}
