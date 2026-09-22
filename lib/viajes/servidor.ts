import { NextResponse } from "next/server"
import type { SupabaseClient, User } from "@supabase/supabase-js"
import { requireAuth, getUserRoles } from "@/lib/auth"
import { ERP_ROLES } from "@/lib/role-utils"

// Helpers de servidor del módulo Viajes (API routes de oficina).

type OficinaResult = { user: User; error: null } | { user: null; error: NextResponse }

/** Armar / despachar viajes es tarea de oficina (admin + administrativo). */
export async function requireOficina(): Promise<OficinaResult> {
  const auth = await requireAuth()
  if (auth.error) return auth
  const roles = await getUserRoles(auth.user.id)
  if (!roles.some((r) => (ERP_ROLES as readonly string[]).includes(r))) {
    return { user: null, error: NextResponse.json({ error: "Solo oficina puede gestionar viajes." }, { status: 403 }) }
  }
  return auth
}

export function errorJson(mensaje: string, status = 400) {
  return NextResponse.json({ error: mensaje }, { status })
}

/**
 * Deja viajes_choferes = titular + acompañantes, y viajes.chofer_id / chofer
 * (texto, legado) espejando al titular. titularId null = viaje sin chofer aún.
 */
export async function guardarChoferes(
  supabase: SupabaseClient,
  viajeId: string,
  titularId: string | null,
  acompananteIds: string[],
) {
  const acomp = [...new Set(acompananteIds.filter((id) => id && id !== titularId))]

  const { error: delErr } = await supabase.from("viajes_choferes").delete().eq("viaje_id", viajeId)
  if (delErr) throw delErr

  const filas = [
    ...(titularId ? [{ viaje_id: viajeId, usuario_id: titularId, rol: "titular" }] : []),
    ...acomp.map((id) => ({ viaje_id: viajeId, usuario_id: id, rol: "acompanante" })),
  ]
  if (filas.length) {
    const { error } = await supabase.from("viajes_choferes").insert(filas)
    if (error) throw error
  }

  let nombre: string | null = null
  if (titularId) {
    const { data: u } = await supabase.from("usuarios").select("nombre").eq("id", titularId).maybeSingle()
    nombre = u?.nombre ?? null
  }
  const { error: vErr } = await supabase.from("viajes").update({ chofer_id: titularId, chofer: nombre }).eq("id", viajeId)
  if (vErr) throw vErr
}

export async function guardarZonas(supabase: SupabaseClient, viajeId: string, zonaIds: string[]) {
  const ids = [...new Set(zonaIds.filter(Boolean))]
  const { error: delErr } = await supabase.from("viaje_zonas").delete().eq("viaje_id", viajeId)
  if (delErr) throw delErr
  if (ids.length) {
    const { error } = await supabase.from("viaje_zonas").insert(ids.map((zona_id) => ({ viaje_id: viajeId, zona_id })))
    if (error) throw error
  }
}

/**
 * Alinea las paradas con los pedidos del viaje: crea la parada de cada cliente
 * que tiene pedidos y no la tenía (al final del orden), y borra las paradas
 * PENDIENTES que quedaron sin pedidos y sin ninguna instrucción cargada (las
 * que oficina marcó a mano — p.ej. "pasar solo a cobrar" — se conservan).
 */
export async function sincronizarParadas(supabase: SupabaseClient, viajeId: string) {
  const [{ data: pedidos, error: pErr }, { data: paradas, error: paErr }] = await Promise.all([
    supabase.from("pedidos").select("cliente_id").eq("viaje_id", viajeId).neq("estado", "eliminado"),
    supabase
      .from("viajes_paradas")
      .select("id, cliente_id, orden, estado, exigir_cobro_anterior, exigir_cobro_actual, bloquear_entrega, nota_oficina")
      .eq("viaje_id", viajeId),
  ])
  if (pErr) throw pErr
  if (paErr) throw paErr

  const conPedido = new Set((pedidos || []).map((p: any) => p.cliente_id as string))
  const conParada = new Set((paradas || []).map((p: any) => p.cliente_id as string))

  let orden = Math.max(0, ...(paradas || []).map((p: any) => Number(p.orden) || 0))
  const nuevas = [...conPedido]
    .filter((c) => !conParada.has(c))
    .map((cliente_id) => ({ viaje_id: viajeId, cliente_id, orden: ++orden }))
  if (nuevas.length) {
    const { error } = await supabase.from("viajes_paradas").insert(nuevas)
    if (error) throw error
  }

  const sobrantes = (paradas || [])
    .filter(
      (p: any) =>
        !conPedido.has(p.cliente_id) &&
        p.estado === "pendiente" &&
        !p.exigir_cobro_anterior &&
        !p.exigir_cobro_actual &&
        !p.bloquear_entrega &&
        !p.nota_oficina,
    )
    .map((p: any) => p.id)
  if (sobrantes.length) {
    const { error } = await supabase.from("viajes_paradas").delete().in("id", sobrantes)
    if (error) throw error
  }
}

/** "NECOCHEA + TANDIL · 14/10" */
export function nombrePorDefecto(zonas: string[], fecha: string): string {
  const [, m, d] = fecha.split("-")
  return `${zonas.join(" + ") || "Viaje"} · ${d}/${m}`
}
