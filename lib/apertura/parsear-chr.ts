/**
 * Lector del reporte "Comprobantes Impagos de Clientes" del sistema viejo
 * (D&J Software, archivo .chr: CSV con comillas, codificación Windows-1252,
 * fechas dd/mm/aaaa y decimales con punto). Cada renglón trae el encabezado
 * del reporte repetido y, desde la columna 20, un comprobante pendiente:
 *
 *   20 cliente · 21 nombre · 22 CUIT · 23 teléfono · 24 número · 25 descripción
 *   (tipo + días) · 26 fecha · 27 vencimiento · 28 importe · 29 pendiente ·
 *   30 saldo del cliente · 31 saldo del cliente · 32 total general · 33 pie
 *   11 "Viajante: 00022 - FREIJE DANIEL (lista NECO)"
 *
 * Módulo PURO (sin base de datos): lo usan la pantalla de apertura y los tests.
 */

export type TipoApertura =
  | "PRES" | "FA" | "FB" | "FC" | "NDA" | "NDB" | "NDC"   // débitos
  | "NCA" | "NCB" | "NCC" | "REV"                           // créditos (comprobantes)
  | "A_CUENTA"                                              // entrega a cuenta (pago)

export interface RenglonApertura {
  linea: number
  viajante: string
  codigo_cliente: string          // sin ceros a la izquierda ("00207" → "207")
  nombre: string
  cuit: string
  numero: string                  // "0001-00119733"
  descripcion: string             // "Presupuesto", "Fact.A Electronica", …
  tipo: TipoApertura | null       // null = tipo que no se reconoce
  fecha: string                   // ISO aaaa-mm-dd
  vencimiento: string             // ISO
  importe: number
  pendiente: number
  saldo_cliente: number           // saldo del cliente según el sistema viejo
}

export interface ResultadoLectura {
  fecha_reporte: string | null
  renglones: RenglonApertura[]
  errores: string[]
}

export const ES_DEBITO = new Set<TipoApertura>(["PRES", "FA", "FB", "FC", "NDA", "NDB", "NDC"])

/** Descripción del sistema viejo → tipo de gmv2 */
export function tipoDeDescripcion(desc: string): TipoApertura | null {
  const d = desc.toUpperCase().replace(/\s+/g, " ").trim()
  if (d.startsWith("PRESUPUESTO")) return "PRES"
  if (d.startsWith("REVERSA")) return "REV"
  if (d.startsWith("A CUENTA")) return "A_CUENTA"
  const letra = (re: RegExp) => (d.match(re)?.[1] || "") as "A" | "B" | "C" | ""
  if (/^FACT/.test(d)) { const l = letra(/^FACT\.?\s*([ABC])/); return l ? (`F${l}` as TipoApertura) : null }
  if (/^N\.?\s*CR/.test(d)) { const l = letra(/^N\.?\s*CR\.?\s*([ABC])/); return l ? (`NC${l}` as TipoApertura) : null }
  if (/^N\.?\s*D[EÉ]?B/.test(d)) { const l = letra(/^N\.?\s*D[EÉ]?B\.?\s*([ABC])/); return l ? (`ND${l}` as TipoApertura) : null }
  return null
}

/** Separa un renglón CSV con comillas dobles (sin comillas escapadas en el reporte) */
export function separarCsv(linea: string): string[] {
  const out: string[] = []
  let actual = ""
  let enComillas = false
  for (const ch of linea) {
    if (ch === '"') { enComillas = !enComillas; continue }
    if (ch === "," && !enComillas) { out.push(actual); actual = ""; continue }
    actual += ch
  }
  out.push(actual)
  return out.map((s) => s.trim())
}

const fechaIso = (v: string): string => {
  const m = v.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ""
}
const numero = (v: string): number => {
  const n = Number(v.trim())
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN
}
const codigo = (v: string): string => String(v.trim()).replace(/^0+(?=\d)/, "")

/** Lee el contenido YA decodificado (texto) del .chr */
export function leerReporteImpagos(texto: string): ResultadoLectura {
  const errores: string[] = []
  const renglones: RenglonApertura[] = []
  let fechaReporte: string | null = null
  const lineas = texto.split(/\r?\n/)
  lineas.forEach((raw, i) => {
    if (!raw.trim()) return
    const c = separarCsv(raw)
    if (c.length < 31) {
      errores.push(`Renglón ${i + 1}: tiene ${c.length} columnas (se esperaban al menos 31)`)
      return
    }
    if (!fechaReporte) fechaReporte = fechaIso(c[6]) || null
    const descripcion = c[25].replace(/\s+\d+$/, "").trim()
    const r: RenglonApertura = {
      linea: i + 1,
      viajante: c[11].replace(/^Viajante:\s*/i, "").trim(),
      codigo_cliente: codigo(c[20]),
      nombre: c[21],
      cuit: c[22],
      numero: c[24],
      descripcion,
      tipo: tipoDeDescripcion(descripcion),
      fecha: fechaIso(c[26]),
      vencimiento: fechaIso(c[27]) || fechaIso(c[26]),
      importe: numero(c[28]),
      pendiente: numero(c[29]),
      saldo_cliente: numero(c[30]),
    }
    if (!r.codigo_cliente) errores.push(`Renglón ${i + 1}: sin número de cliente`)
    if (!r.fecha) errores.push(`Renglón ${i + 1}: fecha inválida "${c[26]}"`)
    if (!Number.isFinite(r.pendiente) || !Number.isFinite(r.importe)) errores.push(`Renglón ${i + 1}: importe inválido`)
    if (!r.tipo) errores.push(`Renglón ${i + 1} (${r.nombre} ${r.numero}): tipo de comprobante desconocido "${descripcion}"`)
    renglones.push(r)
  })
  return { fecha_reporte: fechaReporte, renglones, errores }
}

export interface ClienteApertura {
  codigo_cliente: string
  nombre: string
  viajante: string
  renglones: RenglonApertura[]
  /** Σ pendiente de sus renglones (débitos +, créditos −) */
  suma: number
  /** Saldo que informa el sistema viejo */
  saldo_reporte: number
  cuadra: boolean
}

/** Agrupa por cliente y controla que la suma de lo pendiente dé el saldo del reporte */
export function agruparPorCliente(renglones: RenglonApertura[]): ClienteApertura[] {
  const m = new Map<string, ClienteApertura>()
  for (const r of renglones) {
    const c = m.get(r.codigo_cliente) || {
      codigo_cliente: r.codigo_cliente, nombre: r.nombre, viajante: r.viajante,
      renglones: [], suma: 0, saldo_reporte: r.saldo_cliente, cuadra: false,
    }
    c.renglones.push(r)
    c.suma = Math.round((c.suma + r.pendiente) * 100) / 100
    m.set(r.codigo_cliente, c)
  }
  for (const c of m.values()) c.cuadra = Math.abs(c.suma - c.saldo_reporte) < 0.01
  return [...m.values()].sort((a, b) => Number(a.codigo_cliente) - Number(b.codigo_cliente))
}
