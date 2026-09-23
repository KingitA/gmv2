// Mutaciones de la app Chofer (outbox). Ver MOBILE.md → "Chofer" y §6.
//
// Cada handler ejecuta la MISMA lógica que la web: el route handler de
// /api/chofer/**, invocado en proceso con la sesión (bearer) del request original.
// Cero duplicación de reglas. Y devuelve `replica`: las filas ya actualizadas de los
// datasets afectados (viaje, cliente del viaje, billetera, identidad).
//
// Errores: respuesta 4xx de la web / regla de negocio ⇒ RechazoNegocio (definitivo, el
// chofer lo ve). Cualquier otra cosa (5xx, red, base) ⇒ transitorio, se reintenta.
//
// Orden (FIFO por usuario, O3): una devolución hecha sin señal se aplica ANTES del
// cobro que la descuenta; las paradas se cierran ANTES de finalizar el viaje.

import { POST as cobroPOST } from "@/app/api/chofer/viaje/[id]/cobro/route"
import { DELETE as cobroDELETE } from "@/app/api/chofer/viaje/[id]/cobro/[pagoId]/route"
import { POST as devolucionPOST } from "@/app/api/chofer/viaje/[id]/devolucion/route"
import { PATCH as paradaPATCH } from "@/app/api/chofer/viaje/[id]/parada/route"
import { POST as finalizarPOST } from "@/app/api/chofer/viaje/[id]/finalizar/route"
import { POST as gastoPOST } from "@/app/api/chofer/billetera/gasto/route"
import { GET as meGET } from "@/app/api/chofer/me/route"
import { subirFotosPendientes } from "@/lib/cobranzas/fotos"
import { esTripulante, iniciarViajeSiDespachado } from "@/lib/viajes/chofer"
import type { FilaReplica } from "../contrato"
import { cargarViajeChofer, filaBillletera, filaClienteViaje } from "../sync/chofer"
import { esUuid } from "../uuid"
import { llamarGET, llamarRuta } from "./rutas"
import { RechazoNegocio, type CtxOutbox, type HandlerDef } from "./tipos"

const ROLES = ["chofer"]

interface ParcheReplica {
  dataset: string
  upserts: FilaReplica[]
  deletes: string[]
}

// ─── Infraestructura ─────────────────────────────────────────────────────────

async function viajeDe(ctx: CtxOutbox, viajeId: string): Promise<{ id: string; estado: string; chofer_id: string | null; finalizado_at: string | null }> {
  const { data } = await ctx.supabase.from("viajes").select("id, estado, chofer_id, finalizado_at").eq("id", viajeId).maybeSingle()
  if (!data) throw new RechazoNegocio("El viaje ya no existe.")
  if (!(await esTripulante(ctx.supabase, viajeId, ctx.sesion.user.id, data.chofer_id))) throw new RechazoNegocio("No sos chofer ni acompañante de este viaje.")
  return data
}

async function parcheViaje(ctx: CtxOutbox, viajeId: string): Promise<ParcheReplica> {
  const fila = await cargarViajeChofer(ctx, viajeId)
  return { dataset: "chofer_viajes", upserts: fila ? [fila] : [], deletes: fila ? [] : [viajeId] }
}

async function parcheClientes(ctx: CtxOutbox, viajeId: string, clienteIds: string[]): Promise<ParcheReplica> {
  const { data: v } = await ctx.supabase.from("viajes").select("estado").eq("id", viajeId).maybeSingle()
  // Solo los clientes que son parada del viaje tienen fila en el equipo
  const { data: paradas } = await ctx.supabase.from("viajes_paradas").select("cliente_id").eq("viaje_id", viajeId).in("cliente_id", clienteIds)
  const ids = [...new Set<string>((paradas || []).map((p: any) => p.cliente_id as string))]
  const upserts: FilaReplica[] = []
  for (const id of ids) upserts.push(await filaClienteViaje(ctx, viajeId, id, v?.estado || "en_curso"))
  return { dataset: "chofer_viaje_clientes", upserts, deletes: [] }
}

async function parcheBilletera(ctx: CtxOutbox): Promise<ParcheReplica> {
  return { dataset: "chofer_billetera", upserts: [await filaBillletera(ctx)], deletes: [] }
}

async function parcheMe(ctx: CtxOutbox): Promise<ParcheReplica> {
  return { dataset: "chofer_me", upserts: [{ id: "me", ...(await llamarGET(meGET, ctx, "/api/chofer/me")) }], deletes: [] }
}

/** Un parche que falla no debe convertir en "transitoria" una operación YA aplicada. */
async function parches(...fns: Array<() => Promise<ParcheReplica>>): Promise<ParcheReplica[]> {
  const out: ParcheReplica[] = []
  for (const fn of fns) {
    try {
      out.push(await fn())
    } catch (e) {
      console.error("[outbox/chofer] parche de réplica:", e)
    }
  }
  return out
}

// ─── Viaje ───────────────────────────────────────────────────────────────────

/** Abrir el viaje en el equipo = iniciarlo (despachado → en_curso). Idempotente. */
const viajeIniciar: HandlerDef<{ viaje_id: string }> = {
  tipo: "viaje.iniciar",
  roles: ROLES,
  validar: (p) => (esUuid(p?.viaje_id) ? null : "Viaje inválido"),
  async aplicar(ctx, m) {
    const v = await viajeDe(ctx, m.payload.viaje_id)
    if (v.estado === "despachado") await iniciarViajeSiDespachado(ctx.supabase, v.id)
    return { replica: await parches(() => parcheViaje(ctx, v.id), () => parcheMe(ctx)) }
  },
}

/** Resultado de una parada (valor ABSOLUTO: reenviar es inocuo). Payload = body de PATCH parada. */
const viajeParada: HandlerDef<{ viaje_id: string; parada_id: string; estado: string; bultos_entregados?: number; motivo_no_entrega?: string; motivo_no_cobro?: string }> = {
  tipo: "viaje.parada",
  roles: ROLES,
  validar: (p) => (esUuid(p?.viaje_id) && esUuid(p?.parada_id) && ["pendiente", "entregado", "entregado_parcial", "no_entregado", "solo_cobro"].includes(p?.estado) ? null : "Parada inválida"),
  async aplicar(ctx, m) {
    const { viaje_id, ...body } = m.payload
    await llamarRuta(paradaPATCH, ctx, { ruta: `/api/chofer/viaje/${viaje_id}/parada`, method: "PATCH", params: { id: viaje_id }, body })
    return { replica: await parches(() => parcheViaje(ctx, viaje_id)) }
  },
}

/** Payload = body de POST /api/chofer/viaje/[id]/cobro (+ fotos_pendientes). La clave de idempotencia es la de la operación. */
const viajeCobrar: HandlerDef<Record<string, any>> = {
  tipo: "viaje.cobrar",
  roles: ROLES,
  validar: (p) =>
    esUuid(p?.viaje_id) && esUuid(p?.cliente_id) && Number(p?.monto_total) > 0 && Array.isArray(p?.metodos) && p.metodos.length ? null : "Cobro incompleto",
  async aplicar(ctx, m) {
    // Fotos capturadas SIN señal: viajan en base64 dentro del cobro (fotos_pendientes) y
    // se suben acá, antes de registrar, para que queden en pago_comprobantes como las demás.
    const { viaje_id, fotos_pendientes, cliente_nombre: _n, ...resto } = m.payload
    const subidas = await subirFotosPendientes(ctx.admin, fotos_pendientes)
    const comprobante_urls = [...(Array.isArray(resto.comprobante_urls) ? resto.comprobante_urls : []), ...subidas.map((f) => ({ url: f.url, nombre: f.nombre }))]
    const r = await llamarRuta(cobroPOST, ctx, {
      ruta: `/api/chofer/viaje/${viaje_id}/cobro`,
      method: "POST",
      params: { id: viaje_id },
      body: { ...resto, comprobante_urls, idempotency_key: m.idempotency_key },
    })
    const clienteIds = [resto.cliente_id, ...((resto.cobros_extra as any[]) || []).map((c) => c?.cliente_id)].filter(esUuid)
    return { ...r, replica: await parches(() => parcheViaje(ctx, viaje_id), () => parcheClientes(ctx, viaje_id, clienteIds), () => parcheBilletera(ctx)) }
  },
}

const viajeCobroAnular: HandlerDef<{ viaje_id: string; pago_id: string; cliente_id: string }> = {
  tipo: "viaje.cobro_anular",
  roles: ROLES,
  validar: (p) => (esUuid(p?.viaje_id) && esUuid(p?.pago_id) && esUuid(p?.cliente_id) ? null : "Cobro inválido"),
  async aplicar(ctx, m) {
    const { viaje_id, pago_id, cliente_id } = m.payload
    const { data: pago } = await ctx.supabase.from("pagos_clientes").select("id, estado").eq("id", pago_id).maybeSingle()
    // Ya anulado (reintento tras un corte): éxito, no un rechazo
    if (pago && pago.estado !== "anulado") {
      await llamarRuta(cobroDELETE, ctx, { ruta: `/api/chofer/viaje/${viaje_id}/cobro/${pago_id}`, method: "DELETE", params: { id: viaje_id, pagoId: pago_id } })
    }
    return { replica: await parches(() => parcheViaje(ctx, viaje_id), () => parcheClientes(ctx, viaje_id, [cliente_id]), () => parcheBilletera(ctx)) }
  },
}

/** Payload = body de POST /api/chofer/viaje/[id]/devolucion + `id` generado en el equipo (la route deduplica por id). */
const viajeDevolucion: HandlerDef<Record<string, any>> = {
  tipo: "viaje.devolucion",
  roles: ROLES,
  validar: (p) => (esUuid(p?.viaje_id) && esUuid(p?.id) && esUuid(p?.cliente_id) && Array.isArray(p?.items) && p.items.length ? null : "Devolución incompleta"),
  async aplicar(ctx, m) {
    const { viaje_id, ...body } = m.payload
    const r = await llamarRuta(devolucionPOST, ctx, { ruta: `/api/chofer/viaje/${viaje_id}/devolucion`, method: "POST", params: { id: viaje_id }, body })
    return { ...r, replica: await parches(() => parcheViaje(ctx, viaje_id), () => parcheClientes(ctx, viaje_id, [body.cliente_id])) }
  },
}

/** Gasto del viaje (RPC viaje_gasto_registrar: idempotente por clave). Sin viaje: solo billetera. */
const viajeGasto: HandlerDef<{ viaje_id: string | null; categoria: string; monto: number; observaciones?: string | null; foto_url?: string | null }> = {
  tipo: "viaje.gasto",
  roles: ROLES,
  validar: (p) => (Number(p?.monto) > 0 && typeof p?.categoria === "string" && (p.viaje_id == null || esUuid(p.viaje_id)) ? null : "Gasto inválido"),
  async aplicar(ctx, m) {
    const { viaje_id, categoria, monto, observaciones, foto_url } = m.payload
    let r: any
    if (viaje_id) {
      r = await llamarRuta(gastoPOST, ctx, {
        ruta: "/api/chofer/billetera/gasto",
        method: "POST",
        body: { viaje_id, categoria, monto: Number(monto), observaciones: observaciones || "", foto_url: foto_url || null, idempotency_key: m.idempotency_key },
      })
    } else {
      // Gasto suelto (sin viaje): la web lo inserta directo en billetera_movimientos, sin
      // clave. Segunda defensa ante un reintento tras un corte: el mismo concepto y monto,
      // del mismo usuario, en los últimos 10 minutos, ya está registrado.
      const cat = categoria.charAt(0).toUpperCase() + categoria.slice(1)
      const concepto = `Gasto - ${cat}${observaciones ? `: ${observaciones}` : ""}`
      const { data: previo } = await ctx.admin
        .from("billetera_movimientos")
        .select("id")
        .eq("viajante_id", ctx.sesion.user.id)
        .eq("tipo", "debito")
        .eq("concepto", concepto)
        .eq("monto", -Math.abs(Number(monto)))
        .gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString())
        .limit(1)
      if (previo?.length) r = { success: true, movimiento_id: previo[0].id, dedup: true }
      else r = await llamarRuta(gastoPOST, ctx, { ruta: "/api/chofer/billetera/gasto", method: "POST", body: { categoria, monto: Number(monto), observaciones: observaciones || "" } })
    }
    return { ...r, replica: await parches(...(viaje_id ? [() => parcheViaje(ctx, viaje_id)] : []), () => parcheBilletera(ctx)) }
  },
}

/** Cierre del viaje: transición idempotente (si ya se rindió, éxito). Requiere las paradas cerradas (lo valida la web). */
const viajeFinalizar: HandlerDef<{ viaje_id: string; efectivo_declarado?: number; observaciones?: string | null }> = {
  tipo: "viaje.finalizar",
  roles: ROLES,
  validar: (p) => (esUuid(p?.viaje_id) ? null : "Viaje inválido"),
  async aplicar(ctx, m) {
    const { viaje_id, ...body } = m.payload
    const v = await viajeDe(ctx, viaje_id)
    let r: any
    if (v.estado === "en_rendicion" || v.estado === "completado") r = { success: true, estado: v.estado, dedup: true, mensaje: "El viaje ya estaba rendido." }
    else r = await llamarRuta(finalizarPOST, ctx, { ruta: `/api/chofer/viaje/${viaje_id}/finalizar`, method: "POST", params: { id: viaje_id }, body })
    return { ...r, replica: await parches(() => parcheViaje(ctx, viaje_id), () => parcheBilletera(ctx), () => parcheMe(ctx)) }
  },
}

export const HANDLERS_CHOFER: HandlerDef[] = [viajeIniciar, viajeParada, viajeCobrar, viajeCobroAnular, viajeDevolucion, viajeGasto, viajeFinalizar]
