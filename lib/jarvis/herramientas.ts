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
import { fecha, fechaHora, finDiaAR, hoyISO, inicioDiaAR, sumarDiasISO } from "@/lib/formato"
import { esAdmin as esAdminFinanzas, esTipoReservado, TIPOS_SOLO_ADMIN } from "@/lib/finanzas/tipos-reservados"
import { PERIODOS, resolverPeriodo, type Rango } from "./periodos"
import { ACCIONES, ACCION_PIDE } from "./acciones"
import { agendaPendiente, crearPropuesta, crearRecordatorio, ErrorAgenda, historialDecisiones, nombresDeUsuarios, usuariosOficina } from "./agenda"
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
    "VENTAS = lo que pidió el cliente (pedidos tomados, no eliminados), NO la facturación (para eso está 'facturacion'). De un período, agrupadas como se pida, con margen y comparación contra el período anterior del mismo largo. 'total' = con IVA; 'neto' = sin IVA. Filtros opcionales por zona, vendedor (viajante), cliente, proveedor o categoría (por nombre).",
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
    "Artículos VENDIDOS (pedidos, no facturación) en un período (venta sin IVA, unidades, margen, variación contra el período anterior). Orden: venta, unidades, crecimiento, caida o margen. Filtros por cliente, vendedor, proveedor o categoría.",
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
    const admin = await veReservados(ctx)
    const data = await fetchAllRows<any>(() => {
      let q = ctx.db.from("vencimientos").select("id, fecha_vencimiento, monto, concepto, tipo, es_estimado, proveedores(nombre)")
        .eq("estado", "pendiente").lte("fecha_vencimiento", hasta)
      if (!admin) q = q.not("tipo", "in", filtroReservados)
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
// ═══════════════════════════════════════════════════════════════════════════
// QUIÉN HIZO QUÉ y FACTURACIÓN (05/11/2026, pedido de Juan)
//   "Cada movimiento tiene un responsable": quién cargó / preparó / pickeó /
//   facturó / cobró un pedido, quién cambió un artículo, quién cobró, quién
//   pagó a un proveedor. Y: VENTA (lo que pidió el cliente) ≠ FACTURACIÓN (los
//   comprobantes que le llegaron).
// ═══════════════════════════════════════════════════════════════════════════

/** Si una tabla/columna todavía no existe (migración sin aplicar), no es un error de la herramienta. */
const faltaEnLaBase = (e: unknown) => {
  const c = (e as { code?: string })?.code
  return c === "PGRST205" || c === "42P01" || c === "42703" || c === "PGRST204"
}
const cuando = (v: unknown) => (v ? fechaHora(v as string) : null)
/** "1827.102269" → "1827.1" (los datos crudos de la base traen muchos decimales). */
const valorLindo = (v: unknown) => (v == null ? null : /^-?\d+\.\d+$/.test(String(v)) ? String(red(Number(v), 2)) : String(v))

async function resolverArticulo(db: SupabaseClient, texto: string) {
  const t = texto.trim()
  const sel = "id, sku, descripcion, proveedor_nombre"
  const { data: porCodigo } = await db.from("articulos").select(sel).eq("sku", t).limit(2)
  if (porCodigo?.length === 1) return porCodigo[0] as { id: string; sku: string; descripcion: string; proveedor_nombre: string | null }
  if (/^\d{8,14}$/.test(t)) {
    const { data: porEan } = await db.from("articulos").select(sel).contains("ean13", [t]).limit(2)
    if (porEan?.length === 1) return porEan[0] as { id: string; sku: string; descripcion: string; proveedor_nombre: string | null }
  }
  const limpio = t.replace(/[%_,()]/g, " ").trim()
  const { data, error } = await db.from("articulos").select(sel).ilike("descripcion", `%${limpio}%`).limit(8)
  if (error) throw new Error(error.message)
  const filas = (data ?? []) as { id: string; sku: string; descripcion: string; proveedor_nombre: string | null }[]
  if (!filas.length) throw new ErrorHerramienta(`No encontré ningún artículo "${texto}" (ni por código ni por descripción).`)
  const exacto = filas.find((f) => f.descripcion?.toLowerCase() === limpio.toLowerCase())
  if (exacto) return exacto
  if (filas.length > 1) throw new ErrorHerramienta(`Hay varios artículos que coinciden con "${texto}": ${filas.map((f) => `${f.sku} ${f.descripcion}`).join("; ")}. Preguntá cuál (mejor por código).`)
  return filas[0]
}

// ─── 23. Facturación ───────────────────────────────────────────────────────
/** Suman: lo que se le cobra al cliente. Restan: lo que se le devuelve o anula. */
const TIPOS_SUMAN = ["FA", "FB", "FC", "PRES", "NDA", "NDB", "NDC"]
const TIPOS_RESTAN = ["NCA", "NCB", "NCC", "REV"]
const NOMBRE_TIPO: Record<string, string> = {
  FA: "Factura A", FB: "Factura B", FC: "Factura C", PRES: "Presupuesto",
  NDA: "Nota de débito A", NDB: "Nota de débito B", NDC: "Nota de débito C",
  NCA: "Nota de crédito A", NCB: "Nota de crédito B", NCC: "Nota de crédito C", REV: "Reversa",
}
/** Renglón que es solo plata (bonificación de contado, ajuste): no son unidades. */
const esRenglonDePlata = (lineaDesc: unknown, artDesc: unknown) =>
  /^BONIF\.\s/i.test(String(lineaDesc ?? "")) || /^BONIFICACI[OÓ]N\b/i.test(String(artDesc ?? ""))

const AGRUPAR_FACT = ["total", "articulo", "proveedor", "cliente", "tipo", "mes"] as const

const facturacion: Herramienta = {
  nombre: "facturacion",
  descripcion:
    "FACTURACIÓN: los comprobantes que le llegaron al cliente (facturas, presupuestos, notas de débito SUMAN; notas de crédito y reversas RESTAN), con UNIDADES y montos sin IVA, por artículo/código, proveedor, cliente, tipo de comprobante o mes. Usala cuando pregunten 'cuánto facturamos', 'facturación de tal proveedor', 'cuántas unidades se facturaron del código X'. NO es lo mismo que 'ventas' (pedidos que tomó el viajante).",
  esquema: {
    type: "object",
    properties: {
      ...P_PERIODO,
      agrupar_por: { type: "string", enum: [...AGRUPAR_FACT] },
      articulo: { type: "string", description: "Código (sku), EAN o descripción" },
      proveedor: { type: "string" }, cliente: { type: "string" },
      ...P_LIMITE,
    },
  },
  async ejecutar(ctx, p) {
    const r = resolverPeriodo(p as never, "mes_actual", ctx.hoy)
    const agrupar = (AGRUPAR_FACT as readonly string[]).includes(String(p.agrupar_por)) ? String(p.agrupar_por) : "total"
    const filtros: string[] = []
    let artId: string | null = null, provId: string | null = null, cliId: string | null = null
    if (str(p.articulo)) { const a = await resolverArticulo(ctx.db, str(p.articulo)!); artId = a.id; filtros.push(`artículo ${a.sku} ${a.descripcion}`) }
    if (str(p.proveedor)) { const pr = await resolverNombre(ctx.db, "proveedores", str(p.proveedor)!, "el proveedor"); provId = pr.id; filtros.push(`proveedor ${pr.nombre}`) }
    if (str(p.cliente)) { const c = await resolverCliente(ctx.db, str(p.cliente)!); cliId = c.id; filtros.push(`cliente ${c.nombre}`) }

    const lineas = await fetchAllRows<any>(() => {
      let q = ctx.db.from("comprobantes_venta_detalle")
        .select("id, cantidad, precio_total, descripcion, articulo_id, comprobantes_venta!inner(tipo_comprobante, fecha, cliente_id, clientes(nombre)), articulos!inner(sku, descripcion, proveedor_id, proveedor_nombre)")
        .gte("comprobantes_venta.fecha", r.desde).lte("comprobantes_venta.fecha", r.hasta)
      if (artId) q = q.eq("articulo_id", artId)
      if (provId) q = q.eq("articulos.proveedor_id", provId)
      if (cliId) q = q.eq("comprobantes_venta.cliente_id", cliId)
      return q
    }, "id")

    type Acum = { nombre: string; unidades_debitos: number; unidades_creditos: number; sin_cargo: number; importe: number; comprobantes: Set<string> }
    const grupos = new Map<string, Acum>()
    const porTipo = new Map<string, { unidades: number; importe: number }>()
    let otrosTipos = 0
    for (const l of lineas) {
      const c = l.comprobantes_venta ?? {}
      const tipo = String(c.tipo_comprobante ?? "")
      const signo = TIPOS_SUMAN.includes(tipo) ? 1 : TIPOS_RESTAN.includes(tipo) ? -1 : 0
      if (!signo) { otrosTipos++; continue }
      const plata = esRenglonDePlata(l.descripcion, l.articulos?.descripcion)
      const uds = plata ? 0 : Math.abs(n0(l.cantidad))
      const imp = Math.abs(n0(l.precio_total)) * signo
      const clave =
        agrupar === "articulo" ? `${l.articulos?.sku ?? ""} ${l.articulos?.descripcion ?? ""}`.trim()
        : agrupar === "proveedor" ? l.articulos?.proveedor_nombre ?? "(sin proveedor)"
        : agrupar === "cliente" ? c.clientes?.nombre ?? "(sin nombre)"
        : agrupar === "tipo" ? NOMBRE_TIPO[tipo] ?? tipo
        : agrupar === "mes" ? String(c.fecha ?? "").slice(0, 7)
        : "Total"
      const g = grupos.get(clave) ?? { nombre: clave, unidades_debitos: 0, unidades_creditos: 0, sin_cargo: 0, importe: 0, comprobantes: new Set<string>() }
      if (signo > 0) g.unidades_debitos += uds; else g.unidades_creditos += uds
      if (signo > 0 && !plata && n0(l.precio_total) === 0) g.sin_cargo += uds
      g.importe += imp
      grupos.set(clave, g)
      const t = porTipo.get(NOMBRE_TIPO[tipo] ?? tipo) ?? { unidades: 0, importe: 0 }
      t.unidades += uds * signo
      t.importe += imp
      porTipo.set(NOMBRE_TIPO[tipo] ?? tipo, t)
    }
    const filas = [...grupos.values()].map((g) => ({
      nombre: g.nombre,
      unidades_facturadas: red(g.unidades_debitos - g.unidades_creditos, 2),
      unidades_en_debitos: red(g.unidades_debitos, 2), unidades_en_creditos: red(g.unidades_creditos, 2),
      unidades_sin_cargo: red(g.sin_cargo, 2), importe_sin_iva: red(g.importe),
    }))
    filas.sort(agrupar === "mes" ? (a, b) => a.nombre.localeCompare(b.nombre) : (a, b) => b.importe_sin_iva - a.importe_sin_iva)
    const tot = filas.reduce((s, f) => ({ u: s.u + f.unidades_facturadas, d: s.d + f.unidades_en_debitos, c: s.c + f.unidades_en_creditos, i: s.i + f.importe_sin_iva }), { u: 0, d: 0, c: 0, i: 0 })
    const lim = limite(p.limite, agrupar === "mes" ? 24 : 15)
    const filtroTxt = filtros.length ? ` (${filtros.join(", ")})` : ""
    const nota = "Facturas, presupuestos y notas de débito suman; notas de crédito y reversas restan. Montos sin IVA. Las bonificaciones de contado cuentan en plata, no en unidades. No incluye los saldos migrados del sistema anterior (no tienen renglones)."
    const recalcular = { herramienta: "facturacion", parametros: { ...p } }
    const bloque = agrupar === "total"
      ? ({ tipo: "numero", titulo: `Facturado ${r.etiqueta}${filtroTxt}`, valor: red(tot.i), formato: "pesos", nota: artId ? `${red(tot.u, 2)} unidades facturadas` : undefined, recalcular } as Bloque)
      : { ...tabla(
          `Facturación por ${agrupar === "tipo" ? "tipo de comprobante" : agrupar} — ${r.etiqueta}${filtroTxt}`,
          [
            { clave: "nombre", titulo: agrupar === "articulo" ? "Artículo" : agrupar === "proveedor" ? "Proveedor" : agrupar === "cliente" ? "Cliente" : agrupar === "tipo" ? "Comprobante" : "Mes" },
            { clave: "unidades_facturadas", titulo: "Unidades", formato: "numero" },
            { clave: "importe_sin_iva", titulo: "Importe sin IVA", formato: "pesos" },
          ],
          filas.slice(0, lim),
          { total: { unidades_facturadas: red(tot.u, 2), importe_sin_iva: red(tot.i) }, nota },
        ), recalcular }
    return {
      consultado: `Comprobantes emitidos ${r.etiqueta}${filtroTxt} (renglón por renglón)`,
      datos: {
        periodo: r, regla: nota,
        total: { unidades_facturadas: red(tot.u, 2), unidades_en_debitos: red(tot.d, 2), unidades_en_creditos: red(tot.c, 2), importe_sin_iva: red(tot.i) },
        por_tipo_de_comprobante: [...porTipo.entries()].map(([tipo, v]) => ({ tipo, unidades: red(v.unidades, 2), importe_sin_iva: red(v.importe) })),
        filas: agrupar === "total" ? undefined : filas.slice(0, lim),
        resto: filas.length > lim && agrupar !== "total" ? filas.length - lim : 0,
        renglones_de_otros_tipos_ignorados: otrosTipos,
        sin_datos: lineas.length === 0 ? "No hay comprobantes con renglones en ese período / filtro." : undefined,
      },
      bloques: [bloque],
    }
  },
}

// ─── 24. Historia de un pedido: quién hizo cada cosa ───────────────────────
const historiaPedido: Herramienta = {
  nombre: "historia_pedido",
  descripcion:
    "Todo lo que pasó con UN pedido y QUIÉN lo hizo: quién lo cargó y cuándo, cada cambio de estado (quién/cuándo), quién lo preparó en depósito y quién pickeó cada artículo (cantidad pedida vs. preparada), quién lo facturó (comprobantes), en qué viaje salió y con qué chofer, y los cobros asociados. Usala para '¿quién preparó / cargó / facturó el pedido 2015?' o '¿quién pickeó el artículo X del pedido Y?'.",
  esquema: {
    type: "object",
    properties: {
      pedido: { type: "string", description: "Número de pedido (ej. 2015 o 002015)" },
      articulo: { type: "string", description: "Opcional: solo el renglón de este artículo (código o descripción)" },
    },
    required: ["pedido"],
  },
  async ejecutar(ctx, p) {
    const crudo = String(p.pedido ?? "").replace(/\D/g, "")
    if (!crudo) throw new ErrorHerramienta("Decime el número de pedido.")
    const { data: ped, error } = await ctx.db.from("pedidos")
      .select("id, numero_pedido, fecha, estado, total, created_at, creado_por, actualizado_por, viaje_id, clientes(nombre), vendedores(nombre), viajes(nombre, fecha, estado, chofer_id, chofer)")
      .in("numero_pedido", [...new Set([crudo, crudo.padStart(6, "0")])]).limit(1).maybeSingle()
    if (error) throw new Error(error.message)
    if (!ped) throw new ErrorHerramienta(`No encontré el pedido ${crudo}.`)
    const pd = ped as any

    let artFiltro: { id: string; sku: string; descripcion: string } | null = null
    if (str(p.articulo)) artFiltro = await resolverArticulo(ctx.db, str(p.articulo)!)

    const [estadosR, sesionesR, comprobantesR, cobrosR, kardexR] = await Promise.all([
      ctx.db.from("pedidos_estados_historial").select("estado_anterior, estado_nuevo, usuario_id, via, cambiado_at").eq("pedido_id", pd.id).order("cambiado_at"),
      ctx.db.from("picking_sesiones").select("id, usuario_id, usuario_email, estado, inicio_at, fin_at, created_at").eq("pedido_id", pd.id).order("created_at"),
      ctx.db.from("comprobantes_venta").select("tipo_comprobante, numero_comprobante, fecha, total_factura, creado_por, created_at").eq("pedido_id", pd.id).order("created_at"),
      ctx.db.from("pagos_clientes").select("fecha_pago, monto, estado, cobrador_tipo, creado_por, confirmado_por, fecha_confirmacion, vendedores(nombre), pagos_detalle(tipo_pago, monto)").eq("pedido_id", pd.id).order("created_at"),
      ctx.db.from("kardex").select("preparadores_ids, facturador_id, entregador_id").eq("pedido_id", pd.id).limit(300),
    ])
    const sesiones = (sesionesR.data ?? []) as any[]
    let items: any[] = []
    if (sesiones.length) {
      let q = ctx.db.from("picking_items")
        .select("sesion_id, cantidad_pedida, cantidad_preparada, estado, usuario_id, usuario_nombre, fecha_escaneo, observaciones, articulos(sku, descripcion)")
        .in("sesion_id", sesiones.map((s) => s.id))
      if (artFiltro) q = q.eq("articulo_id", artFiltro.id)
      const { data } = await q.order("fecha_escaneo", { ascending: true, nullsFirst: false })
      items = (data ?? []) as any[]
    }
    const kx = (kardexR.data ?? []) as any[]
    const prepKardex = [...new Set(kx.flatMap((k) => (Array.isArray(k.preparadores_ids) ? k.preparadores_ids : [])))]
    const ids = [
      pd.creado_por, pd.actualizado_por, pd.viajes?.chofer_id,
      ...((estadosR.data ?? []) as any[]).map((e) => e.usuario_id),
      ...sesiones.map((s) => s.usuario_id), ...items.map((i) => i.usuario_id),
      ...((comprobantesR.data ?? []) as any[]).map((c) => c.creado_por),
      ...((cobrosR.data ?? []) as any[]).flatMap((c) => [c.creado_por, c.confirmado_por]),
      ...prepKardex, ...kx.map((k) => k.facturador_id), ...kx.map((k) => k.entregador_id),
    ]
    const nom = await nombresDeUsuarios(ctx.db, ids as string[])
    const quien = (id: unknown, porDefecto = "no quedó registrado") => (id ? nom.get(String(id)) ?? "usuario desconocido" : porDefecto)

    const estados = ((estadosR.data ?? []) as any[]).map((e) => ({
      cuando: cuando(e.cambiado_at), de: e.estado_anterior ?? "(alta)", a: e.estado_nuevo,
      quien: e.usuario_id ? quien(e.usuario_id) : e.via === "service_role" ? "el sistema (no anotó persona)" : "no quedó registrado",
    }))
    const preparacion = sesiones.map((s) => ({
      preparo: s.usuario_id ? quien(s.usuario_id) : s.usuario_email ?? "no quedó registrado",
      estado: s.estado, desde: cuando(s.inicio_at ?? s.created_at), hasta: cuando(s.fin_at),
    }))
    const renglones = items.map((i) => ({
      articulo: `${i.articulos?.sku ?? ""} ${i.articulos?.descripcion ?? ""}`.trim(),
      pedida: num(i.cantidad_pedida), preparada: num(i.cantidad_preparada), estado: i.estado,
      pickeo: i.usuario_id ? quien(i.usuario_id) : i.usuario_nombre ?? "no quedó registrado", cuando: cuando(i.fecha_escaneo), nota: i.observaciones ?? null,
    }))
    const comprobantes = ((comprobantesR.data ?? []) as any[]).map((c) => ({
      comprobante: `${NOMBRE_TIPO[c.tipo_comprobante] ?? c.tipo_comprobante} ${c.numero_comprobante ?? ""}`.trim(),
      fecha: fechaSola(c.fecha), total: red(n0(c.total_factura)), facturo: quien(c.creado_por, "el sistema (comprobante automático, no anotó persona)"), cuando: cuando(c.created_at),
    }))
    const cobros = ((cobrosR.data ?? []) as any[]).map((c) => ({
      fecha: fechaSola(c.fecha_pago), monto: red(n0(c.monto)), estado: c.estado,
      forma: [...new Set(((c.pagos_detalle ?? []) as any[]).map((d) => d.tipo_pago))].join(" + ") || null,
      cobro: c.cobrador_tipo === "viajante" ? `${c.vendedores?.nombre ?? "el viajante"} (viajante)` : `${quien(c.creado_por)}${c.cobrador_tipo ? ` (${c.cobrador_tipo})` : ""}`,
      confirmo: c.confirmado_por ? quien(c.confirmado_por) : null, confirmado: cuando(c.fecha_confirmacion),
    }))
    const sinPrep = !sesiones.length
      ? prepKardex.length
        ? `No hay sesión de la app de depósito; según el kardex lo prepararon: ${prepKardex.map((x) => quien(x)).join(", ")}.`
        : "No quedó registrado quién lo preparó: no se preparó con la app de depósito (la app anota quién prepara y quién pickea cada artículo)."
      : null
    const v = pd.viajes
    const titulo = `Pedido ${pd.numero_pedido} — ${pd.clientes?.nombre ?? ""}`
    const bloques: Bloque[] = [
      tabla(`${titulo}: quién hizo qué`, [{ clave: "cuando", titulo: "Cuándo" }, { clave: "que", titulo: "Qué" }, { clave: "quien", titulo: "Quién" }], [
        { cuando: cuando(pd.created_at), que: "Lo cargó", quien: quien(pd.creado_por) },
        ...estados.filter((e) => e.de !== "(alta)").map((e) => ({ cuando: e.cuando, que: `${e.de} → ${e.a}`, quien: e.quien })),
        ...preparacion.map((s) => ({ cuando: s.desde, que: `Preparación (${s.estado})`, quien: s.preparo })),
        ...comprobantes.map((c) => ({ cuando: c.cuando, que: `Emitió ${c.comprobante}`, quien: c.facturo })),
        ...cobros.map((c) => ({ cuando: c.fecha ? fecha(c.fecha) : null, que: `Cobro ${c.forma ?? ""}`.trim(), quien: c.cobro })),
      ], { nota: sinPrep ?? undefined }),
    ]
    if (renglones.length) {
      bloques.push(tabla(`${titulo}: picking${artFiltro ? ` de ${artFiltro.sku}` : ""}`, [
        { clave: "articulo", titulo: "Artículo" }, { clave: "pedida", titulo: "Pedida", formato: "numero" },
        { clave: "preparada", titulo: "Preparada", formato: "numero" }, { clave: "pickeo", titulo: "Pickeó" }, { clave: "cuando", titulo: "Cuándo" },
      ], renglones))
    }
    return {
      consultado: `Historia del pedido ${pd.numero_pedido}: alta, estados, preparación, picking, comprobantes, viaje y cobros`,
      datos: {
        pedido: pd.numero_pedido, cliente: pd.clientes?.nombre ?? null, fecha: fechaSola(pd.fecha), estado_actual: pd.estado, total: red(n0(pd.total)),
        cargo: { quien: quien(pd.creado_por), cuando: cuando(pd.created_at), viajante: pd.vendedores?.nombre ?? null },
        cambios_de_estado: estados.length ? estados : "Sin historial de estados (se anota desde el 29/10/2026).",
        preparacion: preparacion.length ? preparacion : sinPrep,
        picking: artFiltro && !renglones.length ? `No hay picking registrado de ${artFiltro.sku} ${artFiltro.descripcion} en este pedido.` : renglones,
        facturacion: comprobantes.length ? comprobantes : "Sin comprobantes emitidos.",
        viaje: v ? { nombre: v.nombre, fecha: fechaSola(v.fecha), estado: v.estado, chofer: v.chofer_id ? quien(v.chofer_id) : v.chofer ?? "sin chofer asignado" } : "No está en un viaje.",
        cobros: cobros.length ? cobros : "Sin cobros asociados a este pedido (puede haberse cobrado a cuenta del cliente).",
      },
      bloques,
    }
  },
}

// ─── 25. Cobros: quién cobró, cómo y cuándo ────────────────────────────────
const cobrosRealizados: Herramienta = {
  nombre: "cobros_realizados",
  descripcion:
    "Cobros a clientes de un período: fecha, cliente, monto, FORMA de pago (efectivo, transferencia, cheque…), QUIÉN cobró (oficina, chofer o viajante), quién lo confirmó y si se anuló (quién). Filtros: cliente, persona (quién cobró o cargó), forma de pago.",
  esquema: {
    type: "object",
    properties: {
      ...P_PERIODO, cliente: { type: "string" },
      persona: { type: "string", description: "Nombre de quien cobró, cargó o confirmó" },
      forma: { type: "string", enum: ["efectivo", "transferencia", "cheque"] },
      ...P_LIMITE,
    },
  },
  async ejecutar(ctx, p) {
    const r = resolverPeriodo(p as never, "mes_actual", ctx.hoy)
    const filtros: string[] = []
    let cliId: string | null = null
    if (str(p.cliente)) { const c = await resolverCliente(ctx.db, str(p.cliente)!); cliId = c.id; filtros.push(`cliente ${c.nombre}`) }
    const data = await fetchAllRows<any>(() => {
      const q = ctx.db.from("pagos_clientes")
        .select("id, fecha_pago, monto, estado, cobrador_tipo, creado_por, confirmado_por, fecha_confirmacion, verificado_por, anulado_por, anulado_at, motivo_anulacion, created_at, clientes(nombre), vendedores(nombre), viajes(nombre), pagos_detalle(tipo_pago, monto, banco, numero_cheque)")
        .gte("fecha_pago", r.desde).lte("fecha_pago", r.hasta)
      return cliId ? q.eq("cliente_id", cliId) : q
    }, "id")
    const nom = await nombresDeUsuarios(ctx.db, data.flatMap((c) => [c.creado_por, c.confirmado_por, c.verificado_por, c.anulado_por]))
    const n = (id: unknown) => (id ? nom.get(String(id)) ?? "usuario desconocido" : null)
    let filas = data.map((c) => {
      const formas = ((c.pagos_detalle ?? []) as any[])
      const cobro = c.cobrador_tipo === "viajante" ? `${c.vendedores?.nombre ?? "viajante"} (viajante)` : `${n(c.creado_por) ?? "no quedó registrado"}${c.cobrador_tipo ? ` (${c.cobrador_tipo})` : ""}`
      return {
        fecha: fechaSola(c.fecha_pago), cliente: c.clientes?.nombre ?? "—", monto: red(n0(c.monto)),
        forma: [...new Set(formas.map((d) => d.tipo_pago))].join(" + ") || "sin detalle",
        detalle_formas: formas.map((d) => ({ forma: d.tipo_pago, monto: red(n0(d.monto)), banco: d.banco ?? null, cheque: d.numero_cheque ?? null })),
        cobro, cargo: n(c.creado_por), cargado: cuando(c.created_at),
        confirmo: n(c.confirmado_por), confirmado: cuando(c.fecha_confirmacion), verifico: n(c.verificado_por),
        estado: c.estado, anulo: n(c.anulado_por), anulado: cuando(c.anulado_at), motivo_anulacion: c.motivo_anulacion ?? null,
        viaje: c.viajes?.nombre ?? null,
      }
    })
    const persona = str(p.persona)?.toLowerCase()
    if (persona) {
      filas = filas.filter((f) => [f.cobro, f.cargo, f.confirmo].some((x) => x?.toLowerCase().includes(persona)))
      filtros.push(`persona ${str(p.persona)}`)
    }
    if (str(p.forma)) { filas = filas.filter((f) => f.forma.includes(String(p.forma))); filtros.push(`forma ${p.forma}`) }
    filas.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
    const vigentes = filas.filter((f) => f.estado !== "anulado")
    const total = red(vigentes.reduce((s, f) => s + f.monto, 0))
    const porForma = new Map<string, number>()
    for (const f of vigentes) for (const d of f.detalle_formas) porForma.set(d.forma, (porForma.get(d.forma) ?? 0) + d.monto)
    const porPersona = new Map<string, number>()
    for (const f of vigentes) porPersona.set(f.cobro, (porPersona.get(f.cobro) ?? 0) + f.monto)
    const lim = limite(p.limite, 20)
    const filtroTxt = filtros.length ? ` (${filtros.join(", ")})` : ""
    const bloque = tabla(
      `Cobros ${r.etiqueta}${filtroTxt}`,
      [
        { clave: "fecha", titulo: "Fecha", formato: "fecha" }, { clave: "cliente", titulo: "Cliente" },
        { clave: "monto", titulo: "Monto", formato: "pesos" }, { clave: "forma", titulo: "Forma" },
        { clave: "cobro", titulo: "Cobró" }, { clave: "confirmo", titulo: "Confirmó" }, { clave: "estado", titulo: "Estado" },
      ],
      filas.slice(0, lim).map(({ detalle_formas: _d, ...f }) => f),
      { total: { monto: total }, nota: "El total no suma los anulados." },
    )
    return {
      consultado: `Cobros ${r.etiqueta}${filtroTxt}, con forma de pago y responsables`,
      datos: {
        periodo: r, cantidad: filas.length, total_vigente: total, anulados: filas.length - vigentes.length,
        por_forma: [...porForma.entries()].map(([forma, monto]) => ({ forma, monto: red(monto) })),
        por_quien_cobro: [...porPersona.entries()].map(([quien, monto]) => ({ quien, monto: red(monto) })).sort((a, b) => b.monto - a.monto),
        filas: filas.slice(0, lim),
      },
      bloques: [{ ...bloque, recalcular: { herramienta: "cobros_realizados", parametros: { ...p } } }],
    }
  },
}

// ─── 26. Pagos a proveedores hechos: quién pagó, cómo, quién autorizó ──────
const ordenesDePago: Herramienta = {
  nombre: "ordenes_de_pago",
  descripcion:
    "Pagos HECHOS (u órdenes de pago armadas) a proveedores en un período: número de OP, proveedor, monto, retenciones, neto, CÓMO se pagó (efectivo, transferencia, cheque), quién la ARMÓ (= quién AUTORIZÓ el pago), quién la confirmó y quién la anuló. Gastos y vencimientos pagados sin orden de pago (EDES, impuestos…): 'gastos_pagados'. Para lo que FALTA pagar usá 'pagos_proveedores'.",
  esquema: { type: "object", properties: { ...P_PERIODO, proveedor: { type: "string" }, ...P_LIMITE } },
  async ejecutar(ctx, p) {
    const r = resolverPeriodo(p as never, "mes_actual", ctx.hoy)
    let provId: string | null = null
    let nombreProv = ""
    if (str(p.proveedor)) { const pr = await resolverNombre(ctx.db, "proveedores", str(p.proveedor)!, "el proveedor"); provId = pr.id; nombreProv = pr.nombre }
    const base = "id, numero_op, fecha, estado, monto_total, total_retenciones, neto_a_pagar, usuario_creador, created_at, observaciones, proveedores(nombre), ordenes_pago_detalle(medio, monto, cheque_numero, cheque_banco, banco_destino, numero_transferencia)"
    const traer = (sel: string) => fetchAllRows<any>(() => {
      const q = ctx.db.from("ordenes_pago").select(sel).gte("fecha", r.desde).lte("fecha", r.hasta)
      return provId ? q.eq("proveedor_id", provId) : q
    }, "id")
    let data: any[]
    let conResponsables = true
    try {
      data = await traer(`${base}, confirmado_por, confirmado_at, anulado_por, anulado_at`)
    } catch (e) {
      if (!faltaEnLaBase(e)) throw e
      conResponsables = false
      data = await traer(base)
    }
    // usuario_creador guarda el MAIL de quien armó la OP
    const mails = [...new Set(data.map((o) => o.usuario_creador).filter((x: unknown) => typeof x === "string" && x.includes("@")))]
    const { data: us } = mails.length ? await ctx.db.from("usuarios").select("email, nombre").in("email", mails) : { data: [] }
    const porMail = new Map(((us ?? []) as { email: string; nombre: string | null }[]).map((u) => [u.email, u.nombre || u.email]))
    const nom = await nombresDeUsuarios(ctx.db, data.flatMap((o) => [o.confirmado_por, o.anulado_por]))
    const filas = data.map((o) => {
      const medios = (o.ordenes_pago_detalle ?? []) as any[]
      return {
        op: o.numero_op ?? null, fecha: fechaSola(o.fecha), proveedor: o.proveedores?.nombre ?? "—", estado: o.estado,
        monto: red(n0(o.monto_total)), retenciones: red(n0(o.total_retenciones)), neto: red(n0(o.neto_a_pagar)),
        como: [...new Set(medios.map((m) => m.medio))].join(" + ") || "sin detalle",
        medios: medios.map((m) => ({ medio: m.medio, monto: red(n0(m.monto)), cheque: m.cheque_numero ?? null, banco: m.cheque_banco ?? m.banco_destino ?? null, transferencia: m.numero_transferencia ?? null })),
        armo: porMail.get(o.usuario_creador) ?? o.usuario_creador ?? "no quedó registrado", armada: cuando(o.created_at),
        confirmo: !conResponsables ? "todavía no se registra (falta aplicar la migración 20261105)" : o.confirmado_por ? nom.get(o.confirmado_por) ?? "usuario desconocido" : o.estado === "pagada" ? "no quedó registrado (confirmada antes de que se anotara)" : null,
        confirmada: cuando(o.confirmado_at), anulo: o.anulado_por ? nom.get(o.anulado_por) ?? "usuario desconocido" : null, anulada: cuando(o.anulado_at),
      }
    }).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
    const pagadas = filas.filter((f) => f.estado === "pagada")
    const lim = limite(p.limite, 20)
    const bloque = tabla(
      `Órdenes de pago ${r.etiqueta}${nombreProv ? ` — ${nombreProv}` : ""}`,
      [
        { clave: "fecha", titulo: "Fecha", formato: "fecha" }, { clave: "op", titulo: "OP" }, { clave: "proveedor", titulo: "Proveedor" },
        { clave: "neto", titulo: "Neto pagado", formato: "pesos" }, { clave: "como", titulo: "Cómo" }, { clave: "estado", titulo: "Estado" },
        { clave: "armo", titulo: "Autorizó (armó)" }, { clave: "confirmo", titulo: "Confirmó" },
      ],
      filas.slice(0, lim).map(({ medios: _m, ...f }) => f),
      { total: { neto: red(pagadas.reduce((s, f) => s + f.neto, 0)) }, nota: "El total suma solo las pagadas." },
    )
    return {
      consultado: `Órdenes de pago ${r.etiqueta}${nombreProv ? ` de ${nombreProv}` : ""}, con medios y responsables`,
      datos: {
        periodo: r, cantidad: filas.length, pagadas: pagadas.length, neto_pagado: red(pagadas.reduce((s, f) => s + f.neto, 0)),
        filas: filas.slice(0, lim),
        aviso: "Los pagos viejos cargados directo en 'pagos a proveedores' (antes de las órdenes de pago) no guardan quién los hizo.",
      },
      bloques: [{ ...bloque, recalcular: { herramienta: "ordenes_de_pago", parametros: { ...p } } }],
    }
  },
}

// ─── 27. Cambios de un artículo: qué cambió, cuándo y quién ────────────────
const NOMBRE_CAMPO: Record<string, string> = {
  precio_compra: "costo (precio de compra)", precio_base: "precio base", precio_base_contado: "precio base contado",
  porcentaje_ganancia: "% de ganancia", descuento_propio: "descuento propio", bonif_recargo: "bonificación/recargo",
  descuento1: "descuento 1", descuento2: "descuento 2", descuento3: "descuento 3", descuento4: "descuento 4",
  iva_compras: "IVA compras", iva_ventas: "IVA ventas", descripcion: "descripción", sku: "código", ean13: "EAN",
  activo: "activo", unidades_por_bulto: "unidades por bulto", proveedor_nombre: "proveedor", marca_nombre: "marca",
  categoria: "categoría", rubro: "rubro", subcategoria: "subcategoría", segmento_precio: "segmento de precio",
  precio_lista_especial: "precio lista especial", oferta_lista_especial: "oferta lista especial", ultimo_costo: "último costo",
}
const cambiosArticulo: Herramienta = {
  nombre: "cambios_articulo",
  descripcion:
    "Historial de cambios de UN artículo: qué dato cambió (costo, precio, descuentos, descripción, proveedor, alta/baja…), cómo estaba, cómo quedó, CUÁNDO y QUIÉN lo cambió. Usala para '¿quién le cambió el precio / los datos al artículo X?'.",
  esquema: {
    type: "object",
    properties: { articulo: { type: "string", description: "Código (sku), EAN o descripción" }, dias: { type: "integer", description: "Hacia atrás (por defecto 180)" } },
    required: ["articulo"],
  },
  async ejecutar(ctx, p) {
    const a = await resolverArticulo(ctx.db, String(p.articulo ?? ""))
    const dias = Math.max(1, Math.min(730, Number(p.dias) || 180))
    const desde = inicioDiaAR(sumarDiasISO(ctx.hoy, -dias))
    const [infoR, cambiosR, estadoR, preciosR] = await Promise.all([
      ctx.db.from("articulos").select("created_at, updated_at, actualizado_por, activo").eq("id", a.id).maybeSingle(),
      ctx.db.from("articulos_cambios").select("campo, antes, despues, usuario_id, via, cambiado_at").eq("articulo_id", a.id).gte("cambiado_at", desde).order("cambiado_at", { ascending: false }).limit(200),
      ctx.db.from("articulos_estado_historial").select("activo, usuario_id, origen, created_at").eq("articulo_id", a.id).gte("created_at", desde).order("created_at", { ascending: false }).limit(50),
      ctx.db.from("precio_insumos_historial").select("datos, vigente_desde").eq("tabla", "articulos").eq("registro_id", a.id).order("vigente_desde", { ascending: true }).limit(400),
    ])
    const hayRegistroNuevo = !(cambiosR.error && faltaEnLaBase(cambiosR.error))
    if (cambiosR.error && hayRegistroNuevo) throw new Error(cambiosR.error.message)
    const info = (infoR.data ?? {}) as any
    const nom = await nombresDeUsuarios(ctx.db, [
      info.actualizado_por, ...((cambiosR.data ?? []) as any[]).map((c) => c.usuario_id), ...((estadoR.data ?? []) as any[]).map((e) => e.usuario_id),
    ])
    const q = (id: unknown, via?: string | null) => (id ? nom.get(String(id)) ?? "usuario desconocido" : via === "service_role" ? "el sistema (no anotó persona)" : "no quedó registrado")
    const cambios = ((cambiosR.data ?? []) as any[]).map((c) => ({
      cuando: cuando(c.cambiado_at), dato: NOMBRE_CAMPO[c.campo] ?? c.campo, antes: valorLindo(c.antes), despues: valorLindo(c.despues), quien: q(c.usuario_id, c.via),
    }))
    const altasBajas = ((estadoR.data ?? []) as any[]).map((e) => ({ cuando: cuando(e.created_at), dato: "estado", antes: e.activo ? "baja" : "activo", despues: e.activo ? "activo (reactivado)" : "dado de baja", quien: q(e.usuario_id), origen: e.origen ?? null }))
    // Historial de precios (desde el 18/09/2026): qué cambió y cuándo, SIN quién.
    const versiones = ((preciosR.data ?? []) as any[])
    const preciosSinQuien: { cuando: string | null; dato: string; antes: string | null; despues: string | null; quien: string; _desde: string }[] = []
    for (let i = 1; i < versiones.length; i++) {
      const ant = versiones[i - 1].datos ?? {}, act = versiones[i].datos ?? {}
      if (String(versiones[i].vigente_desde) < desde) continue
      for (const k of Object.keys(act)) {
        if (k === "id" || JSON.stringify(ant[k]) === JSON.stringify(act[k])) continue
        preciosSinQuien.push({ cuando: cuando(versiones[i].vigente_desde), dato: NOMBRE_CAMPO[k] ?? k, antes: valorLindo(ant[k]), despues: valorLindo(act[k]), quien: "no se registraba quién (historial de precios)", _desde: String(versiones[i].vigente_desde) })
      }
    }
    // Si ya hay registro nuevo, los cambios de precio también están ahí (con quién): no duplicar.
    const primeroNuevo = cambios.length ? ((cambiosR.data ?? []) as any[]).at(-1)?.cambiado_at : null
    const viejos = (primeroNuevo ? preciosSinQuien.filter((x) => x._desde < String(primeroNuevo)) : preciosSinQuien).map(({ _desde: _x, ...v }) => v)
    const todo = [...cambios, ...altasBajas, ...viejos.reverse()].slice(0, 60)
    const bloque = tabla(
      `Cambios de ${a.sku} ${a.descripcion} (últimos ${dias} días)`,
      [{ clave: "cuando", titulo: "Cuándo" }, { clave: "dato", titulo: "Dato" }, { clave: "antes", titulo: "Antes" }, { clave: "despues", titulo: "Después" }, { clave: "quien", titulo: "Quién" }],
      todo.map(({ origen: _o, ...f }: any) => f),
      { nota: hayRegistroNuevo ? "Quién cambió cada dato se anota desde el 05/11/2026. Antes solo hay historial de precios (sin quién)." : "Todavía no se anota quién cambia cada dato (falta aplicar la migración 20261105). Se muestra el historial de precios (sin quién)." },
    )
    return {
      consultado: `Historial de cambios del artículo ${a.sku} ${a.descripcion} (últimos ${dias} días)`,
      datos: {
        articulo: `${a.sku} ${a.descripcion}`, proveedor: a.proveedor_nombre, activo: info.activo ?? null,
        alta: cuando(info.created_at), ultima_modificacion: cuando(info.updated_at), ultimo_que_lo_toco: info.actualizado_por ? q(info.actualizado_por) : "no quedó registrado",
        cambios: todo, registro_de_quien_desde: hayRegistroNuevo ? "05/11/2026" : "todavía no se registra (falta la migración)",
        sin_cambios: todo.length === 0 ? `No hay cambios registrados en los últimos ${dias} días.` : undefined,
      },
      bloques: [{ ...bloque, recalcular: { herramienta: "cambios_articulo", parametros: { ...p } } }],
    }
  },
}

// ─── 28. Vencimientos pagados (gastos, servicios, impuestos…): quién pagó ──
/** Sueldos y socios: solo los ve un admin (lib/finanzas/tipos-reservados). */
async function veReservados(ctx: Contexto): Promise<boolean> {
  if (!ctx.usuarioId) return false
  const { data } = await ctx.db.from("usuarios_roles").select("roles(nombre)").eq("usuario_id", ctx.usuarioId)
  return esAdminFinanzas(((data ?? []) as any[]).map((r) => r.roles?.nombre).filter(Boolean))
}
const filtroReservados = `(${TIPOS_SOLO_ADMIN.join(",")})`

const gastosPagados: Herramienta = {
  nombre: "gastos_pagados",
  descripcion:
    "Vencimientos PAGADOS (gastos, servicios como EDES, impuestos, cargas sociales, honorarios, facturas de proveedor…) en un período: qué, cuánto, QUIÉN lo marcó pagado y cuándo. Si se pagó con orden de pago: el número y quién la armó (= quién lo autorizó). Con 'buscar' (concepto o proveedor) trae además el historial de cada uno: quién lo cargó, quién le cambió monto o fecha, quién lo pasó a pagado o lo volvió a pendiente.",
  esquema: {
    type: "object",
    properties: {
      ...P_PERIODO,
      buscar: { type: "string", description: "Texto del concepto o nombre del proveedor (ej. EDES)" },
      tipo: { type: "string", enum: ["factura", "servicios", "impuestos", "cargas_sociales", "honorarios", "sueldos", "socios", "seguros", "vehiculos", "otro"] },
      ...P_LIMITE,
    },
  },
  async ejecutar(ctx, p) {
    const r = resolverPeriodo(p as never, "mes_actual", ctx.hoy)
    const desde = inicioDiaAR(r.desde), hasta = finDiaAR(r.hasta)
    const admin = await veReservados(ctx)
    const tipo = str(p.tipo)
    if (tipo && esTipoReservado(tipo) && !admin) throw new ErrorHerramienta("Los vencimientos de sueldos y socios solo los puede consultar un administrador.")
    const base = "id, concepto, tipo, monto, fecha_vencimiento, forma_pago, orden_pago_id, updated_at, proveedores(nombre)"
    const traer = (conQuien: boolean) => fetchAllRows<any>(() => {
      let q = ctx.db.from("vencimientos").select(conQuien ? `${base}, creado_por, pagado_por, pagado_at` : base).eq("estado", "pagado")
      q = conQuien
        ? q.or(`and(pagado_at.gte.${desde},pagado_at.lte.${hasta}),and(pagado_at.is.null,updated_at.gte.${desde},updated_at.lte.${hasta})`)
        : q.gte("updated_at", desde).lte("updated_at", hasta)
      if (tipo) q = q.eq("tipo", tipo)
      if (!admin) q = q.not("tipo", "in", filtroReservados)
      return q
    }, "id")
    let conQuien = true
    let data: any[]
    try { data = await traer(true) } catch (e) { if (!faltaEnLaBase(e)) throw e; conQuien = false; data = await traer(false) }
    const buscar = str(p.buscar)?.toLowerCase()
    if (buscar) data = data.filter((v) => `${v.concepto ?? ""} ${v.proveedores?.nombre ?? ""}`.toLowerCase().includes(buscar))

    // Órdenes de pago de los que se pagaron con OP: quién la armó (= autorizó)
    const opIds = [...new Set(data.map((v) => v.orden_pago_id).filter(Boolean))]
    const { data: ops } = opIds.length ? await ctx.db.from("ordenes_pago").select("id, numero_op, usuario_creador, created_at").in("id", opIds) : { data: [] }
    const mails = [...new Set(((ops ?? []) as any[]).map((o) => o.usuario_creador).filter((x) => typeof x === "string" && x.includes("@")))]
    const { data: us } = mails.length ? await ctx.db.from("usuarios").select("email, nombre").in("email", mails) : { data: [] }
    const porMail = new Map(((us ?? []) as any[]).map((u) => [u.email, u.nombre || u.email]))
    const opDe = new Map(((ops ?? []) as any[]).map((o) => [o.id, { numero: o.numero_op, armo: porMail.get(o.usuario_creador) ?? o.usuario_creador ?? "no quedó registrado", cuando: cuando(o.created_at) }]))

    // Historial (solo si buscó algo puntual: puede ser largo)
    const historial = new Map<string, any[]>()
    if (buscar && conQuien && data.length && data.length <= 30) {
      const { data: h, error } = await ctx.db.from("vencimientos_historial")
        .select("vencimiento_id, estado_anterior, estado_nuevo, monto_anterior, monto_nuevo, fecha_anterior, fecha_nueva, usuario_id, via, cambiado_at")
        .in("vencimiento_id", data.map((v) => v.id)).order("cambiado_at")
      if (error && !faltaEnLaBase(error)) throw new Error(error.message)
      for (const x of (h ?? []) as any[]) historial.set(x.vencimiento_id, [...(historial.get(x.vencimiento_id) ?? []), x])
    }
    const nom = await nombresDeUsuarios(ctx.db, [
      ...data.flatMap((v) => [v.pagado_por, v.creado_por]),
      ...[...historial.values()].flat().map((x) => x.usuario_id),
    ])
    const q = (id: unknown, via?: string | null) => (id ? nom.get(String(id)) ?? "usuario desconocido" : via === "service_role" ? "el sistema (no anotó persona)" : "no quedó registrado")
    data.sort((a, b) => String(b.pagado_at ?? b.updated_at ?? "").localeCompare(String(a.pagado_at ?? a.updated_at ?? "")))
    const filas = data.map((v) => {
      const op = v.orden_pago_id ? opDe.get(v.orden_pago_id) : null
      const pagadoAntes = conQuien && !v.pagado_at
      return {
        concepto: v.concepto ?? "—", proveedor: v.proveedores?.nombre ?? null, tipo: v.tipo, monto: red(n0(v.monto)),
        vencia: fechaSola(v.fecha_vencimiento), forma: v.forma_pago ?? null,
        pago: op ? `orden de pago ${op.numero ?? ""}`.trim() : !conQuien || pagadoAntes ? "no quedó registrado (se marcó pagado antes de que se anotara)" : q(v.pagado_por),
        cuando: op ? op.cuando : v.pagado_at ? cuando(v.pagado_at) : `${cuando(v.updated_at)} (última modificación)`,
        autorizo: op ? op.armo : null,
        cargo: conQuien ? (v.creado_por ? q(v.creado_por) : "no quedó registrado") : null,
        historial: (historial.get(v.id) ?? []).map((x) => ({
          cuando: cuando(x.cambiado_at), quien: q(x.usuario_id, x.via),
          que: x.estado_anterior == null ? `lo cargó (${x.estado_nuevo})`
            : x.estado_anterior !== x.estado_nuevo ? `${x.estado_anterior} → ${x.estado_nuevo}`
            : n0(x.monto_anterior) !== n0(x.monto_nuevo) ? `monto ${red(n0(x.monto_anterior))} → ${red(n0(x.monto_nuevo))}`
            : `fecha ${x.fecha_anterior ? fecha(x.fecha_anterior) : "—"} → ${x.fecha_nueva ? fecha(x.fecha_nueva) : "—"}`,
        })),
      }
    })
    const total = red(filas.reduce((s, f) => s + f.monto, 0))
    const lim = limite(p.limite, 20)
    const bloque = tabla(
      `Vencimientos pagados ${r.etiqueta}${buscar ? ` — "${str(p.buscar)}"` : ""}`,
      [
        { clave: "concepto", titulo: "Concepto" }, { clave: "proveedor", titulo: "Proveedor" },
        { clave: "monto", titulo: "Monto", formato: "pesos" }, { clave: "pago", titulo: "Lo pagó" }, { clave: "cuando", titulo: "Cuándo" },
      ],
      filas.slice(0, lim).map(({ historial: _h, ...f }) => f),
      { total: { monto: total }, nota: conQuien ? "Quién lo pagó se anota desde el 05/11/2026; lo pagado con orden de pago lo autorizó quien armó la orden." : "Todavía no se anota quién marca pagado un vencimiento (falta aplicar la migración 20261105)." },
    )
    return {
      consultado: `Vencimientos pagados ${r.etiqueta}${buscar ? ` que coinciden con "${str(p.buscar)}"` : ""}, con quién los pagó`,
      datos: {
        periodo: r, cantidad: filas.length, total, filas: filas.slice(0, lim),
        registro_de_quien: conQuien ? "se anota desde el 05/11/2026" : "todavía no se registra (falta la migración)",
        sin_datos: filas.length === 0 ? "No hay vencimientos marcados pagados en ese período / búsqueda." : undefined,
      },
      bloques: [{ ...bloque, recalcular: { herramienta: "gastos_pagados", parametros: { ...p } } }],
    }
  },
}

export const HERRAMIENTAS: Herramienta[] = [
  indicadoresTablero, ventas, deudaClientes, clientesHabitos, fichaCliente, articulosVendidos,
  coberturaStock, proveedores, pagosProveedores, cheques, operacion, comisiones,
  agendarRecordatorio, proponerDecision, verAgenda, historialDecisionesH, clientesRetenidos,
  indicadoresExternos, insumosProveedor, clasificacionArticulos, calendarioViajes, ausenciasPersonal,
  facturacion, historiaPedido, cobrosRealizados, ordenesDePago, cambiosArticulo, gastosPagados,
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
