import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireOficina, errorJson } from "@/lib/viajes/servidor"
import { hoyISO, sumarDiasISO } from "@/lib/formato"

// Vacaciones y ausencias del personal (Ajustes → Personas). Todos los empleados son usuarios.
// GET  → personas (usuarios con sus roles) + ausencias desde hace 30 días en adelante
// POST { usuario_id, desde, hasta, tipo, nota? } → carga una ausencia (queda quién la cargó)
const ISO = /^\d{4}-\d{2}-\d{2}$/
const TIPOS = ["vacaciones", "licencia", "otro"]

export async function GET() {
  const auth = await requireOficina()
  if (auth.error) return auth.error
  const db = createAdminClient()
  const [{ data: us }, { data: rs }, { data: aus, error }] = await Promise.all([
    db.from("usuarios").select("id, nombre, email, estado").order("nombre"),
    db.from("usuarios_roles").select("usuario_id, roles(nombre)"),
    db.from("personal_ausencias").select("id, usuario_id, desde, hasta, tipo, nota, creado_por, created_at")
      .is("anulado_at", null).gte("hasta", sumarDiasISO(hoyISO(), -30)).order("desde"),
  ])
  if (error) return NextResponse.json({ error: "Falta aplicar la migración 20261015b_calendario_laboral.sql" }, { status: 500 })
  const roles = new Map<string, string[]>()
  for (const r of (rs ?? []) as any[]) if (r.roles?.nombre) roles.set(r.usuario_id, [...(roles.get(r.usuario_id) ?? []), r.roles.nombre])
  const personas = ((us ?? []) as any[])
    .filter((u) => (roles.get(u.id) ?? []).some((r) => r !== "cliente"))
    .map((u) => ({ id: u.id, nombre: u.nombre || u.email, roles: roles.get(u.id) ?? [], activo: u.estado !== "inactivo" }))
  const nombre = new Map(personas.map((p) => [p.id, p.nombre]))
  return NextResponse.json({
    personas,
    ausencias: ((aus ?? []) as any[]).map((a) => ({ ...a, nombre: nombre.get(a.usuario_id) ?? "?", cargado_por: a.creado_por ? nombre.get(a.creado_por) ?? "alguien" : "—" })),
  })
}

export async function POST(request: NextRequest) {
  const auth = await requireOficina()
  if (auth.error) return auth.error
  try {
    const b = await request.json()
    if (typeof b.usuario_id !== "string" || !b.usuario_id) return errorJson("Elegí la persona")
    if (!ISO.test(String(b.desde)) || !ISO.test(String(b.hasta))) return errorJson("Fechas inválidas")
    if (b.hasta < b.desde) return errorJson("La fecha 'hasta' es anterior a 'desde'")
    const tipo = TIPOS.includes(b.tipo) ? b.tipo : "vacaciones"
    const db = createAdminClient()
    const { data: u } = await db.from("usuarios").select("id").eq("id", b.usuario_id).maybeSingle()
    if (!u) return errorJson("Esa persona no existe")
    const { data, error } = await db.from("personal_ausencias").insert({
      usuario_id: b.usuario_id, desde: b.desde, hasta: b.hasta, tipo,
      nota: typeof b.nota === "string" && b.nota.trim() ? b.nota.trim().slice(0, 300) : null, creado_por: auth.user.id,
    }).select("id").single()
    if (error) throw error
    return NextResponse.json({ success: true, id: data.id }, { status: 201 })
  } catch (error: any) {
    console.error("[personal/ausencias] POST:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
