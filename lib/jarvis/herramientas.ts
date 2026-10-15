/**
 * Herramientas de Jarvis: las "ventanillas" por donde pide datos al sistema.
 *
 * - Las de datos son de SOLO LECTURA. Las únicas que escriben son las de la
 *   AGENDA de Jarvis (recordatorios y propuestas): anotan algo para que una
 *   persona lo vea y decida; nunca cambian datos del negocio.
 * - Cada una es una consulta fija y probada: Jarvis no puede inventar SQL.
 * - Cada una devuelve:
 *     consultado → qué revisó, en palabras simples (se muestra "Revisé…")
 *     datos      → resumen compacto para que la IA razone (nunca miles de filas)
 *     bloques    → tablas / números / gráficos listos para dibujar. Cada bloque
 *                  trae `recalcular`, así se puede fijar en el tablero y
 *                  actualizarse solo SIN IA (/api/playroom/recalcular).
 * - Las cuentas se hacen en la base (RPC jarvis_* y playroom_*), no en Node.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Bloque, Formato } from "@/lib/playroom/bloques"
import { calcularIndicadores } from "@/lib/playroom/indicadores"
import { CATALOGO_TABLERO } from "@/lib/playroom/catalogo-tablero"
import { fetchAllRows } from "@/lib/playroom/queries"
import { fecha, hoyISO, sumarDiasISO } from "@/lib/formato"
import { PERIODOS, resolverPeriodo, type Rango } from "./periodos"
import { ACCIONES, ACCION_PIDE } from "./acciones"
import { agendaPendiente, crearPropuesta, crearRecordatorio, ErrorAgenda, historialDecisiones, usuariosOficina } from "./agenda"
import { estadoIndicadores } from "./exterior"
import { cobertura } from "./clasificador"
import { estadoPlanMes, mesSiguiente } from "@/lib/viajes/plan-mes"
import { ausenciasEntre } from "@/lib/viajes/calendario-laboral"

export interface Contexto {
  db: SupabaseClient
  hoy: string
  /** quién pregunta (null = proceso automático o examen: no se agenda nada) */
  usuarioId: string | null
  conversacionId?: string | null
}

export interface Resultado {
  consultado: string
  datos: unknown
  bloques: Bloque[]
}

type Params = Record<string, unknown>

export interface Herramienta {
  nombre: string
  descripcion: string
  esquema: { type: "object"; properties: Record<string, unknown>; required?: string[] }
  ejecutar: (ctx: Contexto, p: Params) => Promise<Resultado>
}

/** Error que se le muestra a la IA tal cual (ej. "no encontré ese cliente"). */
export class ErrorHerramienta extends Error {}

// ─── utilidades ────────────────────────────────────────────────────────────
const num = (v: unknown): number | null => (v == null || v === "" ? null : Number(v))
const n0 = (v: unknown): number => Number(v) || 0
const red = (v: number, dec = 0) => Math.round(v * 10 ** dec) / 10 ** dec
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null)
const limite = (v: unknown, def = 15, max = 50) => Math.max(1, Math.min(max, Number(v) || def))
const fechaSola = (v: unknown) => (v == null ? null : String(v).slice(0, 10))
const variacion = (a: number, b: number) => (b > 0 ? red(((a - b) / b) * 100, 1) : null)
const margenPct = (neto: number, costo: number) => (neto > 0 && costo > 0 ? red(((neto - costo) / neto) * 100, 1) : null)

/**
 * Llamada a una función de la base, SIN el corte de 1.000 filas de PostgREST:
 * las que pueden devolver muchas filas se piden por páginas, ordenadas por su
 * clave (el orden "lindo" se arma después, en cada herramienta).
 */
const CLAVE_RPC: Record<string, string> = {
  jarvis_deuda_antiguedad: "cliente_id", jarvis_clientes_habitos: "cliente_id", jarvis_ventas: "clave_id",
  jarvis_proveedores_resumen: "proveedor_id", playroom_articulos_vendidos: "articulo_id", playroom_comisiones_viajantes: "vendedor_id",
}
async function rpc<T = Record<string, unknown>>(db: SupabaseClient, fn: string, args: Params): Promise<T[]> {
  const clave = CLAVE_RPC[fn]
  try {
    if (clave) return await fetchAllRows<T>(() => db.rpc(fn, args), clave)
    const { data, error } = await db.rpc(fn, args)
    if (error) throw error
    return (data ?? []) as T[]
  } catch (e) {
    throw new Error(`${fn}: ${e instanceof Error ? e.message : (e as { message?: string })?.message ?? e}`)
  }
}

/** Busca por nombre en una tabla chica (zonas, vendedores, proveedores). */
async function resolverNombre(db: SupabaseClient, tabla: "zonas" | "vendedores" | "proveedores", texto: string, que: string) {
  const { data, error } = await db.from(tabla).select("id, nombre").ilike("nombre", `%${texto.replace(/[%_]/g, "")}%`).limit(8)
  if (error) throw new Error(error.message)
  const filas = (data ?? []) as { id: string; nombre: string }[]
  if (filas.length === 0) throw new ErrorHerramienta(`No encontré ${que} "${texto}".`)
  const exacto = filas.find((f) => f.nombre.toLowerCase() === texto.toLowerCase())
  if (exacto) return exacto
  if (filas.length > 1) throw new ErrorHerramienta(`Hay varios ${que}s que coinciden con "${texto}": ${filas.map((f) => f.nombre).join(", ")}. Preguntá cuál.`)
  return filas[0]
}

async function resolverCliente(db: SupabaseClient, texto: string) {
  const limpio = texto.replace(/[%_,()]/g, " ").trim()
  const { data, error } = await db
    .from("clientes")
    .select("id, nombre, nombre_razon_social, codigo_cliente")
    .or(`nombre.ilike.%${limpio}%,nombre_razon_social.ilike.%${limpio}%,codigo_cliente.eq.${limpio}`)
    .limit(8)
  if (error) throw new Error(error.message)
  const filas = (data ?? []) as { id: string; nombre: string | null; nombre_razon_social: string | null; codigo_cliente: string | null }[]
  const nombreDe = (f: (typeof filas)[number]) => f.nombre || f.nombre_razon_social || "(sin nombre)"
  if (filas.length === 0) throw new ErrorHerramienta(`No encontré ningún cliente "${texto}".`)
  const exacto = filas.find((f) => [f.nombre, f.nombre_razon_social, f.codigo_cliente].some((x) => x?.toLowerCase() === texto.toLowerCase()))
  if (exacto) return { id: exacto.id, nombre: nombreDe(exacto) }
  if (filas.length > 1) throw new ErrorHerramienta(`Hay varios clientes que coinciden con "${texto}": ${filas.map(nombreDe).join(", ")}. Preguntá cuál.`)
  return { id: filas[0].id, nombre: nombreDe(filas[0]) }
}

function tabla(
  titulo: string,
  columnas: { clave: string; titulo: string; formato?: Formato }[],
  filas: Record<string, string | number | null>[],
  extra: { total?: Record<string, number>; nota?: string } = {},
): Extract<Bloque, { tipo: "tabla" }> {
  return { tipo: "tabla", titulo, columnas, filas: filas.slice(0, 50), ...extra }
}

const P_PERIODO = {
  periodo: { type: "string", enum: [...PERIODOS], description: "Período con nombre. Preferilo a fechas sueltas: así la tarjeta fijada se actualiza sola." },
  desde: { type: "string", description: "Fecha inicial AAAA-MM-DD (solo si el usuario pidió fechas exactas)" },
  hasta: { type: "string", description: "Fecha final AAAA-MM-DD" },
}
const P_LIMITE = { limite: { type: "integer", description: "Cuántas filas mostrar (máx. 50, por defecto 15)" } }

// ─── 1. Indicadores del tablero ────────────────────────────────────────────
const indicadoresTablero: Herramienta = {
  nombre: "indicadores_tablero",
  descripcion:
    "Los indicadores fijos del tablero de Playroom, con las MISMAS cuentas que muestra la pantalla. Usala para preguntas generales de cómo venimos (ventas del mes, cobrado, deuda total, margen, pedidos para preparar, pagos de la semana, cheques, stock valorizado…). Ids: " +
    CATALOGO_TABLERO.map((t) => `${t.id} (${t.descripcion})`).join("; "),
  esquema: {
    type: "object",
    properties: { ids: { type: "array", items: { type: "string", enum: CATALOGO_TABLERO.map((t) => t.id) }, description: "Uno o más ids" } },
    required: ["ids"],
  },
  async ejecutar(ctx, p) {
    const ids = Array.isArray(p.ids) ? (p.ids as string[]) : []
    const { bloques } = await calcularIndicadores(ctx.db, ids)
    const lista: Bloque[] = []
    const datos: Record<string, unknown> = {}
    for (const id of ids) {
      const b = bloques[id]
      if (!b || "error" in b) { datos[id] = "no se pudo calcular"; continue }
      lista.push({ ...b, recalcular: { herramienta: "indicadores_tablero", parametros: { ids: [id] } } })
      datos[id] = b.tipo === "numero" ? { valor: b.valor, comparacion: b.comparacion?.texto, nota: b.nota } : b.tipo === "tabla" ? b.filas : b.datos
    }
    const titulos = ids.map((id) => CATALOGO_TABLERO.find((t) => t.id === id)?.titulo).filter(Boolean)
    return { consultado: `Indicadores del tablero: ${titulos.join(", ")}`, datos, bloques: lista }
  },
}

// ─── 2. Ventas ─────────────────────────────────────────────────────────────
const AGRUPAR = ["total", "cliente", "articulo", "vendedor", "zona", "proveedor", "categoria", "dia", "semana", "mes"] as const

const ventas: Herramienta = {
  nombre: "ventas",
  descripcion:
    "Ventas (pedidos tomados, no eliminados) de un período, agrupadas como se pida, con margen y comparación contra el período anterior del mismo largo. 'total' = con IVA; 'neto' = sin IVA. Filtros opcionales por zona, vendedor (viajante), cliente, proveedor o categoría (por nombre).",
  esquema: {
    type: "object",
    properties: {
      ...P_PERIODO,
      agrupar_por: { type: "string", enum: [...AGRUPAR] },
      zona: { type: "string" }, vendedor: { type: "string" }, cliente: { type: "string" },
      proveedor: { type: "string" }, categoria: { type: "string" },
      ...P_LIMITE,
    },
    required: ["agrupar_por"],
  },
  async ejecutar(ctx, p) {
    const r = resolverPeriodo(p as never, "mes_actual", ctx.hoy)
    const agrupar = (AGRUPAR as readonly string[]).includes(String(p.agrupar_por)) ? String(p.agrupar_por) : "total"
    const filtros: string[] = []
    const args: Params = { p_agrupar: agrupar, p_zona_id: null, p_vendedor_id: null, p_cliente_id: null, p_proveedor_id: null, p_categoria: null }
    if (str(p.zona)) { const z = await resolverNombre(ctx.db, "zonas", str(p.zona)!, "la zona"); args.p_zona_id = z.id; filtros.push(`zona ${z.nombre}`) }
    if (str(p.vendedor)) { const v = await resolverNombre(ctx.db, "vendedores", str(p.vendedor)!, "el vendedor"); args.p_vendedor_id = v.id; filtros.push(`viajante ${v.nombre}`) }
    if (str(p.cliente)) { const c = await resolverCliente(ctx.db, str(p.cliente)!); args.p_cliente_id = c.id; filtros.push(`cliente ${c.nombre}`) }
    if (str(p.proveedor)) { const pr = await resolverNombre(ctx.db, "proveedores", str(p.proveedor)!, "el proveedor"); args.p_proveedor_id = pr.id; filtros.push(`proveedor ${pr.nombre}`) }
    if (str(p.categoria)) { args.p_categoria = `%${str(p.categoria)}%`; filtros.push(`categoría ${str(p.categoria)}`) }

    const esTiempo = ["dia", "semana", "mes"].includes(agrupar)
    const [act, ant] = await Promise.all([
      rpc(ctx.db, "jarvis_ventas", { ...args, p_desde: r.desde, p_hasta: r.hasta }),
      esTiempo ? Promise.resolve([]) : rpc(ctx.db, "jarvis_ventas", { ...args, p_desde: r.prevDesde, p_hasta: r.prevHasta }),
    ])
    act.sort((a, b) => n0(b.total) - n0(a.total))
    const prev = new Map(ant.map((f) => [String(f.clave_id), n0(f.total)]))
    const totAct = act.reduce((s, f) => s + n0(f.total), 0)
    const totAnt = ant.reduce((s, f) => s + n0(f.total), 0)
    const netoAct = act.reduce((s, f) => s + n0(f.neto), 0)
    const costoAct = act.reduce((s, f) => s + n0(f.costo), 0)
    const lim = limite(p.limite, esTiempo ? 60 : 15, 60)
    const filtroTxt = filtros.length ? ` (${filtros.join(", ")})` : ""
    const recalcular = { herramienta: "ventas", parametros: { ...p } }
    const consultado = `Ventas ${r.etiqueta}${filtroTxt}${esTiempo ? "" : `, comparadas con ${r.prevDesde.slice(8, 10)}/${r.prevDesde.slice(5, 7)}–${r.prevHasta.slice(8, 10)}/${r.prevHasta.slice(5, 7)}`}`

    if (agrupar === "total") {
      const f = act[0]
      const bloque: Bloque = {
        tipo: "numero", titulo: `Ventas ${r.etiqueta}${filtroTxt}`, valor: red(totAct), formato: "pesos", recalcular,
        comparacion: totAnt > 0 ? { texto: `${totAct >= totAnt ? "▲" : "▼"} ${Math.abs(variacion(totAct, totAnt) ?? 0)}% vs. período anterior`, tono: totAct >= totAnt ? "bien" : "mal" } : undefined,
      }
      return {
        consultado,
        datos: { periodo: r, total_con_iva: red(totAct), neto: red(netoAct), margen_pct: margenPct(netoAct, costoAct), pedidos: num(f?.pedidos), clientes: num(f?.clientes), total_periodo_anterior: red(totAnt), variacion_pct: variacion(totAct, totAnt) },
        bloques: [bloque],
      }
    }

    if (esTiempo) {
      const datos = act
        .map((f) => ({ x: String(f.clave), venta: red(n0(f.total)) }))
        .sort((a, b) => a.x.localeCompare(b.x))
        .slice(-lim)
      const bloque: Bloque = {
        tipo: "grafico", titulo: `Ventas por ${agrupar} — ${r.etiqueta}${filtroTxt}`, forma: datos.length > 1 ? "lineas" : "barras", formato: "pesos",
        x: { clave: "x", formato: agrupar === "mes" ? "texto" : "fecha" }, series: [{ clave: "venta", titulo: "Venta" }], datos, recalcular,
      }
      return { consultado, datos: { periodo: r, total: red(totAct), serie: datos }, bloques: [bloque] }
    }

    const filas = act.map((f) => {
      const t = n0(f.total)
      return {
        nombre: String(f.clave), venta: red(t), neto: red(n0(f.neto)), margen: margenPct(n0(f.neto), n0(f.costo)),
        participacion: totAct > 0 ? red((t / totAct) * 100, 1) : null,
        variacion: variacion(t, prev.get(String(f.clave_id)) ?? 0), pedidos: num(f.pedidos), clientes: num(f.clientes),
      }
    })
    const top = filas.slice(0, lim)
    const resto = filas.slice(lim)
    const etiquetas: Record<string, string> = { cliente: "Cliente", articulo: "Artículo", vendedor: "Viajante", zona: "Zona", proveedor: "Proveedor", categoria: "Categoría" }
    const bloque = tabla(
      `Ventas por ${(etiquetas[agrupar] ?? agrupar).toLowerCase()} — ${r.etiqueta}${filtroTxt}`,
      [
        { clave: "nombre", titulo: etiquetas[agrupar] ?? "" },
        { clave: "venta", titulo: "Venta", formato: "pesos" },
        { clave: "participacion", titulo: "% del total", formato: "porcentaje" },
        { clave: "variacion", titulo: "vs. anterior", formato: "porcentaje" },
        { clave: "margen", titulo: "Margen", formato: "porcentaje" },
      ],
      top,
      { total: { venta: red(totAct) }, nota: resto.length ? `Se muestran ${top.length} de ${filas.length}. Margen según el costo cargado en cada artículo.` : "Margen según el costo cargado en cada artículo." },
    )
    return {
      consultado,
      datos: {
        periodo: r, total_con_iva: red(totAct), total_periodo_anterior: red(totAnt), variacion_total_pct: variacion(totAct, totAnt),
        margen_total_pct: margenPct(netoAct, costoAct), cantidad: filas.length, filas: top,
        resto: resto.length ? { cantidad: resto.length, venta: red(resto.reduce((s, f) => s + f.venta, 0)) } : null,
      },
      bloques: [{ ...bloque, recalcular }],
    }
  },
}

// ─── 3. Deuda de clientes por antigüedad ───────────────────────────────────
const deudaClientes: Herramienta = {
  nombre: "deuda_clientes",
  descripcion:
    "Lo que deben los clientes según la cuenta corriente (libro mayor, la fuente oficial de deuda), separado por antigüedad: 0-29, 30-59, 60-89 y 90+ días desde la compra que todavía no se pagó. Incluye última compra y último pago. Filtros por zona, vendedor o cliente.",
  esquema: {
    type: "object",
    properties: {
      zona: { type: "string" }, vendedor: { type: "string" }, cliente: { type: "string" },
      min_dias: { type: "integer", description: "Solo clientes cuya deuda más vieja tiene al menos estos días" },
      ...P_LIMITE,
    },
  },
  async ejecutar(ctx, p) {
    const args: Params = { p_zona_id: null, p_vendedor_id: null, p_cliente_id: null }
    const filtros: string[] = []
    if (str(p.zona)) { const z = await resolverNombre(ctx.db, "zonas", str(p.zona)!, "la zona"); args.p_zona_id = z.id; filtros.push(`zona ${z.nombre}`) }
    if (str(p.vendedor)) { const v = await resolverNombre(ctx.db, "vendedores", str(p.vendedor)!, "el vendedor"); args.p_vendedor_id = v.id; filtros.push(`viajante ${v.nombre}`) }
    if (str(p.cliente)) { const c = await resolverCliente(ctx.db, str(p.cliente)!); args.p_cliente_id = c.id; filtros.push(`cliente ${c.nombre}`) }
    const minDias = Number(p.min_dias) || 0
    const todas = (await rpc(ctx.db, "jarvis_deuda_antiguedad", args)).sort((a, b) => n0(b.saldo) - n0(a.saldo))
    const filas = todas
      .filter((f) => (num(f.dias_mas_vieja) ?? 0) >= minDias)
      .map((f) => ({
        cliente: String(f.cliente), zona: (f.zona as string) ?? null, vendedor: (f.vendedor as string) ?? null,
        saldo: red(n0(f.saldo)), d0_29: red(n0(f.d0_29)), d30_59: red(n0(f.d30_59)), d60_89: red(n0(f.d60_89)), d90_mas: red(n0(f.d90_mas)),
        dias_mas_vieja: num(f.dias_mas_vieja), ultima_compra: fechaSola(f.ultima_compra), ultimo_pago: fechaSola(f.ultimo_pago),
      }))
    const lim = limite(p.limite, 20)
    const suma = (k: keyof (typeof filas)[number]) => red(filas.reduce((s, f) => s + n0(f[k]), 0))
    const total = { saldo: suma("saldo"), d0_29: suma("d0_29"), d30_59: suma("d30_59"), d60_89: suma("d60_89"), d90_mas: suma("d90_mas") }
    const filtroTxt = filtros.length ? ` (${filtros.join(", ")})` : ""
    const bloque = tabla(
      `Deuda por antigüedad${filtroTxt}${minDias ? ` — más de ${minDias} días` : ""}`,
      [
        { clave: "cliente", titulo: "Cliente" }, { clave: "zona", titulo: "Zona" },
        { clave: "saldo", titulo: "Debe", formato: "pesos" },
        { clave: "d0_29", titulo: "0-29 d", formato: "pesos" }, { clave: "d30_59", titulo: "30-59 d", formato: "pesos" },
        { clave: "d60_89", titulo: "60-89 d", formato: "pesos" }, { clave: "d90_mas", titulo: "90+ d", formato: "pesos" },
        { clave: "ultima_compra", titulo: "Última compra", formato: "fecha" },
      ],
      filas.slice(0, lim),
      { total, nota: "Según cuenta corriente. Lo pagado cancela primero lo más viejo." },
    )
    return {
      consultado: `Cuentas corrientes de ${todas.length} clientes con saldo${filtroTxt}`,
      datos: { clientes_con_deuda: filas.length, totales: total, filas: filas.slice(0, lim) },
      bloques: [{ ...bloque, recalcular: { herramienta: "deuda_clientes", parametros: { ...p } } }],
    }
  },
}

// ─── 4. Hábitos de compra (quién dejó de comprar) ──────────────────────────
const clientesHabitos: Herramienta = {
  nombre: "clientes_habitos",
  descripcion:
    "Hábitos de compra de los clientes en los últimos N meses: cada cuántos días compran, cuánto compran por mes en promedio, última compra y días sin comprar. Sirve para encontrar clientes habituales que dejaron de comprar (atraso = días sin comprar dividido días entre compras; más de 1,5 es raro).",
  esquema: {
    type: "object",
    properties: {
      meses: { type: "integer", description: "Meses de historia a mirar (por defecto 4; hay datos desde junio 2026)" },
      zona: { type: "string" }, vendedor: { type: "string" },
      solo_atrasados: { type: "boolean", description: "Solo clientes habituales (compraron en 2+ meses) con atraso mayor a 1,5" },
      min_dias_sin_comprar: { type: "integer" },
      orden: { type: "string", enum: ["venta", "atraso", "dias_sin_comprar"] },
      ...P_LIMITE,
    },
  },
  async ejecutar(ctx, p) {
    const meses = Math.max(1, Math.min(12, Number(p.meses) || 4))
    const args: Params = { p_meses: meses, p_zona_id: null, p_vendedor_id: null, p_cliente_id: null }
    const filtros: string[] = []
    if (str(p.zona)) { const z = await resolverNombre(ctx.db, "zonas", str(p.zona)!, "la zona"); args.p_zona_id = z.id; filtros.push(`zona ${z.nombre}`) }
    if (str(p.vendedor)) { const v = await resolverNombre(ctx.db, "vendedores", str(p.vendedor)!, "el vendedor"); args.p_vendedor_id = v.id; filtros.push(`viajante ${v.nombre}`) }
    const todas = await rpc(ctx.db, "jarvis_clientes_habitos", args)
    let filas = todas.map((f) => {
      const entre = num(f.dias_entre_compras), sin = n0(f.dias_sin_comprar)
      return {
        cliente: String(f.cliente), zona: (f.zona as string) ?? null, vendedor: (f.vendedor as string) ?? null,
        venta_mensual: red(n0(f.venta_mensual_promedio)), meses_con_compra: n0(f.meses_con_compra), pedidos: n0(f.pedidos),
        dias_entre_compras: entre, ultima_compra: fechaSola(f.ultima_compra), dias_sin_comprar: sin,
        atraso: entre && entre > 0 ? red(sin / entre, 1) : null,
      }
    })
    if (p.solo_atrasados) filas = filas.filter((f) => f.meses_con_compra >= 2 && (f.atraso ?? 0) > 1.5)
    if (Number(p.min_dias_sin_comprar) > 0) filas = filas.filter((f) => f.dias_sin_comprar >= Number(p.min_dias_sin_comprar))
    const orden = String(p.orden || (p.solo_atrasados ? "venta" : "venta"))
    filas.sort((a, b) => orden === "atraso" ? (b.atraso ?? 0) - (a.atraso ?? 0) : orden === "dias_sin_comprar" ? b.dias_sin_comprar - a.dias_sin_comprar : b.venta_mensual - a.venta_mensual)
    const lim = limite(p.limite, 20)
    const filtroTxt = filtros.length ? ` (${filtros.join(", ")})` : ""
    const bloque = tabla(
      `${p.solo_atrasados ? "Clientes habituales que dejaron de comprar" : "Hábitos de compra"}${filtroTxt}`,
      [
        { clave: "cliente", titulo: "Cliente" }, { clave: "zona", titulo: "Zona" },
        { clave: "venta_mensual", titulo: "Compra por mes", formato: "pesos" },
        { clave: "dias_entre_compras", titulo: "Compra cada (días)", formato: "numero" },
        { clave: "ultima_compra", titulo: "Última compra", formato: "fecha" },
        { clave: "dias_sin_comprar", titulo: "Días sin comprar", formato: "numero" },
      ],
      filas.slice(0, lim),
      { nota: `Últimos ${meses} meses de pedidos.` },
    )
    return {
      consultado: `Pedidos de los últimos ${meses} meses de ${todas.length} clientes${filtroTxt}`,
      datos: { cantidad: filas.length, venta_mensual_en_juego: red(filas.reduce((s, f) => s + f.venta_mensual, 0)), filas: filas.slice(0, lim) },
      bloques: [{ ...bloque, recalcular: { herramienta: "clientes_habitos", parametros: { ...p } } }],
    }
  },
}

// ─── 5. Ficha de un cliente ────────────────────────────────────────────────
const fichaCliente: Herramienta = {
  nombre: "ficha_cliente",
  descripcion:
    "Todo sobre UN cliente: datos (zona, viajante, condición de pago, lista), deuda por antigüedad, hábitos de compra, compras por mes, artículos que más compra y pedidos abiertos.",
  esquema: { type: "object", properties: { cliente: { type: "string", description: "Nombre, razón social o código" } }, required: ["cliente"] },
  async ejecutar(ctx, p) {
    const c = await resolverCliente(ctx.db, String(p.cliente ?? ""))
    const desde6 = sumarDiasISO(ctx.hoy, -182)
    const desde90 = sumarDiasISO(ctx.hoy, -89)
    const [info, deuda, habitos, porMes, arts, abiertos] = await Promise.all([
      ctx.db.from("clientes")
        .select("nombre, nombre_razon_social, codigo_cliente, cuit, condicion_pago, metodo_facturacion, activo, localidades(nombre, zonas(nombre)), vendedores(nombre), listas_precio:lista_precio_id(nombre)")
        .eq("id", c.id).maybeSingle(),
      rpc(ctx.db, "jarvis_deuda_antiguedad", { p_cliente_id: c.id, p_zona_id: null, p_vendedor_id: null }),
      rpc(ctx.db, "jarvis_clientes_habitos", { p_meses: 6, p_cliente_id: c.id, p_zona_id: null, p_vendedor_id: null }),
      rpc(ctx.db, "jarvis_ventas", { p_desde: desde6, p_hasta: ctx.hoy, p_agrupar: "mes", p_cliente_id: c.id, p_zona_id: null, p_vendedor_id: null, p_proveedor_id: null, p_categoria: null }),
      rpc(ctx.db, "playroom_articulos_vendidos", { p_from: desde90, p_to: ctx.hoy, p_prev_from: desde90, p_prev_to: ctx.hoy, p_cliente_ids: [c.id] }),
      ctx.db.from("pedidos").select("numero_pedido, fecha, estado, total").eq("cliente_id", c.id)
        .in("estado", ["pendiente", "en_revision", "impreso", "en_preparacion", "en_viaje"]).order("fecha", { ascending: false }).limit(10),
    ])
    const i = (info.data ?? {}) as Record<string, any>
    const d = deuda[0]
    const h = habitos[0]
    const serie = porMes.map((f) => ({ mes: String(f.clave), venta: red(n0(f.total)) })).sort((a, b) => a.mes.localeCompare(b.mes))
    const top = arts.filter((a) => n0(a.neto) > 0).sort((a, b) => n0(b.neto) - n0(a.neto)).slice(0, 10)
      .map((a) => ({ articulo: String(a.descripcion), unidades: red(n0(a.unidades)), venta: red(n0(a.neto)) }))
    const bloques: Bloque[] = [
      {
        tipo: "grafico", titulo: `${c.nombre} — compras por mes`, forma: "barras", formato: "pesos",
        x: { clave: "mes" }, series: [{ clave: "venta", titulo: "Compras" }], datos: serie,
        recalcular: { herramienta: "ficha_cliente", parametros: { cliente: p.cliente, _bloque: 0 } },
      },
      {
        ...tabla(`${c.nombre} — lo que más compra (90 días)`,
          [{ clave: "articulo", titulo: "Artículo" }, { clave: "unidades", titulo: "Unidades", formato: "numero" }, { clave: "venta", titulo: "Venta sin IVA", formato: "pesos" }], top),
        recalcular: { herramienta: "ficha_cliente", parametros: { cliente: p.cliente, _bloque: 1 } },
      },
    ]
    return {
      consultado: `Ficha, cuenta corriente, pedidos y compras de los últimos 6 meses de ${c.nombre}`,
      datos: {
        cliente: c.nombre, razon_social: i.nombre_razon_social, codigo: i.codigo_cliente, activo: i.activo,
        zona: i.localidades?.zonas?.nombre ?? null, localidad: i.localidades?.nombre ?? null, viajante: i.vendedores?.nombre ?? null,
        condicion_pago: i.condicion_pago, facturacion: i.metodo_facturacion, lista: i.listas_precio?.nombre ?? null,
        deuda: d ? { saldo: red(n0(d.saldo)), d0_29: red(n0(d.d0_29)), d30_59: red(n0(d.d30_59)), d60_89: red(n0(d.d60_89)), d90_mas: red(n0(d.d90_mas)), ultimo_pago: fechaSola(d.ultimo_pago) } : "sin deuda",
        habitos: h ? { compra_cada_dias: num(h.dias_entre_compras), venta_mensual: red(n0(h.venta_mensual_promedio)), ultima_compra: fechaSola(h.ultima_compra), dias_sin_comprar: num(h.dias_sin_comprar) } : "sin compras en 6 meses",
        compras_por_mes: serie, articulos_top: top,
        pedidos_abiertos: (abiertos.data ?? []).map((x: any) => ({ numero: x.numero_pedido, fecha: x.fecha, estado: x.estado, total: red(n0(x.total)) })),
      },
      bloques,
    }
  },
}

// ─── 6. Artículos vendidos ─────────────────────────────────────────────────
const articulosVendidos: Herramienta = {
  nombre: "articulos_vendidos",
  descripcion:
    "Artículos vendidos en un período (venta sin IVA, unidades, margen, variación contra el período anterior). Orden: venta, unidades, crecimiento, caida o margen. Filtros por cliente, vendedor, proveedor o categoría.",
  esquema: {
    type: "object",
    properties: {
      ...P_PERIODO,
      cliente: { type: "string" }, vendedor: { type: "string" }, proveedor: { type: "string" }, categoria: { type: "string" },
      orden: { type: "string", enum: ["venta", "unidades", "crecimiento", "caida", "margen"] },
      ...P_LIMITE,
    },
  },
  async ejecutar(ctx, p) {
    const r = resolverPeriodo(p as never, "mes_actual", ctx.hoy)
    const args: Params = { p_from: r.desde, p_to: r.hasta, p_prev_from: r.prevDesde, p_prev_to: r.prevHasta }
    const filtros: string[] = []
    if (str(p.cliente)) { const c = await resolverCliente(ctx.db, str(p.cliente)!); args.p_cliente_ids = [c.id]; filtros.push(`cliente ${c.nombre}`) }
    if (str(p.vendedor)) { const v = await resolverNombre(ctx.db, "vendedores", str(p.vendedor)!, "el vendedor"); args.p_vendedor_ids = [v.id]; filtros.push(`viajante ${v.nombre}`) }
    let provId: string | null = null
    if (str(p.proveedor)) { const pr = await resolverNombre(ctx.db, "proveedores", str(p.proveedor)!, "el proveedor"); provId = pr.id; filtros.push(`proveedor ${pr.nombre}`) }
    const cat = str(p.categoria)?.toLowerCase() ?? null
    if (cat) filtros.push(`categoría ${cat}`)
    const filasRaw = await fetchAllRows<Record<string, unknown>>(() => ctx.db.rpc("playroom_articulos_vendidos", args), "articulo_id")
    let filas = filasRaw
      .filter((a) => (!provId || a.proveedor_id === provId) && (!cat || String(a.categoria ?? "").toLowerCase().includes(cat)))
      .map((a) => ({
        articulo: String(a.descripcion), categoria: (a.categoria as string) ?? null,
        unidades: red(n0(a.unidades)), venta: red(n0(a.neto)), venta_anterior: red(n0(a.neto_prev)),
        variacion: variacion(n0(a.neto), n0(a.neto_prev)), margen: margenPct(n0(a.neto), n0(a.costo)),
      }))
      .filter((a) => a.venta !== 0 || a.venta_anterior !== 0)
    const orden = String(p.orden || "venta")
    const clave: Record<string, (a: (typeof filas)[number]) => number> = {
      venta: (a) => -a.venta, unidades: (a) => -a.unidades, margen: (a) => -(a.margen ?? -999),
      crecimiento: (a) => -((a.venta - a.venta_anterior)), caida: (a) => a.venta - a.venta_anterior,
    }
    filas = filas.sort((a, b) => (clave[orden] ?? clave.venta)(a) - (clave[orden] ?? clave.venta)(b))
    const lim = limite(p.limite)
    const tot = filas.reduce((s, a) => s + a.venta, 0)
    const filtroTxt = filtros.length ? ` (${filtros.join(", ")})` : ""
    const bloque = tabla(
      `Artículos — ${r.etiqueta}${filtroTxt}`,
      [
        { clave: "articulo", titulo: "Artículo" }, { clave: "unidades", titulo: "Unidades", formato: "numero" },
        { clave: "venta", titulo: "Venta sin IVA", formato: "pesos" }, { clave: "variacion", titulo: "vs. anterior", formato: "porcentaje" },
        { clave: "margen", titulo: "Margen", formato: "porcentaje" },
      ],
      filas.slice(0, lim),
      { nota: `Se muestran ${Math.min(lim, filas.length)} de ${filas.length}. Margen según el costo cargado.` },
    )
    return {
      consultado: `Kardex de ventas por artículo ${r.etiqueta}${filtroTxt}`,
      datos: { periodo: r, articulos: filas.length, venta_total_sin_iva: red(tot), filas: filas.slice(0, lim) },
      bloques: [{ ...bloque, recalcular: { herramienta: "articulos_vendidos", parametros: { ...p } } }],
    }
  },
}

// ─── 7. Cobertura de stock ─────────────────────────────────────────────────
const coberturaStock: Herramienta = {
  nombre: "cobertura_stock",
  descripcion:
    "Cuántos días alcanza el stock de cada artículo al ritmo de venta actual (los que se quedan antes primero). OJO: el stock cargado no siempre es real; stock negativo = sin dato. Filtros por proveedor o categoría.",
  esquema: {
    type: "object",
    properties: {
      proveedor: { type: "string" }, categoria: { type: "string" },
      max_dias: { type: "number", description: "Solo los que alcanzan para menos de N días" },
      dias_base: { type: "integer", description: "Días de venta para calcular el ritmo (por defecto 60)" },
      ...P_LIMITE,
    },
  },
  async ejecutar(ctx, p) {
    const args: Params = { p_proveedor_id: null, p_categoria: null, p_dias_base: Number(p.dias_base) || 60, p_max_dias: p.max_dias == null ? null : Number(p.max_dias), p_limite: limite(p.limite, 20) }
    const filtros: string[] = []
    if (str(p.proveedor)) { const pr = await resolverNombre(ctx.db, "proveedores", str(p.proveedor)!, "el proveedor"); args.p_proveedor_id = pr.id; filtros.push(`proveedor ${pr.nombre}`) }
    if (str(p.categoria)) { args.p_categoria = `%${str(p.categoria)}%`; filtros.push(`categoría ${str(p.categoria)}`) }
    const rows = await rpc(ctx.db, "jarvis_cobertura_stock", args)
    const filas = rows.map((f) => ({
      articulo: String(f.articulo), proveedor: (f.proveedor as string) ?? null, stock: num(f.stock),
      venta_diaria: num(f.venta_diaria), dias_cobertura: num(f.dias_cobertura),
    }))
    const filtroTxt = filtros.length ? ` (${filtros.join(", ")})` : ""
    const bloque = tabla(
      `Cobertura de stock${filtroTxt}`,
      [
        { clave: "articulo", titulo: "Artículo" }, { clave: "proveedor", titulo: "Proveedor" },
        { clave: "stock", titulo: "Stock", formato: "numero" }, { clave: "venta_diaria", titulo: "Vende por día", formato: "numero" },
        { clave: "dias_cobertura", titulo: "Alcanza (días)", formato: "numero" },
      ],
      filas,
      { nota: `Ritmo de venta de los últimos ${args.p_dias_base} días. Sin dato = stock mal cargado.` },
    )
    return {
      consultado: `Stock y ventas de los últimos ${args.p_dias_base} días${filtroTxt}`,
      datos: { filas, sin_dato_de_stock: filas.filter((f) => f.dias_cobertura == null).length },
      bloques: [{ ...bloque, recalcular: { herramienta: "cobertura_stock", parametros: { ...p } } }],
    }
  },
}

// ─── 8. Proveedores ────────────────────────────────────────────────────────
const proveedores: Herramienta = {
  nombre: "proveedores",
  descripcion:
    "Resumen por proveedor: cuánto vendemos de lo suyo (30 días), último aumento de costo cargado (historial de precios desde el 18/09/2026), aumento promedio de los últimos 90 días, deuda con él, próximo vencimiento y órdenes de compra abiertas. Orden: venta, deuda, sin_aumento (los que hace más que no aumentan) o aumento.",
  esquema: {
    type: "object",
    properties: { proveedor: { type: "string" }, orden: { type: "string", enum: ["venta", "deuda", "sin_aumento", "aumento"] }, ...P_LIMITE },
  },
  async ejecutar(ctx, p) {
    let pid: string | null = null
    let nombre = ""
    if (str(p.proveedor)) { const pr = await resolverNombre(ctx.db, "proveedores", str(p.proveedor)!, "el proveedor"); pid = pr.id; nombre = pr.nombre }
    const rows = await rpc(ctx.db, "jarvis_proveedores_resumen", { p_proveedor_id: pid })
    let filas = rows.map((f) => ({
      proveedor: String(f.proveedor), articulos: n0(f.articulos_activos), venta_30d: red(n0(f.venta_30d)),
      margen_30d: margenPct(n0(f.venta_30d), n0(f.costo_30d)),
      ultimo_aumento: fechaSola(f.ultimo_aumento), dias_sin_aumento: num(f.dias_sin_aumento),
      aumento_prom_90d: num(f.aumento_promedio_pct_90d), articulos_aumentados_90d: n0(f.articulos_aumentados_90d),
      deuda: red(n0(f.deuda_pendiente)), deuda_vencida: red(n0(f.deuda_vencida)), deuda_estimada: red(n0(f.deuda_estimada)),
      proximo_vencimiento: fechaSola(f.proximo_vencimiento), oc_abiertas: n0(f.oc_abiertas),
    }))
    const orden = String(p.orden || "venta")
    if (orden === "venta") filas.sort((a, b) => b.venta_30d - a.venta_30d)
    if (orden === "deuda") filas.sort((a, b) => b.deuda - a.deuda)
    if (orden === "aumento") filas.sort((a, b) => (b.aumento_prom_90d ?? -1) - (a.aumento_prom_90d ?? -1))
    if (orden === "sin_aumento") filas = filas.filter((f) => f.venta_30d > 0).sort((a, b) => (b.dias_sin_aumento ?? 9999) - (a.dias_sin_aumento ?? 9999))
    const lim = limite(p.limite)
    const bloque = tabla(
      nombre ? `Proveedor ${nombre}` : "Proveedores",
      [
        { clave: "proveedor", titulo: "Proveedor" }, { clave: "venta_30d", titulo: "Vendemos (30 d)", formato: "pesos" },
        { clave: "ultimo_aumento", titulo: "Último aumento", formato: "fecha" }, { clave: "aumento_prom_90d", titulo: "Aumento prom. 90 d", formato: "porcentaje" },
        { clave: "deuda", titulo: "Le debemos", formato: "pesos" }, { clave: "proximo_vencimiento", titulo: "Próx. vencimiento", formato: "fecha" },
      ],
      filas.slice(0, lim),
      { nota: "Aumentos según el historial de precios del sistema (desde el 18/09/2026). Sin fecha = no se le cargó aumento desde entonces." },
    )
    return {
      consultado: nombre ? `Ventas, historial de precios, vencimientos y órdenes de ${nombre}` : `Ventas, historial de precios, vencimientos y órdenes de ${rows.length} proveedores`,
      datos: { filas: filas.slice(0, lim), cantidad: filas.length },
      bloques: [{ ...bloque, recalcular: { herramienta: "proveedores", parametros: { ...p } } }],
    }
  },
}

// ─── 9. Pagos a proveedores ────────────────────────────────────────────────
const pagosProveedores: Herramienta = {
  nombre: "pagos_proveedores",
  descripcion: "Vencimientos pendientes de pago a proveedores: los atrasados y los que vencen en los próximos N días (por defecto 30).",
  esquema: { type: "object", properties: { dias: { type: "integer" }, proveedor: { type: "string" }, ...P_LIMITE } },
  async ejecutar(ctx, p) {
    const dias = Math.max(1, Math.min(120, Number(p.dias) || 30))
    const hasta = sumarDiasISO(ctx.hoy, dias)
    let nombre = ""
    let provId: string | null = null
    if (str(p.proveedor)) { const pr = await resolverNombre(ctx.db, "proveedores", str(p.proveedor)!, "el proveedor"); provId = pr.id; nombre = pr.nombre }
    const data = await fetchAllRows<any>(() => {
      const q = ctx.db.from("vencimientos").select("id, fecha_vencimiento, monto, concepto, tipo, es_estimado, proveedores(nombre)")
        .eq("estado", "pendiente").lte("fecha_vencimiento", hasta)
      return provId ? q.eq("proveedor_id", provId) : q
    }, "id")
    data.sort((a, b) => String(a.fecha_vencimiento).localeCompare(String(b.fecha_vencimiento)))
    const filas = data.map((v: any) => ({
      fecha: fechaSola(v.fecha_vencimiento), proveedor: v.proveedores?.nombre ?? "—", concepto: v.concepto ?? v.tipo ?? null,
      monto: red(n0(v.monto)), atrasado: String(v.fecha_vencimiento) < ctx.hoy ? "sí" : "", estimado: v.es_estimado ? "sí" : "",
    }))
    const atrasado = red(filas.filter((f) => f.atrasado).reduce((s, f) => s + f.monto, 0))
    const semana = red(filas.filter((f) => !f.atrasado && (f.fecha ?? "") <= sumarDiasISO(ctx.hoy, 7)).reduce((s, f) => s + f.monto, 0))
    const total = red(filas.reduce((s, f) => s + f.monto, 0))
    const lim = limite(p.limite, 30)
    const bloque = tabla(
      `Pagos a proveedores — atrasados y próximos ${dias} días${nombre ? ` (${nombre})` : ""}`,
      [
        { clave: "fecha", titulo: "Vence", formato: "fecha" }, { clave: "proveedor", titulo: "Proveedor" },
        { clave: "concepto", titulo: "Concepto" }, { clave: "monto", titulo: "Monto", formato: "pesos" }, { clave: "atrasado", titulo: "Atrasado" },
      ],
      filas.slice(0, lim),
      { total: { monto: total } },
    )
    return {
      consultado: `Vencimientos a proveedores hasta el ${hasta.slice(8, 10)}/${hasta.slice(5, 7)}${nombre ? ` de ${nombre}` : ""}`,
      datos: { total, atrasado, proximos_7_dias: semana, cantidad: filas.length, filas: filas.slice(0, lim) },
      bloques: [{ ...bloque, recalcular: { herramienta: "pagos_proveedores", parametros: { ...p } } }],
    }
  },
}

// ─── 10. Cheques ───────────────────────────────────────────────────────────
const cheques: Herramienta = {
  nombre: "cheques",
  descripcion: "Cheques de terceros en cartera (sin depositar ni entregar): cuánto hay, de quién y cuándo vencen. Opcional: solo los que vencen en los próximos N días.",
  esquema: { type: "object", properties: { vencen_en_dias: { type: "integer" }, ...P_LIMITE } },
  async ejecutar(ctx, p) {
    const dias = Number(p.vencen_en_dias) || 0
    const data = await fetchAllRows<any>(() => {
      const q = ctx.db.from("cheques").select("id, banco, numero, fecha_vencimiento, monto, es_echeq, cliente_origen_id").eq("estado", "EN_CARTERA")
      return dias > 0 ? q.lte("fecha_vencimiento", sumarDiasISO(ctx.hoy, dias)) : q
    }, "id")
    data.sort((a, b) => String(a.fecha_vencimiento).localeCompare(String(b.fecha_vencimiento)))
    // cheques.cliente_origen_id no tiene FK declarada: los nombres se buscan aparte
    const idsCli = [...new Set((data ?? []).map((c: any) => c.cliente_origen_id).filter(Boolean))]
    const { data: cs } = idsCli.length ? await ctx.db.from("clientes").select("id, nombre").in("id", idsCli) : { data: [] }
    const nombreCli = new Map(((cs ?? []) as { id: string; nombre: string }[]).map((c) => [c.id, c.nombre]))
    const filas = (data ?? []).map((c: any) => ({
      vence: fechaSola(c.fecha_vencimiento), cliente: nombreCli.get(c.cliente_origen_id) ?? "—", banco: c.banco ?? null,
      monto: red(n0(c.monto)), tipo: c.es_echeq ? "eCheq" : "Papel",
    }))
    const total = red(filas.reduce((s, f) => s + f.monto, 0))
    const lim = limite(p.limite, 30)
    const bloque = tabla(
      `Cheques en cartera${dias ? ` que vencen en ${dias} días` : ""}`,
      [{ clave: "vence", titulo: "Vence", formato: "fecha" }, { clave: "cliente", titulo: "De" }, { clave: "banco", titulo: "Banco" }, { clave: "monto", titulo: "Monto", formato: "pesos" }, { clave: "tipo", titulo: "Tipo" }],
      filas.slice(0, lim),
      { total: { monto: total } },
    )
    return {
      consultado: `Cheques en cartera${dias ? ` con vencimiento en ${dias} días` : ""}`,
      datos: { cantidad: filas.length, total, filas: filas.slice(0, lim) },
      bloques: [{ ...bloque, recalcular: { herramienta: "cheques", parametros: { ...p } } }],
    }
  },
}

// ─── 11. Operación: pedidos y viajes ───────────────────────────────────────
const operacion: Herramienta = {
  nombre: "operacion",
  descripcion: "Cómo está la operación hoy: pedidos por estado (pendiente, en revisión, impreso, en preparación, en viaje…), pedidos en revisión (cliente nuevo) y viajes en curso o esperando rendición.",
  esquema: { type: "object", properties: {} },
  async ejecutar(ctx) {
    const estados = ["pendiente", "en_revision", "impreso", "en_preparacion", "en_viaje", "facturado", "entregado"]
    const desde = sumarDiasISO(ctx.hoy, -60)
    const [conteos, revision, viajes] = await Promise.all([
      Promise.all(estados.map(async (e) => {
        const { count } = await ctx.db.from("pedidos").select("id", { count: "exact", head: true }).eq("estado", e).gte("fecha", desde)
        return { estado: e.replace("_", " "), pedidos: count ?? 0 }
      })),
      ctx.db.from("pedidos").select("numero_pedido, fecha, total, clientes(nombre)").eq("estado", "en_revision").order("fecha").limit(20),
      ctx.db.from("viajes").select("nombre, fecha, estado").in("estado", ["en_curso", "en_rendicion", "planificado"]).order("fecha").limit(20),
    ])
    const bloque = tabla("Pedidos por estado (últimos 60 días)", [{ clave: "estado", titulo: "Estado" }, { clave: "pedidos", titulo: "Pedidos", formato: "numero" }], conteos)
    return {
      consultado: "Pedidos de los últimos 60 días por estado, pedidos en revisión y viajes activos",
      datos: {
        por_estado: conteos,
        en_revision: (revision.data ?? []).map((x: any) => ({ numero: x.numero_pedido, fecha: x.fecha, cliente: x.clientes?.nombre, total: red(n0(x.total)) })),
        viajes: (viajes.data ?? []).map((v: any) => ({ nombre: v.nombre, fecha: v.fecha, estado: v.estado })),
      },
      bloques: [{ ...bloque, recalcular: { herramienta: "operacion", parametros: {} } }],
    }
  },
}

// ─── 12. Comisiones de viajantes ───────────────────────────────────────────
const comisiones: Herramienta = {
  nombre: "comisiones",
  descripcion: "Comisiones de los viajantes en un período: devengado, cobrable, pagado y pendiente, con comparación contra el período anterior.",
  esquema: { type: "object", properties: { ...P_PERIODO, vendedor: { type: "string" } } },
  async ejecutar(ctx, p) {
    const r: Rango = resolverPeriodo(p as never, "mes_actual", ctx.hoy)
    let vid: string | null = null
    if (str(p.vendedor)) vid = (await resolverNombre(ctx.db, "vendedores", str(p.vendedor)!, "el vendedor")).id
    const [rows, vs] = await Promise.all([
      rpc(ctx.db, "playroom_comisiones_viajantes", { p_from: r.desde, p_to: r.hasta, p_prev_from: r.prevDesde, p_prev_to: r.prevHasta, p_tipo: "vendida", p_viajante_id: vid }),
      ctx.db.from("vendedores").select("id, nombre"),
    ])
    const nombres = new Map(((vs.data ?? []) as { id: string; nombre: string }[]).map((v) => [v.id, v.nombre]))
    const filas = rows.map((f) => ({
      viajante: nombres.get(String(f.vendedor_id)) ?? "—", devengado: red(n0(f.devengado)), anterior: red(n0(f.devengado_prev)),
      cobrable: red(n0(f.cobrable)), pagado: red(n0(f.pagado)), pendiente: red(n0(f.pendiente)), clientes: n0(f.cantidad_clientes),
    })).sort((a, b) => b.devengado - a.devengado)
    const bloque = tabla(
      `Comisiones — ${r.etiqueta}`,
      [
        { clave: "viajante", titulo: "Viajante" }, { clave: "devengado", titulo: "Devengado", formato: "pesos" },
        { clave: "cobrable", titulo: "Cobrable", formato: "pesos" }, { clave: "pagado", titulo: "Pagado", formato: "pesos" },
        { clave: "pendiente", titulo: "Pendiente", formato: "pesos" },
      ],
      filas,
    )
    return {
      consultado: `Comisiones de viajantes ${r.etiqueta}`,
      datos: { periodo: r, filas },
      bloques: [{ ...bloque, recalcular: { herramienta: "comisiones", parametros: { ...p } } }],
    }
  },
}

// ─── 13-16. Agenda de Jarvis ───────────────────────────────────────────────
const SIN_USUARIO = "Modo prueba: no se agenda nada (no hay una persona detrás de esta pregunta)."

const agendarRecordatorio: Herramienta = {
  nombre: "agendar_recordatorio",
  descripcion:
    "Anota un recordatorio en la agenda para una fecha (ej. 'recordame el 1/11 revisar precios de Lanín'). Usala SOLO cuando el usuario lo pide. Queda con su nombre y la fecha. No cambia ningún dato del negocio.",
  esquema: {
    type: "object",
    properties: {
      titulo: { type: "string", description: "Qué hay que recordar, en una línea" },
      fecha: { type: "string", description: "AAAA-MM-DD (hoy o después)" },
      para: { type: "string", description: "A quién le aparece: vacío = a quien lo pide; \"todos\" = a toda la oficina; o el nombre de otra persona ('recordale a Mario…')" },
      detalle: { type: "string", description: "Contexto útil para ese día (qué se habló, números)" },
      cliente: { type: "string" }, proveedor: { type: "string" },
    },
    required: ["titulo", "fecha"],
  },
  async ejecutar(ctx, p) {
    if (!ctx.usuarioId) return { consultado: "Agenda (modo prueba)", datos: SIN_USUARIO, bloques: [] }
    let entidad: { tipo: string; id: string } | null = null
    if (str(p.cliente)) entidad = { tipo: "cliente", id: (await resolverCliente(ctx.db, str(p.cliente)!)).id }
    else if (str(p.proveedor)) entidad = { tipo: "proveedor", id: (await resolverNombre(ctx.db, "proveedores", str(p.proveedor)!, "el proveedor")).id }
    let paraUsuario: string | null | undefined = undefined
    let paraNombre = "vos"
    const para = str(p.para)?.toLowerCase()
    if (para && ["todos", "todas", "la oficina", "oficina"].includes(para)) { paraUsuario = null; paraNombre = "todos" }
    else if (para && !["yo", "mi", "mí", "vos"].includes(para)) {
      const us = (await usuariosOficina(ctx.db)).filter((u) => u.nombre.toLowerCase().includes(para))
      if (us.length !== 1) throw new ErrorHerramienta(us.length ? `Hay varias personas que coinciden con "${p.para}": ${us.map((u) => u.nombre).join(", ")}.` : `No encontré a "${p.para}" entre los usuarios de la oficina.`)
      paraUsuario = us[0].id; paraNombre = us[0].nombre
    }
    try {
      const id = await crearRecordatorio(ctx.db, { titulo: String(p.titulo ?? ""), detalle: str(p.detalle), fecha: String(p.fecha ?? ""), usuarioId: ctx.usuarioId, conversacionId: ctx.conversacionId, entidad, paraUsuario })
      return { consultado: "Agenda de Jarvis", datos: { agendado: true, id, fecha: p.fecha, para: paraNombre }, bloques: [] }
    } catch (e) {
      if (e instanceof ErrorAgenda) throw new ErrorHerramienta(e.message)
      throw e
    }
  },
}

const proponerDecision: Herramienta = {
  nombre: "proponer_decision",
  descripcion:
    "Deja una PROPUESTA en la agenda para que una persona con permiso apriete Sí / No / Recordámelo. Nada se hace hasta ese Sí. Usala cuando el usuario te pide 'proponelo' o 'dejalo para decidir', o cuando los datos muestran algo claro que alguien tiene que resolver. Explicá en el detalle por qué (con los números). Acciones posibles: " +
    Object.values(ACCIONES).map((a) => `${a.tipo} (${a.descripcion})`).join("; "),
  esquema: {
    type: "object",
    properties: {
      titulo: { type: "string", description: "La propuesta en una línea, como pregunta o acción ('Llamar a X por la deuda de 45 días')" },
      detalle: { type: "string", description: "Por qué, con los números que viste" },
      tipo_accion: { type: "string", enum: Object.keys(ACCIONES) },
      parametros: { type: "object", description: "Datos para la acción (ej. {responsable: 'Mario'})" },
      impacto_estimado: { type: "number", description: "Plata que se estima cobrar, ganar o ahorrar si se hace (en $). Opcional." },
      urgente: { type: "boolean" },
      cliente: { type: "string" }, proveedor: { type: "string" },
    },
    required: ["titulo", "detalle", "tipo_accion"],
  },
  async ejecutar(ctx, p) {
    if (!ctx.usuarioId) return { consultado: "Agenda (modo prueba)", datos: SIN_USUARIO, bloques: [] }
    const tipo = String(p.tipo_accion ?? "ninguna")
    const parametros: Record<string, unknown> = { ...((p.parametros as Record<string, unknown>) ?? {}) }
    // Ningún id viene de la IA: se resuelven acá por nombre (si no, un Sí podría tocar a otro cliente)
    for (const k of Object.keys(parametros)) if (k.endsWith("_id")) delete parametros[k]
    let entidad: { tipo: string; id: string } | null = null
    if (str(p.cliente)) {
      const c = await resolverCliente(ctx.db, str(p.cliente)!)
      entidad = { tipo: "cliente", id: c.id }; parametros.cliente_id = c.id; parametros.cliente = c.nombre
    } else if (str(p.proveedor)) {
      const pr = await resolverNombre(ctx.db, "proveedores", str(p.proveedor)!, "el proveedor")
      entidad = { tipo: "proveedor", id: pr.id }; parametros.proveedor_id = pr.id; parametros.proveedor = pr.nombre
    }
    if (ACCION_PIDE[tipo] && !parametros[`${ACCION_PIDE[tipo]}_id`]) throw new ErrorHerramienta(`Para "${tipo}" decime de qué ${ACCION_PIDE[tipo]} se trata (campo ${ACCION_PIDE[tipo]}).`)
    if (tipo === "retener_entregas" && !parametros.motivo) parametros.motivo = str(p.titulo) ?? "deuda vencida"
    try {
      const id = await crearPropuesta(ctx.db, {
        titulo: String(p.titulo ?? ""), detalle: str(p.detalle), accion: { tipo, parametros },
        clave: ACCION_PIDE[tipo] ? `${tipo}:${parametros[`${ACCION_PIDE[tipo]}_id`]}` : null,
        impactoEstimado: num(p.impacto_estimado), tono: p.urgente ? "alerta" : "atencion",
        usuarioId: ctx.usuarioId, conversacionId: ctx.conversacionId, entidad,
      })
      return { consultado: "Agenda de Jarvis", datos: { propuesta_creada: true, id, nota: "Aparece en Playroom → 'Para decidir'. Nada se hace hasta que alguien apriete Sí." }, bloques: [] }
    } catch (e) {
      if (e instanceof ErrorAgenda) throw new ErrorHerramienta(e.message)
      throw e
    }
  },
}

const verAgenda: Herramienta = {
  nombre: "ver_agenda",
  descripcion: "Lo pendiente de la agenda: propuestas sin decidir y recordatorios (vencidos, de hoy y de la semana), con quién los pidió.",
  esquema: { type: "object", properties: {} },
  async ejecutar(ctx) {
    if (!ctx.usuarioId) return { consultado: "Agenda (modo prueba)", datos: SIN_USUARIO, bloques: [] }
    const items = await agendaPendiente(ctx.db, ctx.usuarioId)
    const filas = items.map((i) => ({ fecha: i.fecha, tipo: i.tipo === "propuesta" ? "Para decidir" : `Recordatorio${i.para_nombre ? ` (para ${i.para_nombre})` : " (para todos)"}`, que: i.titulo, pidio: i.creado_por_nombre }))
    return {
      consultado: "Agenda de Jarvis",
      datos: items.map((i) => ({ tipo: i.tipo, titulo: i.titulo, fecha: i.fecha, vencido: i.vencido, pidio: i.creado_por_nombre, detalle: i.detalle })),
      bloques: [{ ...tabla("Agenda pendiente", [{ clave: "fecha", titulo: "Fecha", formato: "fecha" }, { clave: "tipo", titulo: "Tipo" }, { clave: "que", titulo: "Qué" }, { clave: "pidio", titulo: "Lo pidió" }], filas), recalcular: { herramienta: "ver_agenda", parametros: {} } }],
    }
  },
}

const historialDecisionesH: Herramienta = {
  nombre: "historial_decisiones",
  descripcion: "Quién decidió qué y cuándo (bitácora que no se puede borrar): decisiones de la agenda, avisos descartados, cambios de reglas. Filtros: texto libre, cliente, desde (AAAA-MM-DD).",
  esquema: { type: "object", properties: { texto: { type: "string" }, cliente: { type: "string" }, desde: { type: "string" }, ...P_LIMITE } },
  async ejecutar(ctx, p) {
    let entidadId: string | null = null
    if (str(p.cliente)) entidadId = (await resolverCliente(ctx.db, str(p.cliente)!)).id
    const filas = await historialDecisiones(ctx.db, { texto: str(p.texto), entidadId, desde: str(p.desde), limite: limite(p.limite, 30, 100) })
    const vista = filas.map((f) => ({ cuando: f.cuando.slice(0, 10), quien: f.quien, que: f.que, sobre: String(f.sobre).slice(0, 120), nota: f.nota }))
    return {
      consultado: "Bitácora de decisiones de Jarvis",
      datos: filas.map((f) => ({ cuando: f.cuando, quien: f.quien, que: f.que, sobre: f.sobre, nota: f.nota })),
      bloques: [{ ...tabla("Historial de decisiones", [{ clave: "cuando", titulo: "Cuándo", formato: "fecha" }, { clave: "quien", titulo: "Quién" }, { clave: "que", titulo: "Qué hizo" }, { clave: "sobre", titulo: "Sobre" }, { clave: "nota", titulo: "Nota" }], vista), recalcular: { herramienta: "historial_decisiones", parametros: { ...p } } }],
    }
  },
}

const clientesRetenidos: Herramienta = {
  nombre: "clientes_retenidos",
  descripcion: "Clientes con las entregas retenidas (el chofer no baja mercadería sin cobrar): desde cuándo, por qué, quién lo decidió y cuánto deben hoy.",
  esquema: { type: "object", properties: {} },
  async ejecutar(ctx) {
    const { data, error } = await ctx.db.from("clientes").select("id, nombre, retener_motivo, retener_desde, retener_por").eq("retener_entregas", true)
    if (error) throw new Error(error.message)
    const cs = (data ?? []) as { id: string; nombre: string; retener_motivo: string | null; retener_desde: string | null; retener_por: string | null }[]
    const deuda = (await Promise.all(cs.map((c) => rpc(ctx.db, "jarvis_deuda_antiguedad", { p_zona_id: null, p_vendedor_id: null, p_cliente_id: c.id })))).flat()
    const saldo = new Map(deuda.map((d) => [String(d.cliente_id), d]))
    const ids = cs.map((c) => c.retener_por).filter((x): x is string => !!x)
    const { data: us } = ids.length ? await ctx.db.from("usuarios").select("id, nombre").in("id", ids) : { data: [] }
    const nom = new Map(((us ?? []) as { id: string; nombre: string }[]).map((u) => [u.id, u.nombre]))
    const filas = cs.map((c) => {
      const d = saldo.get(c.id)
      return { cliente_id: c.id, cliente: c.nombre, desde: fechaSola(c.retener_desde), motivo: c.retener_motivo, decidio: c.retener_por ? nom.get(c.retener_por) ?? "—" : "—", debe: red(n0(d?.saldo)), vencido_30: red(n0(d?.d30_59) + n0(d?.d60_89) + n0(d?.d90_mas)) }
    })
    return {
      consultado: "Clientes con entregas retenidas y su deuda",
      datos: filas,
      bloques: [{ ...tabla("Clientes con entregas retenidas", [{ clave: "cliente", titulo: "Cliente" }, { clave: "desde", titulo: "Desde", formato: "fecha" }, { clave: "decidio", titulo: "Lo decidió" }, { clave: "debe", titulo: "Debe hoy", formato: "pesos" }, { clave: "vencido_30", titulo: "Vencido +30 d", formato: "pesos" }], filas), recalcular: { herramienta: "clientes_retenidos", parametros: {} } }],
    }
  },
}

// ─── 18-20. Mundo exterior ─────────────────────────────────────────────────
const indicadoresExternos: Herramienta = {
  nombre: "indicadores_externos",
  descripcion: "Precios de afuera que guarda el sistema: dólar oficial y blue, inflación mensual, petróleo Brent, resinas plásticas, celulosa, aluminio, acero, algodón. Último valor, fecha, variación en 30 días y fuente. Usala antes de buscar en internet; si un valor está viejo o falta, buscalo con la búsqueda web.",
  esquema: { type: "object", properties: {} },
  async ejecutar(ctx) {
    const xs = await estadoIndicadores(ctx.db)
    const filas = xs.map((x) => ({ indicador: x.nombre, valor: x.valor, unidad: x.unidad, fecha: x.fecha, variacion: x.variacion_30d, fuente: x.fuente }))
    return {
      consultado: "Precios de afuera guardados (dólar, inflación, materias primas)",
      datos: xs,
      bloques: [{ ...tabla("Precios de afuera", [{ clave: "indicador", titulo: "Indicador" }, { clave: "valor", titulo: "Valor", formato: "numero" }, { clave: "unidad", titulo: "Unidad" }, { clave: "fecha", titulo: "Fecha", formato: "fecha" }, { clave: "variacion", titulo: "30 días", formato: "porcentaje" }, { clave: "fuente", titulo: "Fuente" }], filas), recalcular: { herramienta: "indicadores_externos", parametros: {} } }],
    }
  },
}

const insumosProveedor: Herramienta = {
  nombre: "insumos_proveedor",
  descripcion: "De qué materias primas depende lo que le vendemos de un proveedor (ej. '80 % plástico'), según la clasificación de sus artículos y la venta de 90 días. Sin proveedor: todos.",
  esquema: { type: "object", properties: { proveedor: { type: "string" }, ...P_LIMITE } },
  async ejecutar(ctx, p) {
    let pid: string | null = null
    let nombre = ""
    if (str(p.proveedor)) { const pr = await resolverNombre(ctx.db, "proveedores", str(p.proveedor)!, "el proveedor"); pid = pr.id; nombre = pr.nombre }
    const rows = await rpc(ctx.db, "jarvis_proveedor_insumos", { p_proveedor_id: pid })
    const filas = rows.map((f) => ({ proveedor: String(f.proveedor), insumo: String(f.insumo).replace("_", " "), participacion: num(f.participacion_pct), articulos: n0(f.articulos), venta_90d: red(n0(f.venta_90d)) }))
    const lim = limite(p.limite, pid ? 20 : 40)
    return {
      consultado: nombre ? `Artículos de ${nombre} y de qué dependen sus costos` : "Proveedores y de qué dependen sus costos",
      datos: filas.slice(0, 120),
      bloques: [{ ...tabla(nombre ? `${nombre}: de qué depende el costo` : "Proveedores por materia prima", [{ clave: "proveedor", titulo: "Proveedor" }, { clave: "insumo", titulo: "Materia prima" }, { clave: "participacion", titulo: "% de lo que le vendemos", formato: "porcentaje" }, { clave: "articulos", titulo: "Artículos", formato: "numero" }], filas.slice(0, lim), { nota: "Según la clasificación de cada artículo (la hace Jarvis y la corrige una persona)." }), recalcular: { herramienta: "insumos_proveedor", parametros: { ...p } } }],
    }
  },
}

const clasificacionArticulos: Herramienta = {
  nombre: "clasificacion_articulos",
  descripcion: "Cómo va la clasificación de artículos por materia prima: cuántos están clasificados, cuántos con duda, cuántos sin clasificar y cuántos revisó una persona.",
  esquema: { type: "object", properties: {} },
  async ejecutar(ctx) {
    const c = await cobertura(ctx.db)
    return {
      consultado: "Clasificación de artículos por materia prima",
      datos: c,
      bloques: [{ ...tabla("Artículos por materia prima", [{ clave: "insumo", titulo: "Materia prima" }, { clave: "articulos", titulo: "Artículos", formato: "numero" }], Object.entries(c.por_insumo).sort((a, b) => b[1] - a[1]).map(([insumo, articulos]) => ({ insumo, articulos })), { nota: `${c.clasificados} de ${c.activos} clasificados · ${c.dudas} con duda · ${c.por_persona} revisados por una persona` }), recalcular: { herramienta: "clasificacion_articulos", parametros: {} } }],
    }
  },
}

// ─── 21-22. Calendario de viajes ───────────────────────────────────────────
const calendarioViajes: Herramienta = {
  nombre: "calendario_viajes",
  descripcion:
    "Calendario de viajes de un mes (AAAA-MM; por defecto el que viene): qué zonas tienen viaje, cuáles faltan según su frecuencia (todos los días hábiles / cada N días / cuando haga falta), días hábiles que le faltan a BAHIA, feriados (y si se decidió trabajar) y quién está de vacaciones. Se trabaja de lunes a viernes. Para armarlo se usa la pantalla /viajes/planificar.",
  esquema: { type: "object", properties: { mes: { type: "string", description: "AAAA-MM" } } },
  async ejecutar(ctx, p) {
    const mes = /^\d{4}-\d{2}$/.test(String(p.mes ?? "")) ? String(p.mes) : mesSiguiente(ctx.hoy.slice(0, 7))
    const e = await estadoPlanMes(ctx.db, mes, { desdeDia: mes === ctx.hoy.slice(0, 7) ? ctx.hoy : undefined })
    const frec = (f: number | null) => (f === null ? "cuando haga falta" : f === 1 ? "todos los días hábiles" : `cada ${f} días`)
    const filas = e.zonas.filter((z) => z.frecuencia_dias !== null).map((z) => ({
      zona: z.nombre, frecuencia: frec(z.frecuencia_dias),
      viajes: z.viajes.map((v) => v.fecha.slice(8, 10) + "/" + v.fecha.slice(5, 7)).join(", ") || null,
      estado: !z.toca_este_mes ? `no le toca (desde ${z.le_toca_desde ? fecha(z.le_toca_desde) : "—"})` : e.faltantes.some((f) => f.id === z.id) ? (z.dias_faltantes ? `faltan ${z.dias_faltantes.length} días` : "FALTA") : "ok",
    }))
    return {
      consultado: `Calendario de viajes de ${mes}, feriados y ausencias`,
      datos: {
        mes, zonas_que_tocan: e.zonas.filter((z) => z.toca_este_mes).length, faltan: e.faltantes.map((f) => ({ zona: f.nombre, dias_faltantes: f.dias_faltantes })),
        feriados: e.especiales.map((d) => ({ fecha: d.fecha, nombre: d.nombre, trabajamos: d.trabajamos, decidio: d.decidido_por_nombre ?? null, sigue_en_fuente_oficial: d.en_fuente })),
        feriados_sin_decidir: e.sin_decidir, dias_habiles: e.habiles.length,
        ausencias: e.ausencias.map((a) => ({ quien: a.nombre, roles: a.roles, tipo: a.tipo, desde: a.desde, hasta: a.hasta })),
        link: `/viajes/planificar?mes=${mes}`,
      },
      bloques: [{ ...tabla(`Calendario de viajes ${mes}`, [{ clave: "zona", titulo: "Zona" }, { clave: "frecuencia", titulo: "Frecuencia" }, { clave: "viajes", titulo: "Viajes" }, { clave: "estado", titulo: "Estado" }], filas), recalcular: { herramienta: "calendario_viajes", parametros: { ...p } } }],
    }
  },
}

const ausenciasPersonal: Herramienta = {
  nombre: "ausencias_personal",
  descripcion: "Quién está de vacaciones o con licencia entre dos fechas (por defecto, los próximos 30 días), con su rol (chofer, depósito, vendedor, oficina).",
  esquema: { type: "object", properties: { desde: { type: "string" }, hasta: { type: "string" } } },
  async ejecutar(ctx, p) {
    const desde = /^\d{4}-\d{2}-\d{2}$/.test(String(p.desde ?? "")) ? String(p.desde) : ctx.hoy
    const hasta = /^\d{4}-\d{2}-\d{2}$/.test(String(p.hasta ?? "")) ? String(p.hasta) : sumarDiasISO(desde, 30)
    const xs = await ausenciasEntre(ctx.db, desde, hasta)
    const filas = xs.map((a) => ({ persona: a.nombre, rol: a.roles.join(", "), tipo: a.tipo, desde: a.desde, hasta: a.hasta }))
    return {
      consultado: `Vacaciones y licencias del ${fecha(desde)} al ${fecha(hasta)}`,
      datos: filas,
      bloques: [{ ...tabla("Vacaciones y licencias", [{ clave: "persona", titulo: "Persona" }, { clave: "rol", titulo: "Rol" }, { clave: "tipo", titulo: "Tipo" }, { clave: "desde", titulo: "Desde", formato: "fecha" }, { clave: "hasta", titulo: "Hasta", formato: "fecha" }], filas), recalcular: { herramienta: "ausencias_personal", parametros: { ...p } } }],
    }
  },
}

// ─── Registro ──────────────────────────────────────────────────────────────
export const HERRAMIENTAS: Herramienta[] = [
  indicadoresTablero, ventas, deudaClientes, clientesHabitos, fichaCliente, articulosVendidos,
  coberturaStock, proveedores, pagosProveedores, cheques, operacion, comisiones,
  agendarRecordatorio, proponerDecision, verAgenda, historialDecisionesH, clientesRetenidos,
  indicadoresExternos, insumosProveedor, clasificacionArticulos, calendarioViajes, ausenciasPersonal,
]

/** Las que escriben en la agenda: /recalcular NUNCA las corre. */
export const HERRAMIENTAS_QUE_ESCRIBEN = new Set(["agendar_recordatorio", "proponer_decision"])

const POR_NOMBRE = new Map(HERRAMIENTAS.map((h) => [h.nombre, h]))

export function buscarHerramienta(nombre: string): Herramienta | undefined {
  return POR_NOMBRE.get(nombre)
}

export function contextoNuevo(db: SupabaseClient, usuarioId: string | null = null): Contexto {
  return { db, hoy: hoyISO(), usuarioId }
}
