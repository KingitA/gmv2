import { NextResponse } from "next/server"
import { requireAuth, getUserRoles } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"

// Cambios de precio con vigencia programada (ver MOBILE.md → "Vigencia programada").
// Los flujos existentes de edición de precios siguen "rigiendo ya": esto es un
// camino ADICIONAL para anunciar un cambio con anticipación. Los dispositivos lo
// descargan por adelantado (dataset precios_programados) y lo aplican solos a la
// hora exacta; la base lo materializa con aplicar_precios_programados() (pg_cron).
//
// GET  ?estado=pendiente|todos     → listado
// POST { tabla, registro_id, cambios, vigencia_desde, nota? }
// PATCH { id, accion: "cancelar" }

const COLUMNAS: Record<string, string[]> = {
  articulos: [
    "precio_compra", "precio_base", "precio_base_contado", "precio_lista_especial",
    "oferta_lista_especial", "porcentaje_ganancia", "bonif_recargo", "descuento_propio",
    "iva_compras", "iva_ventas", "segmento_precio", "categoria",
  ],
  listas_precio: ["recargo_limpieza_bazar", "recargo_perfumeria_negro", "recargo_perfumeria_blanco"],
  listas_precio_reglas: ["formulas"],
}

async function requireAdmin() {
  const auth = await requireAuth()
  if (auth.error) return { error: auth.error }
  const roles = await getUserRoles(auth.user.id)
  if (!roles.includes("admin") && !roles.includes("administrativo")) {
    return { error: NextResponse.json({ error: "Solo administración." }, { status: 403 }) }
  }
  return { user: auth.user, error: null }
}

export async function GET(request: Request) {
  const s = await requireAdmin()
  if (s.error) return s.error
  const estado = new URL(request.url).searchParams.get("estado") || "pendiente"
  const admin = createAdminClient()
  let q = admin.from("precios_programados").select("*").order("vigencia_desde", { ascending: estado === "pendiente" }).limit(300)
  if (estado !== "todos") q = q.eq("estado", estado)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Descripción legible del registro afectado
  const artIds = (data || []).filter((p) => p.tabla === "articulos").map((p) => p.registro_id)
  const listaIds = (data || []).filter((p) => p.tabla === "listas_precio").map((p) => p.registro_id)
  const [arts, listas] = await Promise.all([
    artIds.length ? admin.from("articulos").select("id, sku, descripcion").in("id", artIds) : Promise.resolve({ data: [] as any[] }),
    listaIds.length ? admin.from("listas_precio").select("id, nombre, codigo").in("id", listaIds) : Promise.resolve({ data: [] as any[] }),
  ])
  const nombre = new Map<string, string>()
  for (const a of arts.data || []) nombre.set(a.id, `${a.sku} — ${a.descripcion}`)
  for (const l of listas.data || []) nombre.set(l.id, `Lista ${l.nombre || l.codigo}`)
  return NextResponse.json((data || []).map((p) => ({ ...p, registro_nombre: nombre.get(p.registro_id) || p.registro_id })))
}

export async function POST(request: Request) {
  const s = await requireAdmin()
  if (s.error) return s.error
  const b = await request.json().catch(() => null)
  const permitidas = COLUMNAS[b?.tabla]
  if (!permitidas) return NextResponse.json({ error: "Tabla no permitida." }, { status: 400 })
  if (!b?.registro_id) return NextResponse.json({ error: "Falta el registro." }, { status: 400 })
  const cambios = b?.cambios && typeof b.cambios === "object" ? b.cambios : null
  const claves = cambios ? Object.keys(cambios) : []
  if (!claves.length || claves.some((k) => !permitidas.includes(k))) {
    return NextResponse.json({ error: "Campos no permitidos para un cambio programado." }, { status: 400 })
  }
  const vig = Date.parse(b?.vigencia_desde)
  if (isNaN(vig)) return NextResponse.json({ error: "Fecha de vigencia inválida." }, { status: 400 })
  if (vig < Date.now() - 60_000) {
    return NextResponse.json({ error: "La vigencia debe ser futura. Para que rija ya, editá el precio normalmente." }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("precios_programados")
    .insert({
      tabla: b.tabla,
      registro_id: b.registro_id,
      cambios,
      vigencia_desde: new Date(vig).toISOString(),
      nota: typeof b.nota === "string" ? b.nota.slice(0, 500) : null,
      creado_por: s.user!.id,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(request: Request) {
  const s = await requireAdmin()
  if (s.error) return s.error
  const b = await request.json().catch(() => null)
  if (!b?.id || b?.accion !== "cancelar") return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 })
  const { data, error } = await createAdminClient()
    .from("precios_programados")
    .update({ estado: "cancelado" })
    .eq("id", b.id)
    .eq("estado", "pendiente")
    .select()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: "Ya no está pendiente (se aplicó o se canceló)." }, { status: 409 })
  return NextResponse.json(data[0])
}
