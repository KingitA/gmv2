/**
 * Identidad de cada movimiento del banco y armado del lote a guardar, SIN duplicar.
 *
 * Las capturas se superponen y un mismo movimiento se sube muchas veces. Cada renglón lleva una
 * CLAVE (referencia_externa, UNIQUE por cuenta en banco_extractos_movimientos):
 *
 *  - Provincia (y todo extracto con saldo por renglón): día + importe + saldo. El saldo corrido
 *    hace única la fila y además permite CONTROLAR la lectura: el saldo del renglón anterior +
 *    el importe tiene que dar el saldo del renglón. Si la cadena no cierra, el renglón no se guarda.
 *  - Nación (captura): día + hora + concepto + importe. Los impuestos salen a las 00:00:00 y
 *    pueden repetirse IGUALES el mismo día: se numeran por aparición dentro de cada captura
 *    (#1, #2…). Así, para esa clave y ese día queda guardado el MÁXIMO que se vio en una sola
 *    captura, nunca la suma de las capturas.
 *    El detalle (nombre + CUIT) NO entra en la clave: la IA lo lee distinto de una captura a
 *    otra ("COMPA IA" / "COMPAÑIA") y duplicaría; la hora con segundos ya distingue.
 *  - MercadoPago: REFERENCE_ID + importe (el mismo REFERENCE_ID trae la transferencia y su
 *    "Pago de impuestos").
 *  - Credicoop por API: idTransaccion (lo arma lib/bancos/operaciones.ts).
 *
 * Entre FUENTES distintas del mismo banco (captura de Nación vs. PDF mensual, PDF de Credicoop vs.
 * API) las claves no se parecen: ahí se compara por día + importe y solo entra la diferencia
 * (si el PDF trae 3 movimientos de $9.000 ese día y las capturas ya guardaron 2, entra 1).
 *
 * Nunca se inventa un renglón: lo que no se puede leer o controlar se muestra y no se guarda.
 */
import { parseFecha, parseMonto, redondear } from "../../formato"
import { extraerContraparte, limpiarTexto } from "./contraparte"
import type { BancoLectura, EstadoFila, FilaLeida, Lectura, MovExistente, MovLeido, OrigenLectura, SaldoLeido } from "./tipos"

/** Tolerancia para comparar saldos (centavos de redondeo de la lectura). */
const TOL = 0.011

/** "HH:MM:SS" o null */
export function normalizarHora(v: string | null | undefined): string | null {
  const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(v ?? ""))
  if (!m) return null
  const h = Number(m[1]), mi = Number(m[2]), s = Number(m[3] ?? 0)
  if (h > 23 || mi > 59 || s > 59) return null
  const dd = (n: number) => String(n).padStart(2, "0")
  return `${dd(h)}:${dd(mi)}:${dd(s)}`
}

/** Concepto para la clave: mayúsculas, solo letras y números ("GRAVAMEN LEY 25413 S/DEB" → "GRAVAMENLEY25413SDEB"). */
export function conceptoClave(s: string | null | undefined): string {
  return limpiarTexto(s).toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9]/g, "")
}

/** Importe en centavos enteros, para la clave (evita 0.1 + 0.2). */
const cent = (n: number) => String(Math.round(n * 100))

/** Qué banco es una cuenta, por su banco / nombre cargado en Finanzas → Cuentas. */
export function bancoDeCuenta(c: { banco?: string | null; nombre?: string | null; api_banco?: string | null }): BancoLectura {
  const t = `${c.banco ?? ""} ${c.nombre ?? ""} ${c.api_banco ?? ""}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  if (/mercado\s*pago|\bmp\b/.test(t)) return "mp"
  if (/credicoop/.test(t)) return "credicoop"
  if (/provincia|bapro|\bbpba\b/.test(t)) return "provincia"
  if (/nacion|\bbna\b/.test(t)) return "nacion"
  return "otro"
}

const PREFIJO: Record<BancoLectura, string> = { nacion: "bna", provincia: "pba", credicoop: "bccl", mp: "mp", otro: "ext" }

/** ¿Este banco identifica por saldo corrido? (Provincia siempre; los demás cuando su archivo lo trae) */
const usaSaldo = (banco: BancoLectura, filas: Array<{ saldo: number | null }>) =>
  banco === "provincia" || (filas.length > 0 && filas.every((f) => f.saldo != null))

interface Normal extends Omit<MovLeido, "clave" | "estado" | "problema"> { problema: string | null }

/** Lleva un renglón leído a datos limpios, o devuelve por qué no se puede usar. */
export function normalizarFila(f: FilaLeida, origen: OrigenLectura, lectura: number, fila: number): Normal {
  const fecha = parseFecha(typeof f.fecha === "string" ? f.fecha.trim().split(/\s+/)[0] : f.fecha ?? null)
  const hora = normalizarHora(f.hora ?? (typeof f.fecha === "string" ? f.fecha : null))
  const deb = parseMonto(f.debito ?? null), cred = parseMonto(f.credito ?? null)
  let monto: number | null = null
  let problema: string | null = f.problema ? String(f.problema) : null
  if (deb || cred) {
    if (deb && cred) problema ??= "Tiene débito y crédito a la vez"
    else monto = cred ? Math.abs(cred) : -Math.abs(deb as number)
  } else monto = parseMonto(f.monto ?? null)
  const concepto = limpiarTexto(f.concepto)
  const detalleCrudo = limpiarTexto(f.detalle)
  const detalle = detalleCrudo === "-" ? "" : detalleCrudo
  const cp = extraerContraparte(concepto, detalle)
  if (!fecha) problema ??= "Fecha ilegible"
  if (monto == null || !Number.isFinite(monto) || monto === 0) problema ??= "Importe ilegible"
  const saldo = parseMonto(f.saldo ?? null)
  return {
    fecha: fecha ?? "", hora, concepto, detalle,
    contraparte_nombre: limpiarTexto(f.contraparte_nombre) || cp.nombre,
    // El CUIT que diga la IA vale solo si el dígito verificador da (cuitEnTexto lo controla)
    contraparte_cuit: extraerContraparte("", f.contraparte_cuit ?? "").cuit ?? cp.cuit,
    contraparte_cbu: (String(f.contraparte_cbu ?? "").replace(/\D/g, "").length === 22 ? String(f.contraparte_cbu).replace(/\D/g, "") : null) ?? cp.cbu,
    monto: monto == null ? 0 : redondear(monto),
    saldo: saldo == null ? null : redondear(saldo),
    referencia: f.referencia ? limpiarTexto(String(f.referencia)) : null,
    origen, lectura, fila, problema,
  }
}

/** Clave base del renglón (sin el número de aparición). */
export function claveBase(banco: BancoLectura, m: Pick<MovLeido, "fecha" | "hora" | "concepto" | "monto" | "saldo" | "referencia" | "origen">, conSaldo: boolean): string {
  const p = PREFIJO[banco]
  if (conSaldo && m.saldo != null) return `${p}:${m.fecha}|${cent(m.monto)}|s${cent(m.saldo)}`
  if (banco === "mp" && m.referencia) return `mp:${m.referencia}|${cent(m.monto)}`
  if (m.hora) return `${p}:${m.fecha}|${m.hora}|${conceptoClave(m.concepto)}|${cent(m.monto)}`
  // Sin hora (PDF / Excel mensual): número de comprobante si lo hay, y la familia (no se cruza con la captura)
  return `${p}-${m.origen}:${m.fecha}|${m.referencia ? "c" + conceptoClave(m.referencia) + "|" : ""}${conceptoClave(m.concepto)}|${cent(m.monto)}`
}

/**
 * Control por saldo corrido. Un renglón está CONTROLADO si hay otro renglón (de cualquier captura
 * del lote, o ya guardado) cuyo saldo + este importe da este saldo. Si el renglón vecino en la
 * misma captura existe y la cuenta no da → error (la lectura está mal: no se guarda). Si es el
 * más viejo de lo que se ve y no hay con qué compararlo → "sin control" (se muestra aparte).
 */
function controlarCadena(movs: Array<Normal & { clave: string }>, lecturas: Lectura[], existentes: MovExistente[]): Map<number, { estado: EstadoFila; problema: string | null }> {
  const res = new Map<number, { estado: EstadoFila; problema: string | null }>()
  const pool: Array<{ clave: string; fecha: string; saldo: number }> = []
  for (const m of movs) if (m.saldo != null && !m.problema) pool.push({ clave: m.clave, fecha: m.fecha, saldo: m.saldo })
  for (const e of existentes) if (e.saldo_banco != null) pool.push({ clave: e.referencia_externa, fecha: e.fecha, saldo: Number(e.saldo_banco) })
  // Saldo anterior del extracto (SALDO ANTERIOR / INITIAL_BALANCE): predecesor del primer renglón
  lecturas.forEach((l, i) => { if (l.saldo_inicial != null) pool.push({ clave: `inicial#${i}`, fecha: "0000-00-00", saldo: l.saldo_inicial }) })

  const tienePredecesor = (m: Normal & { clave: string }) =>
    pool.some((p) => p.clave !== m.clave && p.fecha <= m.fecha && Math.abs(p.saldo + m.monto - (m.saldo as number)) < TOL)

  movs.forEach((m, i) => {
    if (m.problema) return
    if (m.saldo == null) { res.set(i, { estado: "error", problema: "No se ve el saldo del renglón" }); return }
    if (tienePredecesor(m)) return
    // ¿Tiene un renglón más viejo al lado en la misma captura? Entonces la cuenta tenía que dar
    const l = lecturas[m.lectura]
    const vecino = movs.find((o) => o.lectura === m.lectura && o.fila === (l?.orden === "nuevo_primero" ? m.fila + 1 : m.fila - 1))
    if (vecino && vecino.saldo != null && !vecino.problema) {
      res.set(i, { estado: "error", problema: "El saldo no cierra con el renglón anterior (revisá importe y saldo)" })
    } else {
      res.set(i, { estado: "sin_control", problema: "Es el más viejo de lo que se ve: no hay saldo anterior para controlarlo" })
    }
  })
  return res
}

export interface ResultadoLote {
  filas: MovLeido[]
  nuevos: number
  ya_estaban: number
  sin_control: number
  errores: number
  saldo: SaldoLeido | null
}

/**
 * Arma el lote a partir de una o varias capturas/archivos de UNA cuenta y lo compara con lo
 * que ya está guardado. Devuelve cada renglón con su estado; guardar = los "nuevo" (y los
 * "sin_control" que la persona deje marcados). Función pura: la usan la vista previa y el guardado.
 */
export function prepararLote(banco: BancoLectura, lecturas: Lectura[], existentes: MovExistente[]): ResultadoLote {
  // 1) Normalizar
  const normales: Normal[] = []
  lecturas.forEach((l, li) => l.filas.forEach((f, fi) => normales.push(normalizarFila(f, l.origen, li, fi))))

  // 2) Clave con número de aparición POR LECTURA (máximo por captura, no suma)
  const conSaldoPorLectura = lecturas.map((_, li) => usaSaldo(banco, normales.filter((n) => n.lectura === li)))
  const vistos = new Map<string, number>()
  const conClave = normales.map((n) => {
    const conSaldo = conSaldoPorLectura[n.lectura]
    const base = claveBase(banco, n, conSaldo)
    if (conSaldo && n.saldo != null) {
      // Con saldo la fila es única: una repetida en la misma captura es un error de lectura
      const k = `${n.lectura}|${base}`
      const rep = (vistos.get(k) ?? 0) + 1
      vistos.set(k, rep)
      return { ...n, clave: base, problema: n.problema ?? (rep > 1 ? "Renglón repetido en la misma captura" : null) }
    }
    const k = `${n.lectura}|${base}`
    const ap = (vistos.get(k) ?? 0) + 1
    vistos.set(k, ap)
    return { ...n, clave: `${base}#${ap}` }
  })

  // 3) Control por saldo (cuando hay saldo corrido)
  const control = lecturas.some((_, li) => conSaldoPorLectura[li])
    ? controlarCadena(conClave.filter((m) => conSaldoPorLectura[m.lectura]), lecturas, existentes)
    : new Map()
  const conSaldoIdx = conClave.map((m, i) => ({ m, i })).filter(({ m }) => conSaldoPorLectura[m.lectura])
  const estadoControl = new Map<number, { estado: EstadoFila; problema: string | null }>()
  conSaldoIdx.forEach(({ i }, j) => { const c = control.get(j); if (c) estadoControl.set(i, c) })

  // 4) Unión entre lecturas: la misma clave en dos capturas es el mismo movimiento. Se queda la
  //    mejor lectura (controlada > sin control > con error): un renglón que en una captura no se
  //    pudo controlar y en otra sí, queda controlado.
  const enBase = new Set(existentes.map((e) => e.referencia_externa))
  const rango: Record<EstadoFila, number> = { nuevo: 0, ya_estaba: 0, sin_control: 1, error: 2 }
  const porClave = new Map<string, MovLeido>()
  const conError: MovLeido[] = []
  conClave.forEach((m, i) => {
    let estado: EstadoFila = "nuevo"
    let problema = m.problema
    if (problema) estado = "error"
    else {
      const c = estadoControl.get(i)
      if (c) { estado = c.estado; problema = c.problema }
    }
    if (estado !== "error" && enBase.has(m.clave)) { estado = "ya_estaba"; problema = null }
    const fila: MovLeido = { ...m, estado, problema }
    const antes = porClave.get(m.clave)
    if (!antes || rango[estado] < rango[antes.estado]) porClave.set(m.clave, fila)
    if (estado === "error") conError.push(fila)
  })
  // Un error cuya clave quedó bien leída en otra captura no se muestra (es el mismo movimiento)
  const filas = [...porClave.values()].filter((f) => f.estado !== "error")
  const clavesBien = new Set(filas.map((f) => f.clave))
  const vistosError = new Set<string>()
  for (const f of conError) {
    if (clavesBien.has(f.clave)) continue
    const k = `${f.lectura}|${f.fila}`
    if (!vistosError.has(k)) { vistosError.add(k); filas.push(f) }
  }
  filas.sort((a, b) => a.lectura - b.lectura || a.fila - b.fila)

  // 5) Otras fuentes del mismo banco: por día + importe, entra solo la diferencia
  clasificarContraExistentes(filas, existentes)

  const cuenta = (e: EstadoFila) => filas.filter((f) => f.estado === e).length
  return {
    filas, nuevos: cuenta("nuevo"), ya_estaban: cuenta("ya_estaba"), sin_control: cuenta("sin_control"), errores: cuenta("error"),
    saldo: saldoDelLote(banco, lecturas, filas),
  }
}

/**
 * Esquema de una clave: dos claves del mismo esquema se comparan tal cual; de esquemas distintos
 * (captura con hora vs. PDF con saldo, API con id vs. PDF) no, y ahí se cruza por día + importe.
 */
export function esquemaClave(clave: string): string {
  const prefijo = clave.split(":")[0]
  if (/\|s-?\d+(#\d+)?$/.test(clave)) return `saldo/${prefijo}`
  return `${prefijo}/${clave.includes("|") ? "campos" : "id"}`
}

/**
 * Cruce con lo guardado desde OTRA fuente (otro esquema de clave). Para cada día + importe, cada
 * movimiento ya guardado de otra fuente "absorbe" un renglón nuevo del lote: entra solo lo que
 * sobra. Ej.: el PDF trae 3 impuestos de $9.000 ese día y las capturas ya guardaron 2 → entra 1.
 * Modifica `filas` (estado y problema).
 */
export function clasificarContraExistentes(filas: MovLeido[], existentes: MovExistente[]): void {
  const k = (fecha: string, monto: number) => `${fecha}|${cent(monto)}`
  const grupos = new Map<string, Array<{ esquema: string; usado: boolean }>>()
  const clavesLote = new Set(filas.map((f) => f.clave))
  for (const e of existentes) {
    if (clavesLote.has(e.referencia_externa)) continue // ya identificado por su clave
    const key = k(e.fecha, Number(e.monto))
    const g = grupos.get(key) ?? []
    g.push({ esquema: esquemaClave(e.referencia_externa), usado: false })
    grupos.set(key, g)
  }
  if (!grupos.size) return
  for (const f of filas) {
    if (f.estado !== "nuevo" && f.estado !== "sin_control") continue
    const esq = esquemaClave(f.clave)
    const libre = grupos.get(k(f.fecha, f.monto))?.find((x) => !x.usado && x.esquema !== esq)
    if (libre) {
      libre.usado = true
      f.estado = "ya_estaba"
      f.problema = "Ya estaba cargado desde otra fuente (mismo día e importe)"
    }
  }
}

/** Saldo de la cuenta que deja ver el lote. */
export function saldoDelLote(banco: BancoLectura, lecturas: Lectura[], filas: MovLeido[]): SaldoLeido | null {
  // 1) El saldo del encabezado de la pantalla
  const pantalla = lecturas.find((l) => l.origen === "captura" && l.saldo_cuenta != null)
  if (pantalla) return { saldo: redondear(Number(pantalla.saldo_cuenta)), al: "ahora", fuente: "captura (encabezado)" }
  // 2) Saldo final de un extracto / Excel (vale al último día del período)
  const archivo = lecturas.filter((l) => l.origen !== "captura" && l.saldo_final != null && (l.periodo_hasta || l.filas.length))
  if (archivo.length) {
    const ultimo = archivo
      .map((l) => ({ l, dia: l.periodo_hasta ?? filas.filter((f) => lecturas[f.lectura] === l).map((f) => f.fecha).sort().pop() ?? "" }))
      .sort((a, b) => (a.dia < b.dia ? 1 : -1))[0]
    if (ultimo.dia) return { saldo: redondear(Number(ultimo.l.saldo_final)), al: ultimo.dia, fuente: `${ultimo.l.origen} (saldo final)` }
  }
  // 3) Captura con saldo por renglón (Provincia): el saldo del movimiento más nuevo controlado
  const validos = filas.filter((f) => f.saldo != null && (f.estado === "nuevo" || f.estado === "ya_estaba") && lecturas[f.lectura]?.origen === "captura")
  if (validos.length) {
    // El más nuevo: el que ningún otro tiene como anterior (saldo + importe del otro = saldo del otro)
    const sinSucesor = validos.filter((f) => !validos.some((o) => o !== f && o.fecha >= f.fecha && Math.abs((f.saldo as number) + o.monto - (o.saldo as number)) < TOL))
    const ultimoDia = validos.map((f) => f.fecha).sort().pop() as string
    const candidatos = sinSucesor.filter((f) => f.fecha === ultimoDia)
    if (candidatos.length === 1) return { saldo: candidatos[0].saldo as number, al: "ahora", fuente: "captura (último renglón)" }
  }
  return null
}

/** "hace 5 min" · "hace 3 h" · "hace 2 días" (para el saldo del banco). */
export function haceCuanto(iso: string, ahora: Date = new Date()): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ""
  const min = Math.max(0, Math.floor((ahora.getTime() - t) / 60_000))
  if (min < 1) return "recién"
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  return d === 1 ? "hace 1 día" : `hace ${d} días`
}

/** Para guardar: lo que va a banco_extractos_movimientos por importarExtracto. */
export function aMovImport(m: MovLeido) {
  const descripcion = [m.concepto, m.detalle].filter(Boolean).join(" — ")
  return {
    fecha: m.fecha,
    descripcion,
    monto: m.monto,
    referencia_externa: m.clave,
    hora: m.hora,
    contraparte_nombre: m.contraparte_nombre,
    contraparte_cuit: m.contraparte_cuit,
    contraparte_cbu: m.contraparte_cbu,
    concepto_banco: m.concepto || null,
    saldo_banco: m.saldo,
  }
}
