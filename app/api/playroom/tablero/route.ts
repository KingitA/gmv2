import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireAuth } from "@/lib/auth"
import { todayArgentina } from "@/lib/utils"
import { fetchAllRows } from "@/lib/playroom/queries"
import { ESTADOS_PREPARABLES } from "@/lib/deposito/picking"
import type { Bloque, Comparacion } from "@/lib/playroom/bloques"
import { pesosCorto } from "@/lib/playroom/bloques"
import { CATALOGO_TABLERO } from "@/lib/playroom/catalogo-tablero"

// Tablero de Playroom: calcula SOLO las tarjetas pedidas (?ids=a,b,c), leyendo la base.
// Nada de esto modifica datos. Ventas = pedidos tomados (no eliminados): coincide con el
// kardex de ventas y se consulta mucho más rápido. Deuda = libro mayor (v_saldo_clientes).
export const maxDuration = 30

const sumar = (xs: any[], f: (x: any) => number) => xs.reduce((t, x) => t + (Number(f(x)) || 0), 0)
const pct = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null)
const fmtPct = (n: number) => `${Math.abs(n).toLocaleString("es-AR", { maximumFractionDigits: 0 })}%`

function comparar(actual: number, anterior: number, contra: string, subirEsBueno = true): Comparacion | undefined {
  const v = pct(actual, anterior)
  if (v == null) return undefined
  if (Math.abs(v) < 0.5) return { texto: `= igual ${contra}`, tono: "neutro" }
  const sube = v > 0
  return { texto: `${sube ? "▲" : "▼"} ${fmtPct(v)} ${contra}`, tono: sube === subirEsBueno ? "bien" : "mal" }
}

/** Rango del mes actual hasta hoy y el mismo tramo del mes anterior (Argentina) */
function periodos(hoy: string) {
  const [a, m, d] = hoy.split("-").map(Number)
  const inicio = `${a}-${String(m).padStart(2, "0")}-01`
  const pa = m === 1 ? a - 1 : a
  const pm = m === 1 ? 12 : m - 1
  const ultimoDiaPrev = new Date(Date.UTC(pa, pm, 0)).getUTCDate()
  const prevInicio = `${pa}-${String(pm).padStart(2, "0")}-01`
  const prevFin = `${pa}-${String(pm).padStart(2, "0")}-${String(Math.min(d, ultimoDiaPrev)).padStart(2, "0")}`
  const nombreMes = (mm: number) => ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"][mm - 1]
  return { inicio, fin: hoy, prevInicio, prevFin, dia: d, mesPrev: nombreMes(pm) }
}

function sumarDias(iso: string, dias: number) {
  const t = new Date(iso + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + dias)
  return t.toISOString().slice(0, 10)
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  const pedidos = new URL(req.url).searchParams.get("ids")?.split(",").map(s => s.trim()).filter(Boolean) ?? []
  const validos = new Set(CATALOGO_TABLERO.map(t => t.id))
  const ids = [...new Set(pedidos)].filter(id => validos.has(id))
  if (ids.length === 0) return NextResponse.json({ bloques: {} })

  const sb = createAdminClient()
  const hoy = todayArgentina()
  const P = periodos(hoy)
  const quiere = (...xs: string[]) => xs.some(x => ids.includes(x))

  // ── Fuentes compartidas: se piden una sola vez y solo si alguna tarjeta las necesita ──
  const necesitaPedidos = quiere("ventas_mes", "ventas_hoy", "ticket_promedio", "clientes_compraron", "grafico_ventas_dia", "ventas_por_zona", "ventas_por_viajante")
  const pedidosMes = necesitaPedidos
    ? fetchAllRows(() => sb.from("pedidos")
        .select("id, fecha, total, cliente_id, vendedor_id, clientes(localidades(zonas(nombre)))")
        .neq("estado", "eliminado").gte("fecha", P.prevInicio).lte("fecha", P.fin), "id")
    : Promise.resolve([] as any[])
  const necesitaArticulos = quiere("margen_bruto", "top_articulos", "ventas_por_rubro")
  const articulos = necesitaArticulos
    ? fetchAllRows(() => sb.rpc("playroom_articulos_vendidos", { p_from: P.inicio, p_to: P.fin, p_prev_from: P.prevInicio, p_prev_to: P.prevFin }), "articulo_id")
    : Promise.resolve([] as any[])
  const vendedores = quiere("ventas_por_viajante")
    ? fetchAllRows(() => sb.from("vendedores").select("id, nombre"))
    : Promise.resolve([] as any[])

  const calcular: Record<string, () => Promise<Bloque>> = {
    async ventas_mes() {
      const ps = await pedidosMes
      const act = sumar(ps.filter(p => p.fecha >= P.inicio), p => p.total)
      const ant = sumar(ps.filter(p => p.fecha <= P.prevFin), p => p.total)
      return { tipo: "numero", titulo: "Ventas del mes", valor: act, formato: "pesos", comparacion: comparar(act, ant, `vs. ${P.mesPrev}`) }
    },
    async ventas_hoy() {
      const ps = await pedidosMes
      const hoyT = sumar(ps.filter(p => p.fecha === hoy), p => p.total)
      const mes = sumar(ps.filter(p => p.fecha >= P.inicio && p.fecha < hoy), p => p.total)
      const prom = P.dia > 1 ? mes / (P.dia - 1) : 0
      return { tipo: "numero", titulo: "Ventas de hoy", valor: hoyT, formato: "pesos", comparacion: prom > 0 ? comparar(hoyT, prom, "vs. promedio diario") : undefined }
    },
    async ticket_promedio() {
      const ps = await pedidosMes
      const act = ps.filter(p => p.fecha >= P.inicio), ant = ps.filter(p => p.fecha <= P.prevFin)
      const tA = act.length ? sumar(act, p => p.total) / act.length : 0
      const tB = ant.length ? sumar(ant, p => p.total) / ant.length : 0
      return { tipo: "numero", titulo: "Ticket promedio", valor: Math.round(tA), formato: "pesos", comparacion: comparar(tA, tB, `vs. ${P.mesPrev}`) }
    },
    async clientes_compraron() {
      const ps = await pedidosMes
      const a = new Set(ps.filter(p => p.fecha >= P.inicio).map(p => p.cliente_id)).size
      const b = new Set(ps.filter(p => p.fecha <= P.prevFin).map(p => p.cliente_id)).size
      return { tipo: "numero", titulo: "Clientes que compraron", valor: a, formato: "numero", comparacion: comparar(a, b, `vs. ${P.mesPrev}`) }
    },
    async margen_bruto() {
      const rows = await articulos
      const neto = sumar(rows, r => r.neto), costo = sumar(rows, r => r.costo)
      return {
        tipo: "numero", titulo: "Margen bruto", formato: "porcentaje",
        valor: neto > 0 ? Math.round(((neto - costo) / neto) * 1000) / 10 : null,
        nota: "Según el costo cargado en cada artículo",
      }
    },
    async grafico_ventas_dia() {
      const ps = await pedidosMes
      const porDia = (desde: string, hasta: string) => {
        const m = new Map<number, number>()
        for (const p of ps) if (p.fecha >= desde && p.fecha <= hasta) { const d = Number(String(p.fecha).slice(8, 10)); m.set(d, (m.get(d) || 0) + (Number(p.total) || 0)) }
        return m
      }
      const act = porDia(P.inicio, P.fin), ant = porDia(P.prevInicio, P.prevFin)
      let accA = 0, accB = 0
      const datos = Array.from({ length: P.dia }, (_, i) => {
        accA += act.get(i + 1) || 0; accB += ant.get(i + 1) || 0
        return { dia: i + 1, actual: Math.round(accA), anterior: Math.round(accB) }
      })
      return {
        tipo: "grafico", titulo: "Ventas acumuladas del mes", forma: "lineas", formato: "pesos",
        x: { clave: "dia", titulo: "Día del mes", formato: "numero" },
        series: [{ clave: "actual", titulo: "Este mes" }, { clave: "anterior", titulo: `Mismo tramo de ${P.mesPrev}` }],
        datos,
      }
    },
    async ventas_por_zona() {
      const ps = (await pedidosMes).filter(p => p.fecha >= P.inicio)
      const m = new Map<string, number>()
      for (const p of ps) { const z = (p as any).clientes?.localidades?.zonas?.nombre || "Sin zona"; m.set(z, (m.get(z) || 0) + (Number(p.total) || 0)) }
      return barras("Ventas por zona", "zona", m)
    },
    async ventas_por_viajante() {
      const [ps, vs] = await Promise.all([pedidosMes, vendedores])
      const nombres = new Map(vs.map((v: any) => [v.id, v.nombre]))
      const m = new Map<string, number>()
      for (const p of ps.filter(p => p.fecha >= P.inicio)) { const n = (p.vendedor_id && nombres.get(p.vendedor_id)) || "Sin viajante"; m.set(n, (m.get(n) || 0) + (Number(p.total) || 0)) }
      return barras("Ventas por viajante", "viajante", m)
    },
    async ventas_por_rubro() {
      const rows = await articulos
      const m = new Map<string, number>()
      for (const r of rows) { const c = r.categoria || "Sin categoría"; m.set(c, (m.get(c) || 0) + (Number(r.neto) || 0)) }
      return { ...barras("Ventas por categoría", "categoria", m), nota: "Sin IVA" }
    },
    async top_articulos() {
      const rows = (await articulos).filter(r => Number(r.neto) > 0).sort((a, b) => Number(b.neto) - Number(a.neto)).slice(0, 5)
      return {
        tipo: "tabla", titulo: "Top 5 artículos del mes", nota: "Venta sin IVA",
        columnas: [{ clave: "articulo", titulo: "Artículo" }, { clave: "unidades", titulo: "Unidades", formato: "numero" }, { clave: "venta", titulo: "Venta", formato: "pesos" }],
        filas: rows.map(r => ({ articulo: r.descripcion, unidades: Math.round(Number(r.unidades) || 0), venta: Math.round(Number(r.neto) || 0) })),
      }
    },
    async cobrado_mes() {
      const [act, ant] = await Promise.all([
        fetchAllRows(() => sb.from("pagos_clientes").select("id, monto").eq("estado", "confirmado").gte("fecha_pago", P.inicio).lte("fecha_pago", P.fin), "id"),
        fetchAllRows(() => sb.from("pagos_clientes").select("id, monto").eq("estado", "confirmado").gte("fecha_pago", P.prevInicio).lte("fecha_pago", P.prevFin), "id"),
      ])
      const a = sumar(act, p => p.monto), b = sumar(ant, p => p.monto)
      return { tipo: "numero", titulo: "Cobrado del mes", valor: a, formato: "pesos", comparacion: comparar(a, b, `vs. ${P.mesPrev}`) }
    },
    async deuda_clientes() {
      const s = await fetchAllRows(() => sb.from("v_saldo_clientes").select("cliente_id, saldo_actual"), "cliente_id")
      const deben = s.filter((x: any) => Number(x.saldo_actual) > 0.5)
      return {
        tipo: "numero", titulo: "Deuda de clientes", valor: sumar(deben, x => x.saldo_actual), formato: "pesos",
        comparacion: { texto: `${deben.length} cliente${deben.length === 1 ? "" : "s"} con saldo`, tono: "neutro" },
      }
    },
    async cobros_pendientes() {
      const ps = await fetchAllRows(() => sb.from("pagos_clientes").select("id, monto").in("estado", ["pendiente", "pendiente_rendicion"]), "id")
      return {
        tipo: "numero", titulo: "Cobros por verificar", valor: sumar(ps, p => p.monto), formato: "pesos",
        comparacion: { texto: `${ps.length} cobro${ps.length === 1 ? "" : "s"} esperando a Finanzas`, tono: ps.length ? "mal" : "neutro" },
      }
    },
    async clientes_mas_deben() {
      const s = (await fetchAllRows(() => sb.from("v_saldo_clientes").select("cliente_id, saldo_actual"), "cliente_id"))
        .filter((x: any) => Number(x.saldo_actual) > 0.5)
        .sort((a: any, b: any) => Number(b.saldo_actual) - Number(a.saldo_actual)).slice(0, 5)
      const { data: cs } = await sb.from("clientes").select("id, nombre, nombre_razon_social").in("id", s.map((x: any) => x.cliente_id))
      const n = new Map((cs || []).map((c: any) => [c.id, c.nombre || c.nombre_razon_social]))
      return {
        tipo: "tabla", titulo: "Clientes que más deben",
        columnas: [{ clave: "cliente", titulo: "Cliente" }, { clave: "saldo", titulo: "Debe", formato: "pesos" }],
        filas: s.map((x: any) => ({ cliente: n.get(x.cliente_id) || "—", saldo: Math.round(Number(x.saldo_actual)) })),
      }
    },
    async pedidos_preparar() {
      const [{ count: total }, { count: prio }] = await Promise.all([
        sb.from("pedidos").select("id", { count: "exact", head: true }).in("estado", ESTADOS_PREPARABLES),
        sb.from("pedidos").select("id", { count: "exact", head: true }).in("estado", ESTADOS_PREPARABLES).gt("prioridad", 0),
      ])
      return { tipo: "numero", titulo: "Pedidos para preparar", valor: total ?? 0, formato: "numero", comparacion: { texto: `${prio ?? 0} con prioridad`, tono: "neutro" } }
    },
    async viajes_calle() {
      const [{ count: curso }, { count: rend }] = await Promise.all([
        sb.from("viajes").select("id", { count: "exact", head: true }).eq("estado", "en_curso"),
        sb.from("viajes").select("id", { count: "exact", head: true }).eq("estado", "en_rendicion"),
      ])
      return { tipo: "numero", titulo: "Viajes en la calle", valor: curso ?? 0, formato: "numero", comparacion: { texto: `${rend ?? 0} esperando rendición`, tono: "neutro" } }
    },
    async devoluciones_mes() {
      const ds = await fetchAllRows(() => sb.from("devoluciones").select("id, monto_total").gte("created_at", P.inicio), "id")
      return { tipo: "numero", titulo: "Devoluciones del mes", valor: ds.length, formato: "numero", comparacion: { texto: `por ${pesosCorto(sumar(ds, d => d.monto_total))}`, tono: "neutro" } }
    },
    async pagos_7dias() {
      const [prox, atras] = await Promise.all([
        fetchAllRows(() => sb.from("vencimientos").select("id, monto").eq("estado", "pendiente").gte("fecha_vencimiento", hoy).lte("fecha_vencimiento", sumarDias(hoy, 7)), "id"),
        fetchAllRows(() => sb.from("vencimientos").select("id, monto").eq("estado", "pendiente").lt("fecha_vencimiento", hoy), "id"),
      ])
      const atrasado = sumar(atras, v => v.monto)
      return {
        tipo: "numero", titulo: "Pagos próximos 7 días", valor: sumar(prox, v => v.monto), formato: "pesos",
        comparacion: atrasado > 0
          ? { texto: `+ ${pesosCorto(atrasado)} atrasados`, tono: "mal" }
          : { texto: `${prox.length} vencimiento${prox.length === 1 ? "" : "s"}`, tono: "neutro" },
      }
    },
    async oc_abiertas() {
      const { count } = await sb.from("ordenes_compra").select("id", { count: "exact", head: true }).not("estado", "in", "(recibida_completa,cancelada,anulada)")
      return { tipo: "numero", titulo: "Órdenes de compra abiertas", valor: count ?? 0, formato: "numero" }
    },
    async cheques_cartera() {
      const cs = await fetchAllRows(() => sb.from("cheques").select("id, monto").eq("estado", "EN_CARTERA"), "id")
      return { tipo: "numero", titulo: "Cheques en cartera", valor: sumar(cs, c => c.monto), formato: "pesos", comparacion: { texto: `${cs.length} cheque${cs.length === 1 ? "" : "s"}`, tono: "neutro" } }
    },
    async stock_valorizado() {
      const rows = await fetchAllRows(() => sb.rpc("playroom_chat_stock", { p_stock_min: 1, p_rubro: null, p_sin_movimiento_dias: null }), "sku")
      return { tipo: "numero", titulo: "Stock valorizado", valor: sumar(rows, r => r.capital), formato: "pesos", nota: "Depende de que el stock esté cargado", comparacion: { texto: `${rows.length} artículos con stock`, tono: "neutro" } }
    },
    async sin_movimiento() {
      const rows = await fetchAllRows(() => sb.rpc("playroom_chat_stock", { p_stock_min: 1, p_rubro: null, p_sin_movimiento_dias: 60 }), "sku")
      return { tipo: "numero", titulo: "Artículos sin movimiento", valor: rows.length, formato: "numero", nota: "Con stock y sin ventas en 60 días" }
    },
  }

  const bloques: Record<string, Bloque | { error: string }> = {}
  await Promise.all(ids.map(async id => {
    try { bloques[id] = await calcular[id]() }
    catch (e: any) { console.error("[playroom/tablero]", id, e?.message); bloques[id] = { error: "No se pudo calcular este dato" } }
  }))
  return NextResponse.json({ bloques, hoy })
}

function barras(titulo: string, clave: string, m: Map<string, number>): Bloque {
  const orden = [...m.entries()].sort((a, b) => b[1] - a[1])
  // Más de 8 barras no se leen: el resto se junta en "Otras"
  const top = orden.slice(0, 7)
  const resto = orden.slice(7).reduce((t, [, v]) => t + v, 0)
  const datos = [...top.map(([k, v]) => ({ [clave]: k, venta: Math.round(v) })), ...(resto > 0 ? [{ [clave]: "Otras", venta: Math.round(resto) }] : [])]
  return { tipo: "grafico", titulo, forma: "barras", formato: "pesos", x: { clave }, series: [{ clave: "venta", titulo: "Venta" }], datos }
}
