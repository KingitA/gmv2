/**
 * Vigías de Jarvis: reglas fijas, rápidas y SIN IA que revisan los números
 * todos los días y anotan lo raro en la bandeja ("Lo que Jarvis notó").
 *
 * - detectar(): solo LEE. Devuelve candidatos.
 * - sincronizar(): escribe en ai_agenda_events (la bandeja de Jarvis):
 *     aviso nuevo            → se agrega
 *     aviso que sigue        → se actualiza (números de hoy)
 *     aviso que ya no está   → se cierra solo ("se resolvió")
 *     aviso descartado       → no vuelve, salvo que empeore 25 % o más
 *   Algunos vigías traen una PROPUESTA (ej. "¿retengo las entregas?"): va a
 *   "Para decidir" con Sí / No. Mismas reglas: si dicen que no, no se vuelve a
 *   proponer salvo que empeore; si ya no hace falta, se cierra sola.
 *   Nada se ejecuta sin el Sí de una persona.
 *
 * Los umbrales son "Reglas de Jarvis" (lib/jarvis/reglas.ts): los define una
 * persona desde la pantalla y cada cambio queda en la bitácora.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { sumarDiasISO } from "@/lib/formato"
import { pesosCorto } from "@/lib/playroom/bloques"
import { leerReglas, type Reglas } from "./reglas"
import { crearPropuesta } from "./agenda"
import { estadoIndicadores } from "./exterior"
import { fetchAllRows } from "@/lib/supabase/fetch-all"

const EMPEORA_PARA_REABRIR = 1.25 // un aviso descartado vuelve si empeora 25 %
const DIAS_REVISION_TRABADA = 1

export interface Candidato {
  clave: string
  vigia: string
  tono: "alerta" | "atencion" | "oportunidad"
  titulo: string
  detalle?: string
  acciones: { texto: string; pregunta: string }[]
  severidad: number
  entidad?: { tipo: string; id: string }
  datos: Record<string, unknown>
  /** si viene, va a "Para decidir" como propuesta (no como aviso) */
  propuesta?: { tipo: string; parametros: Record<string, unknown>; impacto: number }
}

type Fila = Record<string, unknown>
const n0 = (v: unknown) => Number(v) || 0
const lista = (xs: string[], max = 3) => (xs.length <= max ? xs.join(", ") : `${xs.slice(0, max).join(", ")} y ${xs.length - max} más`)

const CLAVE_RPC: Record<string, string> = { jarvis_deuda_antiguedad: "cliente_id", jarvis_clientes_habitos: "cliente_id", jarvis_proveedores_resumen: "proveedor_id" }
/** Sin el corte de 1.000 filas de PostgREST (ver herramientas.ts). */
async function rpc(db: SupabaseClient, fn: string, args: Fila): Promise<Fila[]> {
  try {
    if (CLAVE_RPC[fn]) return await fetchAllRows<Fila>(() => db.rpc(fn, args), CLAVE_RPC[fn])
    const { data, error } = await db.rpc(fn, args)
    if (error) throw error
    return (data ?? []) as Fila[]
  } catch (e) {
    throw new Error(`${fn}: ${(e as { message?: string })?.message ?? e}`)
  }
}

type Vigia = (db: SupabaseClient, hoy: string, r: Reglas) => Promise<Candidato[]>

/** Cliente con deuda vencida que volvió a comprar. */
const deudaYCompra: Vigia = async (db, hoy, r) => {
  const deuda = (await rpc(db, "jarvis_deuda_antiguedad", { p_zona_id: null, p_vendedor_id: null, p_cliente_id: null }))
    .map((f): Fila & { vencida: number } => ({ ...f, vencida: n0(f.d30_59) + n0(f.d60_89) + n0(f.d90_mas) }))
    .filter((f) => f.vencida >= r.regla_deuda_vencida_minima)
  if (!deuda.length) return []
  const { data: ret } = await db.from("clientes").select("id").in("id", deuda.map((d) => d.cliente_id as string)).eq("retener_entregas", true)
  const yaRetenidos = new Set(((ret ?? []) as { id: string }[]).map((c) => c.id))
  const desde = sumarDiasISO(hoy, -r.regla_dias_compra_reciente)
  const { data } = await db.from("pedidos").select("cliente_id, numero_pedido, fecha, total, estado")
    .in("cliente_id", deuda.map((d) => d.cliente_id as string)).neq("estado", "eliminado").gte("fecha", desde)
  const pedidos = (data ?? []) as Fila[]
  return deuda.flatMap((d): Candidato[] => {
    const ps = pedidos.filter((p) => p.cliente_id === d.cliente_id)
    if (!ps.length || yaRetenidos.has(String(d.cliente_id))) return []
    const nuevo = ps.reduce((s, p) => s + n0(p.total), 0)
    return [{
      clave: `retener_entregas:${d.cliente_id}`, vigia: "deuda_y_compra", tono: "alerta",
      titulo: `${d.cliente} volvió a pedir y debe ${pesosCorto(d.vencida)} con más de 30 días. ¿Le retengo las entregas hasta que pague?`,
      detalle: `Pedido nuevo por ${pesosCorto(nuevo)}. Su deuda más vieja tiene ${d.dias_mas_vieja} días${d.ultimo_pago ? "" : " y no registra pagos"}. Con el Sí, el chofer no le baja mercadería sin cobrar.`,
      acciones: [
        { texto: "Ver su cuenta", pregunta: `Contame de ${d.cliente}: deuda, pagos y cada cuánto compra` },
        { texto: "¿Qué hago?", pregunta: `${d.cliente} volvió a pedir debiendo más de 30 días. ¿Conviene retenerle la entrega hasta que pague? Mirá su historial.` },
      ],
      severidad: d.vencida, entidad: { tipo: "cliente", id: String(d.cliente_id) },
      datos: { deuda_vencida: d.vencida, saldo: n0(d.saldo), pedidos: ps.map((p) => p.numero_pedido) },
      propuesta: { tipo: "retener_entregas", parametros: { cliente_id: d.cliente_id, cliente: d.cliente, motivo: `debe ${pesosCorto(d.vencida)} con más de 30 días` }, impacto: d.vencida },
    }]
  })
}

/** Clientes habituales que dejaron de comprar (un solo aviso agrupado). */
const dejaronDeComprar: Vigia = async (db, _hoy, r) => {
  const filas = (await rpc(db, "jarvis_clientes_habitos", { p_meses: 4, p_zona_id: null, p_vendedor_id: null, p_cliente_id: null }))
    .filter((f) => n0(f.meses_con_compra) >= 2 && n0(f.dias_entre_compras) > 0 && n0(f.dias_sin_comprar) / n0(f.dias_entre_compras) > r.regla_atraso_habitual)
    .sort((a, b) => n0(b.venta_mensual_promedio) - n0(a.venta_mensual_promedio))
  if (!filas.length) return []
  const enJuego = filas.reduce((s, f) => s + n0(f.venta_mensual_promedio), 0)
  return [{
    clave: "dejaron-de-comprar", vigia: "dejaron_de_comprar", tono: "atencion",
    titulo: `${filas.length} cliente${filas.length === 1 ? "" : "s"} habitual${filas.length === 1 ? "" : "es"} dejaron de comprar a su ritmo`,
    detalle: `Entre ellos ${lista(filas.map((f) => String(f.cliente)))}. Juntos compraban ${pesosCorto(enJuego)} por mes.`,
    acciones: [
      { texto: "Ver la lista", pregunta: "Listame los clientes habituales que dejaron de comprar a su ritmo" },
      { texto: "¿De qué viajantes son?", pregunta: "De los clientes habituales que dejaron de comprar, ¿de qué viajantes y zonas son?" },
    ],
    severidad: enJuego, datos: { cantidad: filas.length, venta_mensual: enJuego, clientes: filas.slice(0, 10).map((f) => f.cliente) },
  }]
}

/** Artículos que se venden bien y les queda stock para pocos días. */
const sinStock: Vigia = async (db, _hoy, r) => {
  const filas = (await rpc(db, "jarvis_cobertura_stock", { p_proveedor_id: null, p_categoria: null, p_dias_base: 30, p_max_dias: r.regla_cobertura_max_dias, p_limite: 200 }))
    .filter((f) => n0(f.dias_cobertura) > 0 && n0(f.venta_diaria) >= r.regla_venta_diaria_minima)
  if (!filas.length) return []
  const valorDia = filas.reduce((s, f) => s + n0(f.venta_diaria) * n0(f.costo_unitario), 0)
  return [{
    clave: "sin-stock", vigia: "sin_stock", tono: "atencion",
    titulo: `${filas.length} artículo${filas.length === 1 ? "" : "s"} que se venden bien tienen stock para menos de ${r.regla_cobertura_max_dias} días`,
    detalle: `Entre ellos ${lista(filas.map((f) => String(f.articulo)))}. Según el stock cargado en el sistema.`,
    acciones: [
      { texto: "Ver cuáles", pregunta: `¿Qué artículos se quedan sin stock en menos de ${r.regla_cobertura_max_dias} días?` },
      { texto: "¿De qué proveedores?", pregunta: `De los artículos que se quedan sin stock en menos de ${r.regla_cobertura_max_dias} días, agrupalos por proveedor` },
    ],
    severidad: valorDia * 30, datos: { cantidad: filas.length, articulos: filas.slice(0, 15).map((f) => f.articulo) },
  }]
}

/** Pagos a proveedores de la semana y atrasados. */
const pagosSemana: Vigia = async (db, hoy) => {
  const { data } = await db.from("vencimientos").select("monto, fecha_vencimiento").eq("estado", "pendiente").lte("fecha_vencimiento", sumarDiasISO(hoy, 7))
  const vs = (data ?? []) as Fila[]
  const atrasado = vs.filter((v) => String(v.fecha_vencimiento) < hoy).reduce((s, v) => s + n0(v.monto), 0)
  const semana = vs.filter((v) => String(v.fecha_vencimiento) >= hoy).reduce((s, v) => s + n0(v.monto), 0)
  if (atrasado <= 0 && semana <= 0) return []
  return [{
    clave: "pagos-semana", vigia: "pagos_semana", tono: atrasado > 0 ? "alerta" : "atencion",
    titulo: atrasado > 0
      ? `Hay ${pesosCorto(atrasado)} atrasados a proveedores${semana > 0 ? ` y vencen ${pesosCorto(semana)} esta semana` : ""}`
      : `Esta semana vencen ${pesosCorto(semana)} a proveedores`,
    acciones: [{ texto: "Ver vencimientos", pregunta: "¿Qué tenemos que pagarle a proveedores esta semana y qué está atrasado?" }],
    severidad: atrasado * 2 + semana, datos: { atrasado, semana },
  }]
}

/** Cheques en cartera vencidos o que vencen en 3 días sin depositar. */
const chequesPorVencer: Vigia = async (db, hoy) => {
  const { data } = await db.from("cheques").select("monto, fecha_vencimiento").eq("estado", "EN_CARTERA").lte("fecha_vencimiento", sumarDiasISO(hoy, 3))
  const cs = (data ?? []) as Fila[]
  if (!cs.length) return []
  const vencidos = cs.filter((c) => String(c.fecha_vencimiento) < sumarDiasISO(hoy, -30))
  const total = cs.reduce((s, c) => s + n0(c.monto), 0)
  return [{
    clave: "cheques-por-vencer", vigia: "cheques", tono: vencidos.length ? "alerta" : "atencion",
    titulo: `${cs.length} cheque${cs.length === 1 ? "" : "s"} en cartera ya vencidos o por vencer (${pesosCorto(total)})`,
    detalle: vencidos.length ? `${vencidos.length} tienen fecha de hace más de 30 días: un cheque se puede depositar hasta 30 días después de su fecha.` : "Conviene depositarlos o entregarlos.",
    acciones: [{ texto: "Ver cuáles", pregunta: "Listame los cheques en cartera vencidos o que vencen en los próximos 3 días" }],
    severidad: total, datos: { cantidad: cs.length, total, mas_de_30_dias: vencidos.length },
  }]
}

/** Cobros cargados que Finanzas todavía no verificó. */
const cobrosSinVerificar: Vigia = async (db, hoy, r) => {
  const limite = sumarDiasISO(hoy, -r.regla_dias_cobro_sin_verificar)
  const { data } = await db.from("pagos_clientes").select("monto, created_at").in("estado", ["pendiente", "pendiente_rendicion"]).lt("created_at", `${limite}T23:59:59-03:00`)
  const ps = (data ?? []) as Fila[]
  if (!ps.length) return []
  const total = ps.reduce((s, p) => s + n0(p.monto), 0)
  return [{
    clave: "cobros-sin-verificar", vigia: "cobros_sin_verificar", tono: "atencion",
    titulo: `${ps.length} cobro${ps.length === 1 ? "" : "s"} por ${pesosCorto(total)} llevan más de ${r.regla_dias_cobro_sin_verificar} días sin verificar en Caja`,
    acciones: [{ texto: "¿Cuáles son?", pregunta: "¿Qué cobros están pendientes de verificar en Caja y desde cuándo?" }],
    severidad: total, datos: { cantidad: ps.length, total },
  }]
}

/** Pedidos de clientes nuevos esperando que la oficina los libere. */
const revisionTrabada: Vigia = async (db, hoy) => {
  const { data } = await db.from("pedidos").select("numero_pedido, total, fecha").eq("estado", "en_revision").lte("fecha", sumarDiasISO(hoy, -DIAS_REVISION_TRABADA))
  const ps = (data ?? []) as Fila[]
  if (!ps.length) return []
  const total = ps.reduce((s, p) => s + n0(p.total), 0)
  return [{
    clave: "revision-trabada", vigia: "revision_trabada", tono: "atencion",
    titulo: `${ps.length} pedido${ps.length === 1 ? "" : "s"} de cliente nuevo esperan revisión hace más de ${DIAS_REVISION_TRABADA} día`,
    detalle: `Por ${pesosCorto(total)}. Hasta que la oficina los libere no se preparan.`,
    acciones: [{ texto: "Ver pedidos", pregunta: "¿Qué pedidos están en revisión y de qué clientes?" }],
    severidad: total, datos: { pedidos: ps.map((p) => p.numero_pedido), total },
  }]
}

/** Cliente retenido que ya no tiene deuda vencida: proponer liberarlo. */
const retenidoAlDia: Vigia = async (db, _hoy, r) => {
  const { data, error } = await db.from("clientes").select("id, nombre, retener_desde").eq("retener_entregas", true)
  if (error || !data?.length) return []
  const deuda = await rpc(db, "jarvis_deuda_antiguedad", { p_zona_id: null, p_vendedor_id: null, p_cliente_id: null })
  const vencida = new Map(deuda.map((d) => [String(d.cliente_id), n0(d.d30_59) + n0(d.d60_89) + n0(d.d90_mas)]))
  return (data as { id: string; nombre: string; retener_desde: string | null }[])
    .filter((c) => (vencida.get(c.id) ?? 0) < r.regla_deuda_vencida_minima)
    .map((c): Candidato => ({
      clave: `liberar_entregas:${c.id}`, vigia: "retenido_al_dia", tono: "oportunidad",
      titulo: `${c.nombre} ya no tiene deuda vencida. ¿Le libero las entregas?`,
      detalle: `Tiene las entregas retenidas desde ${c.retener_desde ? c.retener_desde.slice(8, 10) + "/" + c.retener_desde.slice(5, 7) : "antes"}. Deuda con más de 30 días hoy: ${pesosCorto(vencida.get(c.id) ?? 0)}.`,
      acciones: [{ texto: "Ver su cuenta", pregunta: `Contame de ${c.nombre}: deuda, pagos y cada cuánto compra` }],
      severidad: 1, entidad: { tipo: "cliente", id: c.id }, datos: { vencida: vencida.get(c.id) ?? 0 },
      propuesta: { tipo: "liberar_entregas", parametros: { cliente_id: c.id, cliente: c.nombre }, impacto: 0 },
    }))
}

/**
 * Compra anticipada (PLAN.md §5, el ejemplo del petróleo): un insumo sube afuera,
 * un proveedor que depende de ese insumo todavía no aumentó → proponer armar un
 * pedido antes. El Sí abre la orden de compra prellenada; no compra nada solo.
 */
const HISTORIAL_PRECIOS_DESDE = "2026-09-18" // desde acá hay historial de precios de artículos
const compraAnticipada: Vigia = async (db, hoy, r) => {
  const [indicadores, { data: insumos }] = await Promise.all([
    estadoIndicadores(db),
    db.from("ai_insumos").select("insumo, nombre, indicadores").eq("activo", true),
  ])
  const suba = new Map(indicadores.filter((i) => i.clave !== "inflacion_mensual" && (i.variacion_30d ?? 0) >= r.regla_suba_insumo_pct).map((i) => [i.clave, i]))
  if (!suba.size) return []
  // insumo "en suba" = alguno de sus indicadores subió (el que más subió manda)
  const enSuba = new Map<string, { nombre: string; ind: (typeof indicadores)[number] }>()
  for (const ins of (insumos ?? []) as { insumo: string; nombre: string; indicadores: string[] }[]) {
    const peor = ins.indicadores.map((c) => suba.get(c)).filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => (b.variacion_30d ?? 0) - (a.variacion_30d ?? 0))[0]
    if (peor) enSuba.set(ins.insumo, { nombre: ins.nombre, ind: peor })
  }
  if (!enSuba.size) return []
  const [perfiles, resumen] = await Promise.all([
    rpc(db, "jarvis_proveedor_insumos", { p_proveedor_id: null }),
    rpc(db, "jarvis_proveedores_resumen", { p_proveedor_id: null }),
  ])
  const porProv = new Map(resumen.map((p) => [String(p.proveedor_id), p]))
  const diasHistorial = Math.round((Date.parse(hoy) - Date.parse(HISTORIAL_PRECIOS_DESDE)) / 86_400_000)
  const out: Candidato[] = []
  for (const pf of perfiles) {
    const s = enSuba.get(String(pf.insumo))
    if (!s || n0(pf.participacion_pct) < r.regla_participacion_insumo) continue
    const p = porProv.get(String(pf.proveedor_id))
    if (!p || n0(p.venta_30d) <= 0 || n0(p.oc_abiertas) > 0) continue
    const diasSin = p.dias_sin_aumento == null ? diasHistorial : n0(p.dias_sin_aumento)
    if (diasSin < r.regla_dias_sin_aumento) continue
    const var30 = s.ind.variacion_30d ?? 0
    const costoMes = n0(p.costo_30d) > 0 ? n0(p.costo_30d) : n0(p.venta_30d) * 0.7
    const ahorro = Math.round(costoMes * (var30 / 100))
    const sinTxt = p.dias_sin_aumento == null ? "no tiene aumentos cargados desde que hay registro (18/09)" : `no aumenta hace ${diasSin} días`
    out.push({
      clave: `armar_orden_compra:${pf.proveedor_id}`, vigia: "compra_anticipada", tono: "oportunidad",
      titulo: `${s.ind.nombre} subió ${var30} % en el mes y ${pf.proveedor} (${Math.round(n0(pf.participacion_pct))} % ${s.nombre.toLowerCase()}) ${sinTxt}. ¿Armamos un pedido antes?`,
      detalle: `Le compramos unos ${pesosCorto(costoMes)} por mes. Si aumenta en línea con el insumo, comprar antes ahorraría cerca de ${pesosCorto(ahorro)}. Fuente del dato de afuera: ${s.ind.fuente ?? "búsqueda web"} (${s.ind.fecha}).`,
      acciones: [{ texto: "Ver el proveedor", pregunta: `Contame de ${pf.proveedor}: qué le compramos, cuándo aumentó y de qué insumos depende` }],
      severidad: ahorro, entidad: { tipo: "proveedor", id: String(pf.proveedor_id) },
      datos: { insumo: pf.insumo, indicador: s.ind.clave, variacion_30d: var30, participacion: n0(pf.participacion_pct), dias_sin_aumento: diasSin, costo_mes: costoMes },
      propuesta: { tipo: "armar_orden_compra", parametros: { proveedor_id: pf.proveedor_id, proveedor: pf.proveedor }, impacto: ahorro },
    })
  }
  return out
}

export const VIGIAS: Record<string, Vigia> = {
  compra_anticipada: compraAnticipada,
  retenido_al_dia: retenidoAlDia,
  deuda_y_compra: deudaYCompra,
  dejaron_de_comprar: dejaronDeComprar,
  sin_stock: sinStock,
  pagos_semana: pagosSemana,
  cheques: chequesPorVencer,
  cobros_sin_verificar: cobrosSinVerificar,
  revision_trabada: revisionTrabada,
}

/** Corre todos los vigías. Si uno falla, los demás siguen (y se informa cuál falló). */
export async function detectar(db: SupabaseClient, hoy: string): Promise<{ candidatos: Candidato[]; fallaron: string[] }> {
  const fallaron: string[] = []
  const { reglas } = await leerReglas(db)
  const res = await Promise.all(Object.entries(VIGIAS).map(async ([nombre, v]) => {
    try { return await v(db, hoy, reglas) } catch (e) { console.error(`[jarvis] vigía ${nombre}`, e); fallaron.push(nombre); return [] }
  }))
  return { candidatos: res.flat(), fallaron }
}

type Ultimo = { id: string; clave: string; status: string; severidad: number; vigia: string }

/**
 * Lo último que hay en la bandeja para cada clave en juego, más todo lo que sigue
 * pendiente de ese tipo (para poder cerrarlo si el vigía ya no lo ve). Sin
 * ventanas fijas de filas: no se pierde un "No" viejo ni queda un pendiente huérfano.
 */
async function ultimoPorClave(db: SupabaseClient, tipo: "aviso" | "propuesta", claves: string[], soloDeVigias: boolean) {
  const ultimo = new Map<string, Ultimo>()
  const cols = "id, clave, status, severidad, vigia, created_at"
  for (let i = 0; i < claves.length; i += 100) {
    const { data } = await db.from("ai_agenda_events").select(cols).eq("event_type", tipo).in("clave", claves.slice(i, i + 100)).order("created_at", { ascending: false })
    for (const e of (data ?? []) as Ultimo[]) if (!ultimo.has(e.clave)) ultimo.set(e.clave, e)
  }
  let q = db.from("ai_agenda_events").select(cols).eq("event_type", tipo).eq("status", "pendiente").not("clave", "is", null)
  if (soloDeVigias) q = q.not("vigia", "is", null)
  const { data: pend } = await q
  for (const e of (pend ?? []) as Ultimo[]) if (!ultimo.has(e.clave)) ultimo.set(e.clave, e)
  return ultimo
}

/** Pasa los candidatos a la bandeja (ai_agenda_events): avisos y propuestas. */
export async function sincronizar(db: SupabaseClient, candidatos: Candidato[], fallaron: string[]) {
  const avisos = await sincronizarAvisos(db, candidatos.filter((c) => !c.propuesta), fallaron)
  const propuestas = await sincronizarPropuestas(db, candidatos.filter((c) => c.propuesta), fallaron)
  return { nuevos: avisos.nuevos + propuestas.nuevos, actualizados: avisos.actualizados + propuestas.actualizados, cerrados: avisos.cerrados + propuestas.cerrados }
}

async function sincronizarPropuestas(db: SupabaseClient, candidatos: Candidato[], fallaron: string[]) {
  const ahora = new Date().toISOString()
  const ultimo = await ultimoPorClave(db, "propuesta", candidatos.map((c) => c.clave), true)

  let nuevos = 0, actualizados = 0, cerrados = 0
  const vistos = new Set<string>()
  for (const c of candidatos) {
    vistos.add(c.clave)
    const prev = ultimo.get(c.clave)
    if (prev?.status === "pendiente" || prev?.status === "en_progreso") {
      await db.from("ai_agenda_events").update({ title: c.titulo, description: c.detalle ?? null, severidad: Math.round(c.severidad), impacto_estimado: c.propuesta!.impacto || null, metadata: c.datos, updated_at: ahora }).eq("id", prev.id).eq("status", "pendiente")
      actualizados++
      continue
    }
    // Dijeron que no: no se insiste salvo que empeore
    if (prev?.status === "cancelada" && c.severidad < Number(prev.severidad) * EMPEORA_PARA_REABRIR) continue
    await crearPropuesta(db, {
      titulo: c.titulo, detalle: c.detalle, accion: { tipo: c.propuesta!.tipo, parametros: c.propuesta!.parametros },
      impactoEstimado: c.propuesta!.impacto || null, tono: c.tono, usuarioId: null, entidad: c.entidad ?? null,
      clave: c.clave, vigia: c.vigia, severidad: c.severidad, datos: c.datos,
    })
    nuevos++
  }
  // Propuestas de vigías que ya no hacen falta (ej. el cliente pagó antes de que alguien decida)
  for (const e of ultimo.values()) {
    if (e.status !== "pendiente" || vistos.has(e.clave) || fallaron.includes(e.vigia)) continue
    await db.from("ai_agenda_events").update({ status: "completada", cerrado_at: ahora, cierre_nota: "Ya no hace falta (el vigía ya no lo ve)", updated_at: ahora }).eq("id", e.id).eq("status", "pendiente")
    cerrados++
  }
  return { nuevos, actualizados, cerrados }
}

async function sincronizarAvisos(db: SupabaseClient, candidatos: Candidato[], fallaron: string[]) {
  const ahora = new Date().toISOString()
  const ultimo = await ultimoPorClave(db, "aviso", candidatos.map((c) => c.clave), false)

  let nuevos = 0, actualizados = 0, cerrados = 0
  const vistos = new Set<string>()
  for (const c of candidatos) {
    vistos.add(c.clave)
    const fila = {
      title: c.titulo, description: c.detalle ?? null, tono: c.tono, acciones: c.acciones, severidad: Math.round(c.severidad),
      metadata: c.datos, related_entity_type: c.entidad?.tipo ?? null, related_entity_id: c.entidad?.id ?? null, updated_at: ahora,
    }
    const prev = ultimo.get(c.clave)
    if (prev?.status === "pendiente") {
      await db.from("ai_agenda_events").update(fila).eq("id", prev.id).eq("status", "pendiente")
      actualizados++
      continue
    }
    if (prev?.status === "cancelada" && c.severidad < Number(prev.severidad) * EMPEORA_PARA_REABRIR) continue // descartado y no empeoró
    const { error } = await db.from("ai_agenda_events").insert({
      ...fila, clave: c.clave, vigia: c.vigia, event_type: "aviso", source: "jarvis", status: "pendiente",
      priority: c.tono === "alerta" ? "alta" : "media",
    })
    if (!error) nuevos++
    else if (error.code !== "23505") throw new Error(error.message) // 23505 = ya hay uno vivo (otra revisión en paralelo)
  }
  // Lo que ya no se cumple se cierra solo (salvo que el vigía que lo genera haya fallado hoy)
  for (const e of ultimo.values()) {
    if (e.status !== "pendiente" || vistos.has(e.clave) || fallaron.includes(e.vigia)) continue
    await db.from("ai_agenda_events").update({ status: "completada", cerrado_at: ahora, cierre_nota: "Se resolvió (el vigía ya no lo ve)", updated_at: ahora }).eq("id", e.id).eq("status", "pendiente")
    cerrados++
  }
  return { nuevos, actualizados, cerrados }
}
