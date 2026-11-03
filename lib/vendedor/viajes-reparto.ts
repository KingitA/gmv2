// VIAJES DEL VENDEDOR = CALENDARIO DE REPARTO DEL ERP (pedido de Juan, 03/11/2026).
//
// La oficina arma el calendario del mes en /viajes/planificar (viajes tipo "reparto": fecha +
// días + zonas; el chofer se asigna después). El vendedor NO crea viajes: ve los que tocan
// zonas donde tiene clientes, entra, ve sus pedidos ya cargados y levanta pedidos para ese
// viaje (pedidos.viaje_id). Después sigue cómo va: entregas, cobros y comprobantes, con la
// misma hoja de ruta del ERP (lib/viajes/hoja-ruta.ts) recortada a SUS clientes.
//
// Los viajes y la hoja se leen con el cliente admin y filtros explícitos (zonas del vendedor,
// solo sus clientes): no dependen de cómo estén los permisos de la base para el vendedor.

import type { SupabaseClient } from "@supabase/supabase-js"
import { fechaFin, armarHojaRuta } from "@/lib/viajes/hoja-ruta"
import { pedidoAsignableAViaje } from "@/lib/viajes/estados"
import { hoyISO, sumarDiasISO } from "@/lib/formato"
import { getSaldosClientes } from "@/lib/cuenta-corriente/saldo"

/** Historial: últimos 3 meses (decisión de Juan 03/11); adelante, hasta fin del mes que viene. */
export const DIAS_HISTORIAL_VIAJES = 92

export function rangoViajesVendedor(hoy = hoyISO()): { desde: string; hasta: string } {
  const [a, m] = hoy.split("-").map(Number) as [number, number]
  // Último día del mes siguiente = el día 1 del mes subsiguiente, menos uno
  const t = a * 12 + (m - 1) + 2
  const primeroSubsig = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-01`
  return { desde: sumarDiasISO(hoy, -DIAS_HISTORIAL_VIAJES), hasta: sumarDiasISO(primeroSubsig, -1) }
}

const chunk = <T,>(arr: T[], n: number) => {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

/** Zonas donde el vendedor tiene clientes activos (por localidad y por asignación manual). */
export async function zonasDelVendedor(supabase: SupabaseClient, vendedorIds: string[]): Promise<Set<string>> {
  const zonas = new Set<string>()
  if (!vendedorIds.length) return zonas
  const { data: clientes, error } = await supabase
    .from("clientes")
    .select("id, localidad_id")
    .eq("activo", true)
    .in("vendedor_id", vendedorIds)
  if (error) throw error
  const locIds = [...new Set((clientes || []).map((c: any) => c.localidad_id).filter(Boolean))] as string[]
  for (const ids of chunk(locIds, 200)) {
    const { data } = await supabase.from("localidades").select("zona_id").in("id", ids)
    for (const l of data || []) if (l.zona_id) zonas.add(l.zona_id)
  }
  const cliIds = (clientes || []).map((c: any) => c.id)
  for (const ids of chunk(cliIds, 200)) {
    const { data } = await supabase.from("clientes_zonas").select("zona_id").in("cliente_id", ids)
    for (const z of data || []) if (z.zona_id) zonas.add(z.zona_id)
  }
  return zonas
}

/** Clientes activos del vendedor en esas zonas (por localidad y por asignación manual). */
export async function clientesDelVendedorEnZonas(supabase: SupabaseClient, vendedorIds: string[], zonaIds: string[]) {
  const map = new Map<string, { id: string; nombre: string; localidad: string | null; telefono: string | null; direccion: string | null }>()
  if (!zonaIds.length || !vendedorIds.length) return map
  const cols = "id, nombre, localidad, telefono, direccion"
  const { data: locs } = await supabase.from("localidades").select("id").in("zona_id", zonaIds)
  const locIds = (locs || []).map((l: any) => l.id)
  for (const ids of chunk(locIds, 200)) {
    const { data } = await supabase.from("clientes").select(cols).eq("activo", true).in("vendedor_id", vendedorIds).in("localidad_id", ids)
    for (const c of data || []) map.set(c.id, c as any)
  }
  const { data: cz } = await supabase.from("clientes_zonas").select("cliente_id").in("zona_id", zonaIds)
  const faltan = [...new Set((cz || []).map((x: any) => x.cliente_id))].filter((id) => !map.has(id))
  for (const ids of chunk(faltan, 200)) {
    const { data } = await supabase.from("clientes").select(cols).eq("activo", true).in("vendedor_id", vendedorIds).in("id", ids)
    for (const c of data || []) map.set(c.id, c as any)
  }
  return map
}

export interface ViajeResumenVendedor {
  id: string
  nombre: string
  estado: string
  fecha: string
  dias: number
  fecha_fin: string
  zonas: Array<{ id: string; nombre: string }>
  /** Chofer(es) si la oficina ya los asignó; vacío = todavía sin chofer */
  choferes: string[]
  /** Pedidos de SUS clientes ya cargados en el viaje */
  mis_pedidos: number
  mis_total: number
}

const VIAJE_COLS = "id, nombre, estado, fecha, dias, tipo, viaje_zonas(zona_id, zonas(id, nombre)), viajes_choferes(usuario_id, rol)"

async function nombresUsuarios(admin: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!ids.length) return out
  const { data } = await admin.from("usuarios").select("id, nombre").in("id", ids)
  for (const u of data || []) out.set(u.id, u.nombre || "")
  return out
}

function resumenDe(v: any, usuarios: Map<string, string>, mios: { n: number; total: number } | undefined): ViajeResumenVendedor {
  const dias = Math.max(1, Number(v.dias) || 1)
  const choferes = [...(v.viajes_choferes || [])]
    .sort((a: any, b: any) => (a.rol === "titular" ? -1 : b.rol === "titular" ? 1 : 0))
    .map((c: any) => usuarios.get(c.usuario_id) || "")
    .filter(Boolean)
  return {
    id: v.id,
    nombre: v.nombre,
    estado: v.estado,
    fecha: v.fecha,
    dias,
    fecha_fin: fechaFin(v.fecha, dias),
    zonas: (v.viaje_zonas || []).map((vz: any) => vz.zonas).filter(Boolean),
    choferes,
    mis_pedidos: mios?.n ?? 0,
    mis_total: Math.round((mios?.total ?? 0) * 100) / 100,
  }
}

/**
 * Viajes de reparto (no cancelados) del rango que tocan alguna zona donde el vendedor tiene
 * clientes. Con `ids`, solo esos (si siguen cumpliendo).
 */
export async function listarViajesVendedor(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  vendedorIds: string[],
  opts: { ids?: string[]; hoy?: string } = {},
): Promise<ViajeResumenVendedor[]> {
  const zonas = await zonasDelVendedor(supabase, vendedorIds)
  if (!zonas.size) return []
  const { desde, hasta } = rangoViajesVendedor(opts.hoy)
  let q = admin
    .from("viajes")
    .select(VIAJE_COLS)
    .eq("tipo", "reparto")
    .neq("estado", "cancelado")
  if (opts.ids?.length) q = q.in("id", opts.ids)
  else q = q.gte("fecha", sumarDiasISO(desde, -15)).lte("fecha", hasta)
  const { data, error } = await q.order("fecha", { ascending: true })
  if (error) throw error
  const viajes = (data || []).filter(
    (v: any) => (v.viaje_zonas || []).some((vz: any) => zonas.has(vz.zona_id)) && fechaFin(v.fecha, v.dias) >= desde,
  )
  const ids = viajes.map((v: any) => v.id)
  const mios = new Map<string, { n: number; total: number }>()
  for (const parte of chunk(ids, 100)) {
    const { data: peds } = await supabase
      .from("pedidos")
      .select("viaje_id, total")
      .in("viaje_id", parte)
      .in("vendedor_id", vendedorIds)
      .is("eliminado_at", null)
      .neq("estado", "eliminado")
    for (const p of peds || []) {
      const m = mios.get(p.viaje_id) || { n: 0, total: 0 }
      m.n++
      m.total += Number(p.total) || 0
      mios.set(p.viaje_id, m)
    }
  }
  const usuarios = await nombresUsuarios(admin, [...new Set(viajes.flatMap((v: any) => (v.viajes_choferes || []).map((c: any) => c.usuario_id)))])
  return viajes.map((v: any) => resumenDe(v, usuarios, mios.get(v.id)))
}

export interface PedidoViajeVendedor {
  id: string
  numero_pedido: string | null
  estado: string
  total: number
  cliente_id: string
}

export interface ClienteViajeVendedor {
  id: string
  nombre: string
  localidad: string | null
  direccion: string | null
  telefono: string | null
  saldo_actual: number
  saldo_proyectado: number
  pedidos: PedidoViajeVendedor[]
  /** Resultado de la parada (null = el viaje todavía no salió o el cliente no tiene parada) */
  parada: {
    estado: string
    motivo_no_entrega: string | null
    motivo_no_cobro: string | null
    total_viaje: number
    cobrado: number
    comprobantes: Array<{ id: string; tipo: string; numero: string; total: number; saldo: number }>
  } | null
}

export interface DetalleViajeVendedor {
  viaje: ViajeResumenVendedor
  /** true = la oficina todavía arma el viaje: se pueden levantar pedidos para este viaje */
  admite_pedidos: boolean
  clientes: ClienteViajeVendedor[]
  totales: { pedidos: number; total: number; entregados: number; no_entregados: number; cobrado: number }
}

/** Detalle de un viaje para el vendedor. null = no existe, no es reparto o no toca sus zonas. */
export async function detalleViajeVendedor(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  vendedorIds: string[],
  id: string,
): Promise<DetalleViajeVendedor | null> {
  const [resumen] = await listarViajesVendedor(supabase, admin, vendedorIds, { ids: [id] })
  if (!resumen) return null
  const zonaIds = resumen.zonas.map((z) => z.id)

  // Sus clientes de las zonas del viaje + los que tengan pedido en el viaje aunque la
  // zona del cliente haya cambiado después
  const clientes = await clientesDelVendedorEnZonas(supabase, vendedorIds, zonaIds)
  const { data: peds } = await supabase
    .from("pedidos")
    .select("id, numero_pedido, estado, total, cliente_id, clientes(id, nombre, localidad, telefono, direccion)")
    .eq("viaje_id", id)
    .in("vendedor_id", vendedorIds)
    .is("eliminado_at", null)
    .neq("estado", "eliminado")
    .order("numero_pedido")
  const pedidosDe = new Map<string, PedidoViajeVendedor[]>()
  for (const p of (peds || []) as any[]) {
    if (!clientes.has(p.cliente_id) && p.clientes) clientes.set(p.cliente_id, p.clientes)
    const l = pedidosDe.get(p.cliente_id) || []
    l.push({ id: p.id, numero_pedido: p.numero_pedido, estado: p.estado, total: Number(p.total) || 0, cliente_id: p.cliente_id })
    pedidosDe.set(p.cliente_id, l)
  }

  // Cómo fue el viaje (entregas, cobros, comprobantes): la hoja de ruta del ERP, solo sus clientes
  const paradaDe = new Map<string, ClienteViajeVendedor["parada"]>()
  if (resumen.estado !== "programado") {
    const hoja = await armarHojaRuta(admin, id)
    for (const p of hoja?.paradas || []) {
      if (!clientes.has(p.cliente_id)) continue
      paradaDe.set(p.cliente_id, {
        estado: p.estado,
        motivo_no_entrega: p.motivo_no_entrega,
        motivo_no_cobro: p.motivo_no_cobro,
        total_viaje: p.total_viaje,
        cobrado: p.cobrado,
        comprobantes: p.pedidos.flatMap((x) => x.comprobantes.map((c) => ({ id: c.id, tipo: c.tipo, numero: c.numero, total: c.total, saldo: c.saldo }))),
      })
    }
  }

  const ids = [...clientes.keys()]
  const saldos = await getSaldosClientes(supabase, ids)
  const lista: ClienteViajeVendedor[] = ids
    .map((cid) => {
      const c = clientes.get(cid)!
      return {
        id: cid,
        nombre: c.nombre,
        localidad: c.localidad ?? null,
        direccion: c.direccion ?? null,
        telefono: c.telefono ?? null,
        saldo_actual: saldos.get(cid)?.saldo_real ?? 0,
        saldo_proyectado: saldos.get(cid)?.saldo_proyectado ?? 0,
        pedidos: pedidosDe.get(cid) || [],
        parada: paradaDe.get(cid) ?? null,
      }
    })
    // Primero los que tienen pedido en el viaje, después el resto; por nombre
    .sort((a, b) => (b.pedidos.length > 0 ? 1 : 0) - (a.pedidos.length > 0 ? 1 : 0) || a.nombre.localeCompare(b.nombre, "es"))

  const r2 = (n: number) => Math.round(n * 100) / 100
  const conParada = lista.filter((c) => c.parada)
  return {
    viaje: resumen,
    admite_pedidos: resumen.estado === "programado",
    clientes: lista,
    totales: {
      pedidos: lista.reduce((s, c) => s + c.pedidos.length, 0),
      total: r2(lista.reduce((s, c) => s + c.pedidos.reduce((t, p) => t + p.total, 0), 0)),
      entregados: conParada.filter((c) => ["entregado", "entregado_parcial", "solo_cobro"].includes(c.parada!.estado)).length,
      no_entregados: conParada.filter((c) => c.parada!.estado === "no_entregado").length,
      cobrado: r2(conParada.reduce((s, c) => s + (c.parada!.cobrado || 0), 0)),
    },
  }
}

/**
 * Sube un pedido recién levantado al viaje elegido en la app. Solo si el viaje es de reparto,
 * todavía programado, toca una zona del cliente (o el cliente es suyo y el viaje toca sus
 * zonas) y el pedido no está en otro viaje (mismas reglas que /api/viajes/[id]/pedidos).
 * Si no se puede, el pedido queda suelto y se devuelve el motivo (la oficina lo asigna).
 */
export async function asignarPedidoAlViaje(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  vendedorIds: string[],
  pedidoId: string,
  viajeId: string,
): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const [viaje] = await listarViajesVendedor(supabase, admin, vendedorIds, { ids: [viajeId] })
  if (!viaje) return { ok: false, motivo: "el viaje ya no está en tu calendario" }
  if (viaje.estado !== "programado") return { ok: false, motivo: "el viaje ya salió: el pedido quedó sin viaje y lo asigna la oficina" }
  const { data: ped } = await supabase.from("pedidos").select("id, estado, viaje_id, vendedor_id").eq("id", pedidoId).maybeSingle()
  if (!ped || !vendedorIds.includes(ped.vendedor_id)) return { ok: false, motivo: "pedido no encontrado" }
  if (ped.viaje_id === viajeId) return { ok: true }
  if (ped.viaje_id) return { ok: false, motivo: "el pedido ya está en otro viaje" }
  if (!pedidoAsignableAViaje(ped.estado)) return { ok: false, motivo: `un pedido ${ped.estado} no se puede subir a un viaje` }
  const { error } = await admin.from("pedidos").update({ viaje_id: viajeId }).eq("id", pedidoId).is("viaje_id", null)
  if (error) return { ok: false, motivo: error.message }
  return { ok: true }
}
