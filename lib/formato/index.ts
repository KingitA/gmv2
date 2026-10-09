// ════════════════════════════════════════════════════════════════════════════
// FORMATOS ÚNICOS DEL SISTEMA (ERP web + apps vendedor / chofer / depósito)
//
//   Fecha   dd/mm/aaaa, hora argentina (America/Argentina/Buenos_Aires, GMT-3)
//   Moneda  $1.000,32  (punto = miles, coma = centavos)
//   CUIT    xx-xxxxxxxx-x
//
// Regla de oro: las PERSONAS ven y escriben en formato argentino; las MÁQUINAS
// (base de datos, JSON, APIs, ARCA, BCRA) hablan en formato de máquina:
//   - fecha de calendario  → "AAAA-MM-DD"            (columnas `date`)
//   - instante             → ISO con zona "…Z"       (columnas `timestamptz`)
//   - montos               → number                  (columnas `numeric`)
//   - CUIT                 → "xx-xxxxxxxx-x" en la base; solo dígitos al
//                            mandarlo a ARCA/BCRA (cuitDigitos)
//
// Todo lo que se MUESTRA pasa por fecha() / fechaHora() / moneda() / formatCuit().
// Todo lo que se ESCRIBE pasa por parseFecha() / parseMonto() / normalizarCuit().
// Ver docs/FORMATOS.md. Módulo puro (sin imports): lo usan el ERP y las apps
// (alias @gm/formato) y lo prueba mobile/packages/core/test/formato.test.ts.
// ════════════════════════════════════════════════════════════════════════════

export const ZONA_AR = "America/Argentina/Buenos_Aires"

// ── FECHAS ──────────────────────────────────────────────────────────────────

export type EntradaFecha = string | number | Date | null | undefined

const RE_ISO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/
// Timestamp SIN zona (columnas viejas `timestamp without time zone`): la base
// guarda hora UTC, así que se interpreta como UTC (no como hora local del equipo).
const RE_ISO_SIN_ZONA = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/

/** Convierte cualquier entrada de fecha a Date, o null si no es válida. */
export function aDate(v: EntradaFecha): Date | null {
  if (v == null || v === "") return null
  let d: Date
  if (v instanceof Date) d = new Date(v.getTime())
  else if (typeof v === "number") d = new Date(v)
  else {
    const s = v.trim()
    if (RE_ISO_FECHA.test(s)) d = new Date(`${s}T12:00:00Z`) // mediodía UTC = 9 h en AR: mismo día
    else if (RE_ISO_SIN_ZONA.test(s)) d = new Date(`${s.replace(" ", "T")}Z`)
    else d = new Date(s)
  }
  return Number.isNaN(d.getTime()) ? null : d
}

const fmtPartes = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONA_AR,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hourCycle: "h23",
})

/** Partes de la fecha/hora en Argentina. */
export function partesAR(v: EntradaFecha): { anio: string; mes: string; dia: string; hora: string; min: string; seg: string } | null {
  const d = aDate(v)
  if (!d) return null
  const p: Record<string, string> = {}
  for (const x of fmtPartes.formatToParts(d)) p[x.type] = x.value
  return { anio: p.year, mes: p.month, dia: p.day, hora: p.hour === "24" ? "00" : p.hour, min: p.minute, seg: p.second }
}

/** "09/10/2026". Vacío si no hay fecha. */
export function fecha(v: EntradaFecha): string {
  const p = partesAR(v)
  return p ? `${p.dia}/${p.mes}/${p.anio}` : ""
}

/** "09/10/2026 14:05" (hora argentina). */
export function fechaHora(v: EntradaFecha): string {
  const p = partesAR(v)
  return p ? `${p.dia}/${p.mes}/${p.anio} ${p.hora}:${p.min}` : ""
}

/** "14:05" (hora argentina). */
export function hora(v: EntradaFecha): string {
  const p = partesAR(v)
  return p ? `${p.hora}:${p.min}` : ""
}

/** "09/10" (para listas compactas). */
export function fechaCorta(v: EntradaFecha): string {
  const p = partesAR(v)
  return p ? `${p.dia}/${p.mes}` : ""
}

/** Día de calendario en Argentina como "AAAA-MM-DD" (para guardar en columnas `date` y filtrar). */
export function fechaISO(v: EntradaFecha): string {
  if (typeof v === "string" && RE_ISO_FECHA.test(v.trim())) return v.trim()
  const p = partesAR(v)
  return p ? `${p.anio}-${p.mes}-${p.dia}` : ""
}

/** Hoy en Argentina, "AAAA-MM-DD". Nunca usar new Date().toISOString().slice(0,10): después de las 21 h da mañana. */
export function hoyISO(): string {
  return fechaISO(new Date())
}

/** Instante actual para columnas timestamptz ("…Z"). */
export function ahoraISO(): string {
  return new Date().toISOString()
}

/** Suma (o resta) días a una fecha de calendario "AAAA-MM-DD". */
export function sumarDiasISO(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** Inicio del día argentino como instante UTC (para .gte() sobre timestamptz). */
export function inicioDiaAR(iso: string): string {
  return new Date(`${iso}T00:00:00.000-03:00`).toISOString()
}

/** Fin del día argentino como instante UTC (para .lte() sobre timestamptz). */
export function finDiaAR(iso: string): string {
  return new Date(`${iso}T23:59:59.999-03:00`).toISOString()
}

/**
 * Instante del mediodía argentino de un día ("AAAA-MM-DD" → "…T15:00:00.000Z").
 * Para guardar en una columna timestamptz algo de lo que solo se sabe el DÍA
 * (ej. kardex.fecha = fecha del comprobante): con "AAAA-MM-DD" a secas quedaba
 * a las 00 UTC = 21 h del día ANTERIOR en Argentina.
 */
export function mediodiaAR(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T12:00:00.000-03:00`).toISOString()
}

/** Días entre dos fechas de calendario (b − a). */
export function diasEntre(a: EntradaFecha, b: EntradaFecha): number {
  const x = fechaISO(a), y = fechaISO(b)
  if (!x || !y) return NaN
  return Math.round((Date.parse(`${y}T12:00:00Z`) - Date.parse(`${x}T12:00:00Z`)) / 86_400_000)
}

function fechaValida(a: number, m: number, d: number): boolean {
  if (a < 1900 || a > 2200 || m < 1 || m > 12 || d < 1) return false
  return d <= new Date(Date.UTC(a, m, 0)).getUTCDate()
}
const iso = (a: number, m: number, d: number) => `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`

/**
 * Entiende una fecha escrita por una persona, un Excel, un OCR o una API y la
 * devuelve como "AAAA-MM-DD" (o null si no es una fecha válida).
 *   9/10/2026 · 09/10/26 · 09-10-2026 · 09.10.2026 · 09102026  → día/mes/año (NUNCA mes/día)
 *   2026-10-09 · 2026-10-09T14:00:00Z                           → ISO (instante → día argentino)
 *   20261009 (ARCA)                                             → AAAAMMDD
 *   45939 (número de serie de Excel)                            → fecha de Excel
 */
export function parseFecha(v: EntradaFecha): string | null {
  if (v == null || v === "") return null
  if (v instanceof Date) return fechaISO(v) || null
  if (typeof v === "number") {
    // Serie de Excel (días desde 1899-12-30): 20000 ≈ 1954, 80000 ≈ 2119
    if (v > 20000 && v < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000)
      return d.toISOString().slice(0, 10)
    }
    return fechaISO(v) || null
  }
  const s = v.trim()
  // ISO: fecha sola o instante
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](.*))?$/)
  if (m) {
    const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
    if (!fechaValida(a, mes, d)) return null
    if (!m[4]) return iso(a, mes, d)
    return fechaISO(s) || null
  }
  // dd/mm/aaaa con / - . o espacio (año de 2 o 4 dígitos)
  m = s.match(/^(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{2}|\d{4})$/)
  if (m) {
    const d = Number(m[1]), mes = Number(m[2])
    let a = Number(m[3])
    if (m[3].length === 2) a += 2000
    return fechaValida(a, mes, d) ? iso(a, mes, d) : null
  }
  // 8 dígitos: ddmmaaaa; si no es válida, AAAAMMDD (formato de ARCA)
  m = s.match(/^(\d{2})(\d{2})(\d{4})$/)
  if (m) {
    const [d, mes, a] = [Number(m[1]), Number(m[2]), Number(m[3])]
    if (fechaValida(a, mes, d)) return iso(a, mes, d)
    const a2 = Number(s.slice(0, 4)), m2 = Number(s.slice(4, 6)), d2 = Number(s.slice(6, 8))
    return fechaValida(a2, m2, d2) ? iso(a2, m2, d2) : null
  }
  // 6 dígitos: ddmmaa
  m = s.match(/^(\d{2})(\d{2})(\d{2})$/)
  if (m) {
    const [d, mes, a] = [Number(m[1]), Number(m[2]), 2000 + Number(m[3])]
    return fechaValida(a, mes, d) ? iso(a, mes, d) : null
  }
  return null
}

// ── MONEDA Y NÚMEROS ───────────────────────────────────────────────────────

const cacheNum = new Map<string, Intl.NumberFormat>()
function nf(min: number, max: number): Intl.NumberFormat {
  const k = `${min}-${max}`
  let f = cacheNum.get(k)
  if (!f) {
    f = new Intl.NumberFormat("es-AR", { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: true })
    cacheNum.set(k, f)
  }
  return f
}

// es-AR en algunos motores no agrupa números de 4 cifras ("1000,00"): se fuerza el punto de miles.
function agrupar(s: string): string {
  const [ent, dec] = s.split(",")
  const neg = ent.startsWith("-")
  const dig = (neg ? ent.slice(1) : ent).replace(/\./g, "")
  const g = dig.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  return `${neg ? "-" : ""}${g}${dec !== undefined ? "," + dec : ""}`
}

function aNumero(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** "1.000,32" — número con formato argentino. `decimales` fijos (por defecto 2). */
export function numero(v: number | string | null | undefined, decimales = 2, maxDecimales = decimales): string {
  const n = aNumero(v)
  if (n === null) return ""
  const r = nf(decimales, Math.max(decimales, maxDecimales)).format(n === 0 ? 0 : n) // sin "-0"
  return agrupar(r.replace(/ /g, ""))
}

/** "$1.000,32" · "-$1.000,32". Vacío si no hay monto. */
export function moneda(v: number | string | null | undefined, decimales = 2): string {
  const n = aNumero(v)
  if (n === null) return ""
  const r = Math.abs(n) < 0.5 / 10 ** decimales ? 0 : n
  return r < 0 ? `-$${numero(-r, decimales)}` : `$${numero(r, decimales)}`
}

/** "15,5%" (hasta `maxDecimales`, sin ceros de más). */
export function porcentaje(v: number | string | null | undefined, maxDecimales = 2): string {
  const n = aNumero(v)
  if (n === null) return ""
  return `${numero(n, 0, maxDecimales)}%`
}

/**
 * Número para CSV que se abre con Excel en castellano: coma decimal y SIN
 * separador de miles ("1234,56"), así Excel lo toma como número. Usar con ";"
 * como separador de columnas.
 */
export function numeroPlano(v: number | string | null | undefined, decimales = 2): string {
  const n = aNumero(v)
  if (n === null) return ""
  return redondear(n, decimales).toFixed(decimales).replace(".", ",") // formato-ok: CSV
}

/** Entero con puntos de miles: "1.250". */
export function entero(v: number | string | null | undefined): string {
  return numero(v, 0)
}

/** Redondeo a centavos sin el error de coma flotante (1.005 → 1.01). */
export function redondear(n: number, decimales = 2): number {
  const f = 10 ** decimales
  return Math.round((n + Number.EPSILON) * f) / f
}

/**
 * Entiende un monto escrito por una persona, un Excel o un OCR y devuelve number
 * (o null si no es un número). Formato argentino primero:
 *   "1.000,32" → 1000.32   "1000,5" → 1000.5   "1.500" → 1500   "$ 2.300" → 2300
 * Tolerancias (lo que aparece en la práctica):
 *   "1,234.56" → 1234.56   (si hay punto Y coma, el ÚLTIMO es el decimal)
 *   "12.5" / "1234.56" → decimal (un solo punto con 1, 2 o 4+ dígitos detrás)
 *   "0.500" → 0.5          (con 0 adelante el punto es decimal)
 *   "(1.200,00)" / "-1.200" → negativo
 */
export function parseMonto(v: string | number | null | undefined): number | null {
  if (v == null) return null
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  let s = v.replace(/[\s $]|ARS|U\$S|USD/gi, "").trim()
  if (!s) return null
  let neg = false
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1) }
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1) }
  else if (s.endsWith("-")) { neg = !neg; s = s.slice(0, -1) }
  if (s.startsWith("+")) s = s.slice(1)
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null

  const ultPunto = s.lastIndexOf("."), ultComa = s.lastIndexOf(",")
  let limpio: string
  if (ultPunto >= 0 && ultComa >= 0) {
    // Los dos: el último es el decimal
    limpio = ultComa > ultPunto ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "")
  } else if (ultComa >= 0) {
    // Solo comas: una = decimal (regla argentina); varias = miles ("1,234,567")
    limpio = (s.match(/,/g)!.length === 1) ? s.replace(",", ".") : s.replace(/,/g, "")
  } else if (ultPunto >= 0) {
    const partes = s.split(".")
    if (partes.length > 2) limpio = s.replace(/\./g, "") // "1.234.567"
    else {
      const [ent, dec] = partes
      // Un solo punto: con exactamente 3 dígitos detrás es separador de miles ("1.500"),
      // salvo que la parte entera sea 0 ("0.500"); si no, es decimal ("12.5").
      limpio = dec.length === 3 && ent !== "" && Number(ent) !== 0 ? ent + dec : s
    }
  } else limpio = s
  const n = Number(limpio)
  if (!Number.isFinite(n)) return null
  return neg ? -n : n
}

/** Alias de parseMonto para cantidades y porcentajes escritos a mano. */
export const parseNumero = parseMonto

// ── CUIT / CUIL ─────────────────────────────────────────────────────────────

/** Solo los dígitos ("20-12345678-9" → "20123456789"). Para ARCA, BCRA y comparar. */
export function cuitDigitos(v: string | number | null | undefined): string {
  return String(v ?? "").replace(/\D/g, "")
}

/** "xx-xxxxxxxx-x" si tiene 11 dígitos; si no, el texto tal cual (no se pierde lo cargado). */
export function formatCuit(v: string | number | null | undefined): string {
  const d = cuitDigitos(v)
  if (d.length === 11) return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`
  return String(v ?? "").trim()
}

/** Dígito verificador correcto (módulo 11). */
export function cuitValido(v: string | number | null | undefined): boolean {
  const d = cuitDigitos(v)
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const suma = pesos.reduce((s, p, i) => s + p * Number(d[i]), 0)
  const resto = suma % 11
  // resto 0 → 0; resto 1 → 9 (variante de ARCA para CUIT/CUIL con prefijo 23/33); si no, 11 − resto
  const dv = resto === 0 ? 0 : resto === 1 ? 9 : 11 - resto
  return dv === Number(d[10])
}

/** Mensaje de error para mostrar al cargar un CUIT, o null si está bien (vacío = sin error). */
export function errorCuit(v: string | number | null | undefined): string | null {
  const d = cuitDigitos(v)
  if (d.length === 0 || esSinCuit(d)) return null
  if (d.length !== 11) return `El CUIT tiene que tener 11 dígitos (tiene ${d.length})`
  if (!cuitValido(d)) return "El CUIT no es válido: revisá los números (el último dígito no coincide)"
  return null
}

/** "00-00000000-0" (todo ceros) se usó como "no tiene CUIT" (consumidor final, empleados). */
export function esSinCuit(v: string | number | null | undefined): boolean {
  return /^0+$/.test(cuitDigitos(v))
}

/**
 * Forma de guardar un CUIT: "xx-xxxxxxxx-x"; null si está vacío, es la máscara
 * sin completar ("__-________-_") o es todo ceros (= sin CUIT). Si no tiene 11
 * dígitos devuelve el texto tal cual: quien guarda debe validar antes con errorCuit().
 */
export function normalizarCuit(v: string | number | null | undefined): string | null {
  const d = cuitDigitos(v)
  if (d.length === 0 || esSinCuit(d)) return null
  return formatCuit(d.length === 11 ? d : String(v).trim())
}

/** Mismo CUIT sin importar cómo se escribió. */
export function mismoCuit(a: string | number | null | undefined, b: string | number | null | undefined): boolean {
  const x = cuitDigitos(a), y = cuitDigitos(b)
  return x.length > 0 && x === y
}
