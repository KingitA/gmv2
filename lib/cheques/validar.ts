// Validación de los datos que devuelve el OCR de un cheque / transferencia.
// Todo lo que no cierra (CUIT sin dígito verificador, fecha fuera de rango,
// monto absurdo) se descarta: mejor un campo vacío que uno inventado.

export interface DatosCheque {
  monto: number
  banco: string
  numero_cheque: string
  /** Fecha de pago / vencimiento (YYYY-MM-DD) */
  fecha_cheque: string
  fecha_emision: string
  /** XX-XXXXXXXX-X */
  cuit_emisor: string
  es_echeq: boolean
}

export type CampoCheque = keyof DatosCheque

export const CAMPOS_CHEQUE: CampoCheque[] = ["monto", "banco", "numero_cheque", "fecha_cheque", "fecha_emision", "cuit_emisor", "es_echeq"]

/** Solo los campos que VALIDARON; el resto no está. */
export interface ChequeSaneado extends Partial<DatosCheque> {
  /** CUITs válidos impresos en el cheque (cuentas conjuntas), el emisor primero. */
  cuits_titulares: string[]
}

export interface TransferenciaSaneada {
  monto?: number
  numero_comprobante?: string
  fecha_transferencia?: string
  cuenta_bancaria_id?: string
  banco_nombre?: string
}

// ─── CUIT ────────────────────────────────────────────────────────────────────

/** CUIT/CUIL argentino: 11 dígitos y dígito verificador (módulo 11). */
export function cuitValido(v: string | number | null | undefined): boolean {
  const d = String(v ?? "").replace(/\D/g, "")
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const suma = pesos.reduce((s, p, i) => s + p * Number(d[i]), 0)
  const resto = suma % 11
  const dv = resto === 0 ? 0 : resto === 1 ? 9 : 11 - resto
  return dv === Number(d[10])
}

/** "20123456789" | "20-12345678-9" | " 20 12345678 9 " → "20-12345678-9"; inválido → null. */
export function normalizarCuit(v: string | number | null | undefined): string | null {
  if (!cuitValido(v)) return null
  const d = String(v).replace(/\D/g, "")
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`
}

/** Un CUIT ya se puede consultar: 11 dígitos válidos (no a medio tipear). */
export const cuitConsultable = (v: string | null | undefined) => cuitValido(v)

// ─── Fechas ──────────────────────────────────────────────────────────────────

const DIA_MS = 86_400_000

function fechaLocalISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

/** Parsea YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, DD/MM/YY. Fecha inexistente (31/02) → null. */
export function parsearFecha(v: string | null | undefined): string | null {
  const s = String(v ?? "").trim()
  if (!s) return null
  let y: number, m: number, d: number
  let mt = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/)
  if (mt) {
    y = Number(mt[1]); m = Number(mt[2]); d = Number(mt[3])
  } else {
    mt = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/)
    if (!mt) return null
    d = Number(mt[1]); m = Number(mt[2]); y = Number(mt[3])
    if (mt[3]!.length === 2) y += 2000
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const f = new Date(y, m - 1, d)
  if (f.getFullYear() !== y || f.getMonth() !== m - 1 || f.getDate() !== d) return null
  return fechaLocalISO(f)
}

/**
 * Fecha válida y dentro de un rango razonable alrededor de HOY (en días).
 * Un cheque de pago diferido vence hasta 360 días después de emitido; una
 * fecha de 1999 o 2099 es un error de lectura, no un cheque.
 */
export function normalizarFecha(v: string | null | undefined, opts: { hoy?: string; atrasDias?: number; adelanteDias?: number } = {}): string | null {
  const iso = parsearFecha(v)
  if (!iso) return null
  const hoy = opts.hoy ? parsearFecha(opts.hoy) : fechaLocalISO(new Date())
  if (!hoy) return iso
  const dif = (Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / DIA_MS
  if (dif < -(opts.atrasDias ?? 400) || dif > (opts.adelanteDias ?? 400)) return null
  return iso
}

// ─── Monto / número / banco ──────────────────────────────────────────────────

export const MONTO_MAXIMO = 500_000_000

/** Número o texto ("1.234.567,89" · "1234567.89" · "$ 12.500") → número con 2 decimales, > 0 y < tope; si no, null. */
export function normalizarMonto(v: string | number | null | undefined): number | null {
  let n: number
  if (typeof v === "number") n = v
  else {
    let s = String(v ?? "").replace(/[^\d.,-]/g, "")
    if (!s) return null
    const coma = s.lastIndexOf(",")
    const punto = s.lastIndexOf(".")
    if (coma >= 0 && punto >= 0) {
      // El separador que aparece ÚLTIMO es el decimal
      s = coma > punto ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "")
    } else if (coma >= 0) {
      // Solo comas: una sola con 1-2 dígitos detrás = decimal; si no, miles
      s = /,\d{1,2}$/.test(s) && s.split(",").length === 2 ? s.replace(",", ".") : s.replace(/,/g, "")
    } else if (punto >= 0) {
      s = /\.\d{1,2}$/.test(s) && s.split(".").length === 2 ? s : s.replace(/\./g, "")
    }
    n = Number(s)
  }
  if (!Number.isFinite(n) || n <= 0 || n >= MONTO_MAXIMO) return null
  return Math.round(n * 100) / 100
}

/** Número de cheque: solo dígitos, entre 3 y 14 (cheque papel 8, e-cheq puede ser más largo). */
export function normalizarNumeroCheque(v: string | number | null | undefined): string | null {
  const d = String(v ?? "").replace(/\D/g, "")
  if (d.length < 3 || d.length > 14) return null
  return d
}

/** Nombre de banco: texto con al menos una letra, 2–60 caracteres. */
export function normalizarBanco(v: string | null | undefined): string | null {
  const s = String(v ?? "").replace(/\s+/g, " ").trim()
  if (s.length < 2 || s.length > 60 || !/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(s)) return null
  if (/^(null|undefined|n\/?a|no visible|desconocido)$/i.test(s)) return null
  return s
}

// ─── Saneado de un resultado del OCR ─────────────────────────────────────────

/** Lo que devuelve Gemini para un cheque (forma libre: se valida campo por campo). */
export interface ChequeCrudo {
  monto?: unknown
  banco_emisor?: unknown
  numero_cheque?: unknown
  fecha_cheque?: unknown
  fecha_emision?: unknown
  cuit_emisor?: unknown
  cuits_titulares?: unknown
  color_cheque?: unknown
  es_echeq?: unknown
}

/**
 * Cheque validado campo por campo. `hoy` (YYYY-MM-DD) fija el rango de fechas
 * (tests). Un CUIT solo entra si cierra el módulo 11; los titulares son los CUITs
 * válidos que el modelo dice haber LEÍDO en el cheque (sin rescates por regex
 * sobre el texto: ahí es donde aparecían números de cheque disfrazados de CUIT).
 */
export function sanearCheque(r: ChequeCrudo, opts: { hoy?: string } = {}): ChequeSaneado {
  const out: ChequeSaneado = { cuits_titulares: [] }
  const monto = normalizarMonto(r.monto as any)
  if (monto !== null) out.monto = monto
  const banco = normalizarBanco(r.banco_emisor as any)
  if (banco) out.banco = banco
  const numero = normalizarNumeroCheque(r.numero_cheque as any)
  if (numero) out.numero_cheque = numero
  const venc = normalizarFecha(r.fecha_cheque as any, { hoy: opts.hoy })
  if (venc) out.fecha_cheque = venc
  const emision = normalizarFecha(r.fecha_emision as any, { hoy: opts.hoy, adelanteDias: 7 })
  if (emision) out.fecha_emision = emision
  const cuit = normalizarCuit(r.cuit_emisor as any)
  if (cuit) out.cuit_emisor = cuit
  const titulares = Array.isArray(r.cuits_titulares) ? r.cuits_titulares : []
  out.cuits_titulares = [...new Set([cuit, ...titulares.map((c) => normalizarCuit(c as any))].filter((c): c is string => !!c))].slice(0, 4)
  if (!out.cuit_emisor && out.cuits_titulares.length) out.cuit_emisor = out.cuits_titulares[0]
  if (String(r.color_cheque ?? "").toUpperCase() === "ECHEQ" || r.es_echeq === true) out.es_echeq = true
  return out
}

export interface TransferenciaCruda {
  monto?: unknown
  numero_comprobante?: unknown
  fecha_transferencia?: unknown
  cuenta_bancaria_id?: unknown
  banco_nombre?: unknown
}

export function sanearTransferencia(r: TransferenciaCruda, opts: { hoy?: string } = {}): TransferenciaSaneada {
  const out: TransferenciaSaneada = {}
  const monto = normalizarMonto(r.monto as any)
  if (monto !== null) out.monto = monto
  const nro = String(r.numero_comprobante ?? "").trim()
  if (nro && nro.length <= 40 && !/^(null|undefined)$/i.test(nro)) out.numero_comprobante = nro
  const f = normalizarFecha(r.fecha_transferencia as any, { hoy: opts.hoy, adelanteDias: 7 })
  if (f) out.fecha_transferencia = f
  if (typeof r.cuenta_bancaria_id === "string" && r.cuenta_bancaria_id) out.cuenta_bancaria_id = r.cuenta_bancaria_id
  if (typeof r.banco_nombre === "string" && r.banco_nombre) out.banco_nombre = r.banco_nombre
  return out
}

/** Un resultado del OCR ya saneado (lo que viaja al cliente). */
export type ResultadoOcr =
  | ({ tipo: "cheque" } & ChequeSaneado)
  | ({ tipo: "transferencia" } & TransferenciaSaneada)

/** ¿Trae algún dato útil? (una foto de la que no salió nada no debe crear filas fantasma) */
export function resultadoConDatos(r: ResultadoOcr): boolean {
  const { tipo: _t, ...resto } = r as unknown as Record<string, unknown>
  return Object.entries(resto).some(([k, v]) => (k === "cuits_titulares" ? Array.isArray(v) && v.length > 0 : v !== undefined && v !== "" && v !== false && v !== null))
}
