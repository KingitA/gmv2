import { NextResponse } from "next/server"
import type { SupabaseClient, User } from "@supabase/supabase-js"
import { requireAuth, getUserRoles } from "@/lib/auth"
import { ERP_ROLES } from "@/lib/role-utils"
import { PREFIJO_RETENCION, retenidosEntre } from "./retencion"
import { createAdminClient } from "@/lib/supabase/admin"
import { ausenciasEntre } from "./calendario-laboral"
import { fecha as fmtFecha, sumarDiasISO as sumarDias } from "@/lib/formato"

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
  const sinParada = [...conPedido].filter((c) => !conParada.has(c))
  // Cliente con entregas retenidas (decisión de oficina, lib/viajes/retencion.ts): su parada nace con candado
  const retenidos = await retenidosEntre(supabase, sinParada)
  // OJO: en un insert de varias filas, PostgREST manda NULL (no el default) a la columna que
  // falta en alguna fila. Por eso TODAS las filas llevan los tres campos explícitos.
  const nuevas = sinParada.map((cliente_id) => {
    const motivo = retenidos.get(cliente_id)
    return {
      viaje_id: viajeId, cliente_id, orden: ++orden,
      bloquear_entrega: motivo !== undefined,
      exigir_cobro_anterior: motivo !== undefined,
      retencion_puso_cobro: motivo !== undefined,
      motivo_bloqueo: motivo !== undefined ? PREFIJO_RETENCION + motivo : null,
    }
  })
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

/**
 * Autorreparación: si un viaje de reparto que todavía se arma (programado) tiene
 * pedidos de clientes sin parada (p. ej. porque un alta de paradas falló en el
 * medio), las crea. Se llama al abrir la hoja de ruta. Nunca frena la lectura.
 */
export async function repararParadasFaltantes(supabase: SupabaseClient, viajeId: string) {
  try {
    const { data: v } = await supabase.from("viajes").select("estado, tipo").eq("id", viajeId).maybeSingle()
    if (!v || v.tipo !== "reparto" || v.estado !== "programado") return
    const [{ data: pedidos }, { data: paradas }] = await Promise.all([
      supabase.from("pedidos").select("cliente_id").eq("viaje_id", viajeId).neq("estado", "eliminado"),
      supabase.from("viajes_paradas").select("cliente_id").eq("viaje_id", viajeId),
    ])
    const conParada = new Set((paradas || []).map((p: any) => p.cliente_id))
    if ((pedidos || []).some((p: any) => !conParada.has(p.cliente_id))) await sincronizarParadas(supabase, viajeId)
  } catch (e) {
    console.error("[viajes] reparar paradas", e)
  }
}

export interface NuevoViajeProgramado {
  fecha: string
  dias?: number
  zona_ids: string[]
  nombre?: string
  tipo_transporte?: string
  transporte_id?: string | null
  vehiculo_id?: string | null
  chofer_id?: string | null
  acompanante_ids?: string[]
  porcentaje_flete?: number
  observaciones?: string | null
}

/**
 * Crea un viaje de reparto 'programado' (calendario): valida fecha y zonas,
 * nombre por defecto "ZONAS · dd/mm", zonas y choferes. Lo usan POST
 * /api/viajes (modal "Programar viaje") y POST /api/viajes/plan (armar el mes).
 * Devuelve el id o lanza Error con un mensaje para mostrar.
 */
export async function crearViajeProgramado(supabase: SupabaseClient, usuarioId: string, body: NuevoViajeProgramado): Promise<string> {
  const zonaIds: string[] = Array.isArray(body.zona_ids) ? [...new Set(body.zona_ids.filter(Boolean))] : []
  if (!body.fecha || !/^\d{4}-\d{2}-\d{2}$/.test(body.fecha)) throw new Error("fecha (AAAA-MM-DD) es requerida")
  if (!zonaIds.length) throw new Error("Elegí al menos una zona")

  const { data: zonas } = await supabase.from("zonas").select("id, nombre").in("id", zonaIds)
  if ((zonas || []).length !== zonaIds.length) throw new Error("Alguna zona no existe")

  const porTransporte = body.tipo_transporte === "transporte"
  const dias = Math.min(15, Math.max(1, Math.round(Number(body.dias)) || 1))

  const { data: viaje, error } = await supabase
    .from("viajes")
    .insert({
      nombre: (body.nombre || "").trim() || nombrePorDefecto(zonaIds.map((id) => zonas!.find((z: any) => z.id === id)!.nombre), body.fecha),
      fecha: body.fecha,
      dias,
      tipo: "reparto",
      estado: "programado",
      zona_id: zonaIds[0], // principal (legado: remitos y flete la leen)
      tipo_transporte: porTransporte ? "transporte" : "chofer_propio",
      transporte_id: porTransporte ? body.transporte_id || null : null,
      vehiculo_id: porTransporte ? null : body.vehiculo_id || null,
      porcentaje_flete: Number(body.porcentaje_flete) || 0,
      observaciones: body.observaciones || null,
      creado_por: usuarioId,
    })
    .select("id")
    .single()
  if (error) throw error

  await guardarZonas(supabase, viaje.id, zonaIds)
  if (!porTransporte) {
    await guardarChoferes(supabase, viaje.id, body.chofer_id || null, Array.isArray(body.acompanante_ids) ? body.acompanante_ids : [])
  }
  return viaje.id as string
}

/**
 * Vacaciones del equipo de un viaje: si el titular o algún acompañante está de
 * vacaciones / licencia en algún día del viaje, devuelve el aviso para mostrar.
 * (Pedido de Juan, 15/10: "si programo un viaje con un chofer, que me indique que
 * va a estar de vacaciones".) Usa la service key: personal_ausencias tiene RLS.
 */
export async function ausenciasDelEquipo(usuarioIds: (string | null | undefined)[], fecha: string, dias: number) {
  const ids = [...new Set(usuarioIds.filter((x): x is string => !!x))]
  if (!ids.length || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { aviso: null as string | null, ausencias: [] as Awaited<ReturnType<typeof ausenciasEntre>> }
  const hasta = sumarDias(fecha, Math.max(1, dias) - 1)
  const ausencias = (await ausenciasEntre(createAdminClient(), fecha, hasta)).filter((a) => ids.includes(a.usuario_id))
  if (!ausencias.length) return { aviso: null, ausencias }
  const aviso = ausencias.map((a) => `${a.nombre} está de ${a.tipo} del ${fmtFecha(a.desde)} al ${fmtFecha(a.hasta)}`).join(". ") + ` (el viaje es del ${fmtFecha(fecha)}${dias > 1 ? ` al ${fmtFecha(hasta)}` : ""}).`
  return { aviso, ausencias }
}
