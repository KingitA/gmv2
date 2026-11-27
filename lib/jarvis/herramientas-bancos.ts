/**
 * Herramientas de Jarvis para BANCOS (Tanda 2 del plan de bancos, docs/bancos/PLAN-BANCOS.md).
 *
 * Todas de SOLO LECTURA y con consultas fijas (lib/bancos/consultas.ts: RPC bancos_gastos /
 * bancos_resumen de la migración 20261127b y consultas tipadas). Jarvis no puede inventar SQL.
 * Lo único que escriben es la clasificación pendiente de los movimientos (concepto_id), que no
 * toca plata ni saldos.
 *
 * Los movimientos son los que se CARGARON del banco (extractos, capturas del homebanking, API de
 * MercadoPago / Credicoop): si algo no se cargó todavía, no aparece. Cada herramienta lo dice.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Bloque, Formato } from "@/lib/playroom/bloques"
import { fecha, fechaHora, formatCuit, normalizarCuit, redondear } from "@/lib/formato"
import { CONCEPTOS_BANCO, conceptoBanco, NOMBRE_TIPO } from "@/lib/bancos/clasificacion"
import {
  conceptosDe, cuentasBanco, FaltaMigracionBancos, FILTROS_CONCEPTO, filtrarCuentas, gastosBancarios, movimientosBancarios,
  resumenBancos, saldosBancos, type CuentaBanco, type MovimientoBanco,
} from "@/lib/bancos/consultas"
import type { Contexto, Herramienta } from "./herramientas"
import { PERIODOS, resolverPeriodo } from "./periodos"

type Params = Record<string, unknown>
type TablaBloque = Extract<Bloque, { tipo: "tabla" }>

export interface AyudasBancos {
  resolverCliente: (db: SupabaseClient, texto: string) => Promise<{ id: string; nombre: string }>
  tabla: (titulo: string, columnas: { clave: string; titulo: string; formato?: Formato }[], filas: Record<string, string | number | null>[],
          extra?: { total?: Record<string, number>; nota?: string }) => TablaBloque
  error: (mensaje: string) => Error
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null)
const num = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v))
const limite = (v: unknown, def = 20, max = 50) => Math.max(1, Math.min(max, Number(v) || def))
const FUENTE = "Movimientos del banco cargados en el sistema (extractos, capturas del homebanking y API). Lo que todavía no se cargó no aparece."

const P_PERIODO = {
  periodo: { type: "string", enum: [...PERIODOS], description: "Período con nombre. Preferilo a fechas sueltas." },
  desde: { type: "string", description: "Fecha inicial AAAA-MM-DD (solo si pidieron fechas exactas)" },
  hasta: { type: "string", description: "Fecha final AAAA-MM-DD" },
}
const P_BANCO = { banco: { type: "string", description: "Credicoop, Nación, Provincia, MercadoPago o el nombre de la cuenta. Vacío = todos." } }
const P_CONCEPTO = {
  concepto: {
    type: "string", enum: FILTROS_CONCEPTO,
    description:
      "Concepto del banco. Grupos: ley_25413 (impuesto al cheque, débitos y créditos), sircreb (recaudación de Ingresos Brutos), percepciones (IIBB e IVA RG 2408), " +
      "iva (IVA sobre comisiones + percepción RG 2408), comisiones (todas las comisiones), impuestos / gastos / pagos / financieros (por tipo). " +
      "O uno puntual: " + CONCEPTOS_BANCO.map((c) => `${c.id} = ${c.nombre}`).join("; ") + ".",
  },
}
const P_LIMITE = { limite: { type: "integer", description: "Cuántas filas mostrar (máx. 50)" } }

export function crearHerramientasBancos(a: AyudasBancos): Herramienta[] {
  const seguro = (fn: Herramienta["ejecutar"]): Herramienta["ejecutar"] => async (ctx, p) => {
    try { return await fn(ctx, p) } catch (e) { if (e instanceof FaltaMigracionBancos) throw a.error(e.message); throw e }
  }
  const cuentasDe = async (ctx: Contexto, p: Params): Promise<{ todas: CuentaBanco[]; elegidas: CuentaBanco[] | null }> => {
    const todas = await cuentasBanco(ctx.db)
    const elegidas = filtrarCuentas(todas, str(p.banco))
    if (elegidas && !elegidas.length) throw a.error(`No encontré la cuenta "${str(p.banco)}". Las cuentas de banco son: ${todas.map((c) => c.nombre).join(", ")}.`)
    return { todas, elegidas }
  }
  const nombreCuenta = (todas: CuentaBanco[], id: string) => todas.find((c) => c.id === id)?.nombre ?? "—"
  const filaMov = (todas: CuentaBanco[]) => (m: MovimientoBanco) => ({
    fecha: m.fecha, hora: m.hora && m.hora !== "00:00:00" ? m.hora.slice(0, 5) : null,
    banco: nombreCuenta(todas, m.cuenta_bancaria_id),
    concepto: m.concepto_banco || m.descripcion || "",
    contraparte: m.contraparte_nombre ?? null,
    cuit: m.contraparte_cuit ? formatCuit(m.contraparte_cuit) : null,
    importe: redondear(m.monto),
    clasificacion: conceptoBanco(m.concepto_id)?.nombre ?? null,
  })
  const COLS_MOV: { clave: string; titulo: string; formato?: Formato }[] = [
    { clave: "fecha", titulo: "Fecha", formato: "fecha" }, { clave: "hora", titulo: "Hora" }, { clave: "banco", titulo: "Banco" },
    { clave: "concepto", titulo: "Concepto del banco" }, { clave: "contraparte", titulo: "Quién" }, { clave: "importe", titulo: "Importe", formato: "moneda" },
  ]

  // ─── 1. Saldos ───────────────────────────────────────────────────────────
  const saldos: Herramienta = {
    nombre: "saldos_bancos",
    descripcion:
      "Cuánta plata hay en cada BANCO (Credicoop, Nación, Provincia, MercadoPago): el saldo que informó el banco y a qué hora, " +
      "el saldo según el sistema (libro de fondos) y la diferencia. Usala para \"¿cuánto hay en el banco?\", \"¿cuánto tenemos en Nación?\", " +
      "\"¿cuadra el banco con el sistema?\". El saldo del banco es el último que se leyó (captura, extracto o API): decí siempre de cuándo es.",
    esquema: { type: "object", properties: { ...P_BANCO } },
    ejecutar: seguro(async (ctx, p) => {
      const { elegidas } = await cuentasDe(ctx, p)
      const ids = elegidas ? new Set(elegidas.map((c) => c.id)) : null
      const filas = (await saldosBancos(ctx.db)).filter((s) => !ids || ids.has(s.cuenta_bancaria_id)).map((s) => ({
        banco: s.cuenta,
        saldo_banco: s.saldo_banco == null ? null : redondear(s.saldo_banco),
        saldo_banco_al: s.saldo_banco_al ? fechaHora(s.saldo_banco_al) : "nunca se leyó",
        fuente: s.saldo_banco_fuente,
        saldo_sistema: redondear(s.saldo_sistema),
        diferencia: s.diferencia,
        ultimo_movimiento_cargado: s.ultimo_movimiento_cargado ? fecha(s.ultimo_movimiento_cargado) : null,
      }))
      const total = (k: "saldo_banco" | "saldo_sistema") => redondear(filas.reduce((t, f) => t + (f[k] ?? 0), 0))
      return {
        consultado: "Saldos de los bancos: lo que informó el banco y lo que dice el sistema",
        datos: { filas, total_banco: total("saldo_banco"), total_sistema: total("saldo_sistema"), nota: "diferencia = banco − sistema" },
        bloques: [{
          ...a.tabla("Saldos de los bancos", [
            { clave: "banco", titulo: "Banco" }, { clave: "saldo_banco", titulo: "Saldo del banco", formato: "moneda" },
            { clave: "saldo_banco_al", titulo: "Al" }, { clave: "saldo_sistema", titulo: "Según el sistema", formato: "moneda" },
            { clave: "diferencia", titulo: "Diferencia", formato: "moneda" },
          ], filas, { total: { saldo_banco: total("saldo_banco"), saldo_sistema: total("saldo_sistema") }, nota: "Diferencia = banco − sistema. El saldo del banco es el último leído." }),
          recalcular: { herramienta: "saldos_bancos", parametros: { ...p } },
        }],
      }
    }),
  }

  // ─── 2. Movimientos ──────────────────────────────────────────────────────
  const movimientos: Herramienta = {
    nombre: "movimientos_bancarios",
    descripcion:
      "Los MOVIMIENTOS del banco (renglón por renglón) con filtros: banco, período, créditos (entró plata) o débitos (salió), concepto (impuestos, comisiones, " +
      "Ley 25.413…), quién transfirió o a quién (nombre o CUIT), importe exacto o entre mínimo y máximo, o un texto del concepto del banco. " +
      "Usala para \"¿qué entró hoy en Nación?\", \"¿hubo una transferencia de $518.740?\", \"¿qué débitos grandes hubo esta semana?\", \"mostrame lo que pagamos a Colgate por banco\". " +
      "Devuelve también cuántos son y el total de créditos y débitos. " + FUENTE,
    esquema: {
      type: "object",
      properties: {
        ...P_BANCO, ...P_PERIODO,
        tipo: { type: "string", enum: ["credito", "debito"], description: "credito = entró plata; debito = salió" },
        ...P_CONCEPTO,
        contraparte: { type: "string", description: "Nombre de quien transfirió / a quien se le transfirió, como lo dijo la persona" },
        cuit: { type: "string", description: "CUIT de la contraparte" },
        monto: { type: "number", description: "Importe exacto (sin signo)" },
        monto_min: { type: "number" }, monto_max: { type: "number" },
        texto: { type: "string", description: "Palabras del concepto del banco (ej. \"DEBIN\", \"cheque\")" },
        ...P_LIMITE,
      },
    },
    ejecutar: seguro(async (ctx, p) => {
      const r = resolverPeriodo(p as never, "ultimos_30_dias", ctx.hoy)
      const { todas, elegidas } = await cuentasDe(ctx, p)
      const lim = limite(p.limite)
      const tipo = p.tipo === "credito" || p.tipo === "debito" ? p.tipo : null
      const res = await movimientosBancarios(ctx.db, {
        desde: r.desde, hasta: r.hasta, cuentaIds: elegidas?.map((c) => c.id) ?? null, tipo,
        conceptoIds: conceptosDe(str(p.concepto)), contraparte: str(p.contraparte), cuit: str(p.cuit),
        monto: num(p.monto), montoMin: num(p.monto_min), montoMax: num(p.monto_max), texto: str(p.texto), limite: lim,
      })
      const filas = res.filas.map(filaMov(todas))
      const titulo = `Movimientos ${elegidas ? elegidas.map((c) => c.nombre).join(", ") : "de los bancos"} ${r.etiqueta}`
      return {
        consultado: `${titulo}${str(p.contraparte) ? ` de/para "${str(p.contraparte)}"` : ""}${num(p.monto) != null ? ` por ${num(p.monto)}` : ""}`,
        datos: {
          periodo: r, cantidad: res.cantidad, creditos: res.creditos, debitos: res.debitos, mostrando: filas.length,
          truncado: res.truncado ? "hay más de 3.000: acotá el período o los filtros" : undefined, filas, fuente: FUENTE,
          sin_datos: res.cantidad === 0 ? "No hay movimientos cargados con esos filtros." : undefined,
        },
        bloques: [{
          ...a.tabla(titulo, COLS_MOV, filas, { total: { importe: redondear(res.creditos - res.debitos) }, nota: `${res.cantidad} movimientos · créditos ${res.creditos} · débitos ${res.debitos}` }),
          recalcular: { herramienta: "movimientos_bancarios", parametros: { ...p } },
        }],
      }
    }),
  }

  // ─── 3. Gastos por concepto ──────────────────────────────────────────────
  const AGRUPAR = ["concepto", "banco", "mes", "banco_concepto"] as const
  const gastos: Herramienta = {
    nombre: "gastos_bancarios_por_concepto",
    descripcion:
      "Cuánto nos cobró el BANCO en impuestos y gastos: impuesto Ley 25.413 (débitos y créditos, \"impuesto al cheque\"), SIRCREB, percepciones de IIBB e IVA, " +
      "IVA sobre comisiones, comisiones (transferencias, cheques, mantenimiento), débitos automáticos, pagos de servicios y ARCA, préstamos y rendimientos. " +
      "Totales por concepto, banco o mes. Usala para \"¿cuánto pagamos de impuesto al cheque en octubre?\", \"¿cuánto nos cobra de comisiones el Credicoop?\", " +
      "\"¿cuánto se fue en SIRCREB este año?\". Los importes son lo que salió (positivo); las reversas y rendimientos restan. " + FUENTE,
    esquema: { type: "object", properties: { ...P_PERIODO, ...P_BANCO, ...P_CONCEPTO, agrupar: { type: "string", enum: [...AGRUPAR] }, ...P_LIMITE } },
    ejecutar: seguro(async (ctx, p) => {
      const r = resolverPeriodo(p as never, "mes_anterior", ctx.hoy)
      const { elegidas } = await cuentasDe(ctx, p)
      const conceptoIds = conceptosDe(str(p.concepto))
      const agrupar = (AGRUPAR as readonly string[]).includes(String(p.agrupar)) ? String(p.agrupar) : "concepto"
      const { filas } = await gastosBancarios(ctx.db, { desde: r.desde, hasta: r.hasta, cuentaIds: elegidas?.map((c) => c.id) ?? null, conceptoIds })
      const grupos = new Map<string, { nombre: string; banco?: string; concepto?: string; tipo?: string; orden: number; cantidad: number; importe: number }>()
      for (const f of filas) {
        const clave = agrupar === "banco" ? f.cuenta : agrupar === "mes" ? f.mes : agrupar === "banco_concepto" ? `${f.cuenta}|${f.concepto_id}` : f.concepto_id
        const g = grupos.get(clave) ?? {
          nombre: agrupar === "banco" ? f.cuenta : agrupar === "mes" ? f.mes : f.concepto,
          ...(agrupar === "banco_concepto" ? { banco: f.cuenta } : {}),
          tipo: agrupar === "concepto" || agrupar === "banco_concepto" ? NOMBRE_TIPO[f.tipo] : undefined,
          orden: f.orden, cantidad: 0, importe: 0,
        }
        g.cantidad += f.cantidad
        g.importe += -f.neto
        grupos.set(clave, g)
      }
      const lista = [...grupos.values()].map((g) => ({ ...g, importe: redondear(g.importe) }))
        .sort((x, y) => (agrupar === "mes" ? x.nombre.localeCompare(y.nombre) : agrupar === "banco" ? y.importe - x.importe : (x.banco ?? "").localeCompare(y.banco ?? "") || x.orden - y.orden))
      const impuestos = redondear(-filas.filter((f) => f.tipo === "impuesto").reduce((t, f) => t + f.neto, 0))
      const comisiones = redondear(-filas.filter((f) => f.tipo === "gasto").reduce((t, f) => t + f.neto, 0))
      const total = redondear(lista.reduce((t, g) => t + g.importe, 0))
      const lim = limite(p.limite, 30)
      const filasTabla = lista.slice(0, lim).map(({ orden: _o, ...g }) => g)
      const titulo = `Impuestos y gastos del banco ${r.etiqueta}${elegidas ? ` — ${elegidas.map((c) => c.nombre).join(", ")}` : ""}`
      return {
        consultado: titulo,
        datos: {
          periodo: r, agrupado_por: agrupar, total, impuestos, comisiones_y_gastos: comisiones, filas: filasTabla,
          signo: "importe positivo = salió plata; negativo = entró (reversas, rendimientos)", fuente: FUENTE,
          sin_datos: filas.length === 0 ? "No hay impuestos ni gastos bancarios cargados para eso." : undefined,
        },
        bloques: [{
          ...a.tabla(titulo, [
            { clave: "nombre", titulo: agrupar === "banco" ? "Banco" : agrupar === "mes" ? "Mes" : "Concepto" },
            ...(agrupar === "banco_concepto" ? [{ clave: "banco", titulo: "Banco" }] : []),
            { clave: "cantidad", titulo: "Renglones", formato: "numero" as Formato }, { clave: "importe", titulo: "Importe", formato: "moneda" as Formato },
          ], filasTabla, { total: { importe: total }, nota: "Importe = lo que salió; reversas y rendimientos restan." }),
          recalcular: { herramienta: "gastos_bancarios_por_concepto", parametros: { ...p } },
        }],
      }
    }),
  }

  // ─── 4. Resumen por banco ────────────────────────────────────────────────
  const resumen: Herramienta = {
    nombre: "resumen_bancos",
    descripcion:
      "Resumen de cada BANCO en un período: créditos (lo que entró), débitos (lo que salió), impuestos, comisiones, pagos por el banco, saldo inicial y saldo final. " +
      "Usala para \"¿cómo cerró octubre en los bancos?\", \"¿cuánto entró y salió del Credicoop este mes?\", \"¿cuánto pagamos de impuestos bancarios en total?\". " +
      "Saldo final = último saldo informado por el banco hasta esa fecha más lo cargado después; saldo inicial = final − (créditos − débitos). " + FUENTE,
    esquema: { type: "object", properties: { ...P_PERIODO, ...P_BANCO } },
    ejecutar: seguro(async (ctx, p) => {
      const r = resolverPeriodo(p as never, "mes_actual", ctx.hoy)
      const { elegidas } = await cuentasDe(ctx, p)
      const ids = elegidas ? new Set(elegidas.map((c) => c.id)) : null
      const filas = (await resumenBancos(ctx.db, r.desde, r.hasta)).filter((x) => !ids || ids.has(x.cuenta_bancaria_id)).map((x) => ({
        banco: x.cuenta, movimientos: x.movimientos,
        creditos: redondear(x.creditos), debitos: redondear(x.debitos),
        impuestos: redondear(x.impuestos), comisiones: redondear(x.gastos), pagos_por_banco: redondear(x.pagos),
        saldo_inicial: x.saldo_inicial, saldo_final: x.saldo_final,
        saldo_tomado_de: x.saldo_referencia_al ? `${x.saldo_fuente ?? "banco"} del ${x.saldo_referencia_al}` : "no hay saldo informado por el banco",
        movimientos_cargados: x.desde_mov ? `del ${fecha(x.desde_mov)} al ${fecha(x.hasta_mov)}` : "ninguno en el período",
        sin_clasificar: x.sin_clasificar || undefined,
      }))
      const tot = (k: "creditos" | "debitos" | "impuestos" | "comisiones") => redondear(filas.reduce((t, f) => t + f[k], 0))
      return {
        consultado: `Resumen de los bancos ${r.etiqueta}`,
        datos: { periodo: r, filas, totales: { creditos: tot("creditos"), debitos: tot("debitos"), impuestos: tot("impuestos"), comisiones: tot("comisiones") }, fuente: FUENTE },
        bloques: [{
          ...a.tabla(`Bancos ${r.etiqueta}`, [
            { clave: "banco", titulo: "Banco" }, { clave: "saldo_inicial", titulo: "Saldo inicial", formato: "moneda" },
            { clave: "creditos", titulo: "Créditos", formato: "moneda" }, { clave: "debitos", titulo: "Débitos", formato: "moneda" },
            { clave: "impuestos", titulo: "Impuestos", formato: "moneda" }, { clave: "comisiones", titulo: "Comisiones", formato: "moneda" },
            { clave: "saldo_final", titulo: "Saldo final", formato: "moneda" },
          ], filas.map(({ saldo_tomado_de: _s, movimientos_cargados: _m, sin_clasificar: _c, ...f }) => f),
          { total: { creditos: tot("creditos"), debitos: tot("debitos"), impuestos: tot("impuestos"), comisiones: tot("comisiones") }, nota: "Saldos según lo informado por el banco y los movimientos cargados." }),
          recalcular: { herramienta: "resumen_bancos", parametros: { ...p } },
        }],
      }
    }),
  }

  // ─── 5. ¿Transfirió X? ───────────────────────────────────────────────────
  const transferenciaDe: Herramienta = {
    nombre: "transferencia_de",
    descripcion:
      "¿Nos TRANSFIRIÓ (o le transferimos a) alguien? Busca en los movimientos del banco por el nombre o el CUIT de quien transfirió: cuándo, cuánto y a qué banco. " +
      "Pasale el cliente (nombre o código: se usa su CUIT y su razón social), o el nombre / CUIT tal como lo dijo la persona. " +
      "Usala para \"¿transfirió Pérez?\", \"¿entró la transferencia de Kenvue?\", \"¿cuándo fue la última transferencia del 20-35034067-0?\". " +
      "Por defecto busca lo que ENTRÓ los últimos 90 días; con sentido=enviada, lo que le mandamos. " +
      "Lo encontrado por CUIT es seguro; lo encontrado solo por nombre puede ser otra persona con el mismo nombre. " + FUENTE,
    esquema: {
      type: "object",
      properties: {
        cliente: { type: "string", description: "Cliente del sistema (nombre o código)" },
        contraparte: { type: "string", description: "Nombre de quien transfirió, si no es un cliente o no se sabe" },
        cuit: { type: "string" },
        sentido: { type: "string", enum: ["recibida", "enviada", "ambas"], description: "recibida (por defecto) = nos transfirieron" },
        monto: { type: "number", description: "Importe exacto, si lo dijeron" },
        ...P_PERIODO, ...P_BANCO, ...P_LIMITE,
      },
    },
    ejecutar: seguro(async (ctx, p) => {
      const r = resolverPeriodo(p as never, "ultimos_90_dias", ctx.hoy)
      const { todas, elegidas } = await cuentasDe(ctx, p)
      let nombres: string[] = str(p.contraparte) ? [str(p.contraparte)!] : []
      let cuit = str(p.cuit) ? normalizarCuit(str(p.cuit)) : null
      let cliente: { id: string; nombre: string } | null = null
      if (str(p.cliente)) {
        cliente = await a.resolverCliente(ctx.db, str(p.cliente)!)
        const { data } = await ctx.db.from("clientes").select("cuit, nombre, nombre_razon_social").eq("id", cliente.id).maybeSingle()
        const c = data as { cuit: string | null; nombre: string | null; nombre_razon_social: string | null } | null
        cuit ??= normalizarCuit(c?.cuit) && normalizarCuit(c?.cuit) !== "00-00000000-0" ? normalizarCuit(c?.cuit) : null
        nombres = [...new Set([...nombres, c?.nombre_razon_social, c?.nombre].filter((x): x is string => !!x && x.trim().length >= 3))]
      }
      if (!cuit && !nombres.length) throw a.error("Decime de quién: el cliente, el nombre de quien transfirió o el CUIT.")
      const tipo = p.sentido === "enviada" ? "debito" : p.sentido === "ambas" ? null : "credito"
      const base = { desde: r.desde, hasta: r.hasta, cuentaIds: elegidas?.map((c) => c.id) ?? null, tipo, monto: num(p.monto), texto: null, limite: 200 } as const
      const encontrados = new Map<string, { m: MovimientoBanco; por: string }>()
      if (cuit) for (const m of (await movimientosBancarios(ctx.db, { ...base, cuit })).filas) encontrados.set(m.id, { m, por: "CUIT" })
      for (const n of nombres) {
        for (const m of (await movimientosBancarios(ctx.db, { ...base, contraparte: n })).filas) if (!encontrados.has(m.id)) encontrados.set(m.id, { m, por: "nombre" })
      }
      // Solo transferencias / DEBIN / depósitos (no impuestos que mencionen el nombre)
      const lista = [...encontrados.values()]
        .filter(({ m }) => !m.concepto_id || m.concepto_id === "movimiento" || m.concepto_id === "otro")
        .sort((x, y) => (y.m.fecha + (y.m.hora ?? "")).localeCompare(x.m.fecha + (x.m.hora ?? "")))
      const lim = limite(p.limite, 15)
      const filas = lista.slice(0, lim).map(({ m, por }) => ({ ...filaMov(todas)(m), encontrado_por: por }))
      const total = redondear(lista.reduce((t, { m }) => t + Math.abs(m.monto), 0))
      const quien = cliente?.nombre ?? nombres[0] ?? (cuit ? formatCuit(cuit) : "")
      return {
        consultado: `Transferencias ${tipo === "debito" ? "a" : "de"} ${quien}${cuit ? ` (CUIT ${formatCuit(cuit)})` : ""} en los bancos ${r.etiqueta}`,
        datos: {
          periodo: r, buscado: { cliente: cliente?.nombre ?? null, cuit: cuit ? formatCuit(cuit) : null, nombres },
          cantidad: lista.length, total, ultima: filas[0] ?? null, filas,
          por_cuit: lista.filter((x) => x.por === "CUIT").length, solo_por_nombre: lista.filter((x) => x.por === "nombre").length,
          aviso_nombre: lista.some((x) => x.por === "nombre") ? "Lo encontrado solo por nombre puede ser de otra persona con el mismo nombre (sin CUIT no es seguro)." : undefined,
          sin_datos: lista.length === 0 ? "No aparece ninguna transferencia cargada con ese nombre o CUIT en el período (puede que el banco todavía no se haya cargado)." : undefined,
          fuente: FUENTE,
        },
        bloques: [{
          ...a.tabla(`Transferencias ${tipo === "debito" ? "a" : "de"} ${quien} ${r.etiqueta}`, [...COLS_MOV, { clave: "encontrado_por", titulo: "Por" }], filas,
            { total: { importe: total }, nota: "\"Por nombre\" = sin CUIT: puede ser otra persona con el mismo nombre." }),
          recalcular: { herramienta: "transferencia_de", parametros: { ...p } },
        }],
      }
    }),
  }

  return [saldos, movimientos, gastos, resumen, transferenciaDe]
}
