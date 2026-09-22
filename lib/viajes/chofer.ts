import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"

// Acceso de la tripulación a un viaje (rutas /api/chofer/**).
// Titular y acompañantes operan el MISMO viaje; la plata (billetera, rendición)
// es siempre del titular: viaje.chofer_id.

export interface AccesoViaje {
  viaje: { id: string; estado: string; chofer_id: string; nombre: string }
  esTitular: boolean
}

export async function accesoViajeChofer(
  supabase: SupabaseClient,
  viajeId: string,
  userId: string,
): Promise<{ acceso: AccesoViaje; error: null } | { acceso: null; error: NextResponse }> {
  const { data: viaje } = await supabase
    .from("viajes")
    .select("id, estado, chofer_id, nombre")
    .eq("id", viajeId)
    .single()
  if (!viaje || !viaje.chofer_id) {
    return { acceso: null, error: NextResponse.json({ error: "Viaje no encontrado" }, { status: 404 }) }
  }

  let autorizado = viaje.chofer_id === userId
  if (!autorizado) {
    const { data: fila } = await supabase
      .from("viajes_choferes")
      .select("usuario_id")
      .eq("viaje_id", viajeId)
      .eq("usuario_id", userId)
      .maybeSingle()
    autorizado = !!fila
  }
  if (!autorizado) {
    return { acceso: null, error: NextResponse.json({ error: "No autorizado" }, { status: 403 }) }
  }
  return { acceso: { viaje: viaje as any, esTitular: viaje.chofer_id === userId }, error: null }
}

/** Ids de los viajes donde el usuario es titular o acompañante. */
export async function viajesDelChofer(supabase: SupabaseClient, userId: string): Promise<string[]> {
  const [{ data: comoTripulacion }, { data: comoTitular }] = await Promise.all([
    supabase.from("viajes_choferes").select("viaje_id").eq("usuario_id", userId),
    supabase.from("viajes").select("id").eq("chofer_id", userId),
  ])
  return [
    ...new Set([
      ...(comoTripulacion || []).map((r: any) => r.viaje_id as string),
      ...(comoTitular || []).map((r: any) => r.id as string),
    ]),
  ]
}

/** ¿El usuario es el titular o un acompañante del viaje? */
export async function esTripulante(
  supabase: SupabaseClient,
  viajeId: string,
  userId: string,
  titularId: string | null | undefined,
): Promise<boolean> {
  if (titularId && titularId === userId) return true
  const { data } = await supabase
    .from("viajes_choferes")
    .select("usuario_id")
    .eq("viaje_id", viajeId)
    .eq("usuario_id", userId)
    .maybeSingle()
  return !!data
}
