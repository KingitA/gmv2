/**
 * Importador del Excel "proveedores-para-completar.xlsx" (Tanda 1-A de la prueba de entrada).
 *
 * Archivo PURO (sin base ni red): lo usan la ruta `/api/proveedores/importar-datos`
 * (que valida y calcula SIEMPRE en el servidor) y el test `scripts/test-importar-proveedores.mjs`.
 *
 * Reglas del dueño:
 *  · Lo que viene vacío NO se modifica (una celda vacía nunca borra un dato).
 *  · El código es la clave; el nombre no se toca (si no se parece, aviso).
 *  · Una fila con algún error no se importa; el resto sí.
 *  · Código que no existe = error (no crea proveedores). Código repetido = error en las dos filas.
 *
 * Las columnas nuevas las agrega la migración 20261117m_proveedores_datos_compra.sql.
 */
import { errorCuit, fecha, formatCuit, mismoCuit, normalizarCuit, parseFecha, parseMonto } from "@/lib/formato"
import { normalizarCodigo } from "@/lib/codigos"
import { ENTREGAS_PAGO, MEDIOS_PAGO, normalizarCuotas } from "@/lib/compras/acuerdo-pago"
import type { DesdePago, EntregaPago, MedioPago } from "@/lib/compras/acuerdo-pago"

// ─── Columnas del Excel ──────────────────────────────────────────────────────

/** Claves de la fila cruda (una por columna del Excel). */
export const CLAVES_EXCEL = [
  "codigo", "nombre", "cuit", "tipo", "mail_oc", "mail_admin", "telefono_vendedor",
  "banco", "cbu", "alias", "titular",
  "blanco_medio", "blanco_dias", "blanco_desde", "blanco_plazo_cheque", "blanco_entrega",
  "negro_medio", "negro_dias", "negro_desde", "negro_plazo_cheque", "negro_entrega",
  "acepta_cheques_terceros", "acepta_echeq", "ganancias", "exento_hasta",
  "transporte_habitual", "dias_entrega", "observaciones", "mixto_pct",
  "tipo_descuento", "percepcion_iva", "percepcion_iibb",
] as const
export type ClaveExcel = (typeof CLAVES_EXCEL)[number]

/** Nombre corto de cada columna, para decir "en qué columna" está el error. */
export const NOMBRE_COLUMNA: Record<ClaveExcel, string> = {
  codigo: "Código",
  nombre: "Proveedor",
  cuit: "CUIT",
  tipo: "Tipo",
  mail_oc: "Mail para enviar la orden de compra",
  mail_admin: "Mail de administración / cobranzas",
  telefono_vendedor: "Teléfono del vendedor",
  banco: "Banco del proveedor",
  cbu: "CBU",
  alias: "Alias",
  titular: "Titular de la cuenta",
  blanco_medio: "BLANCO: medio de pago",
  blanco_dias: "BLANCO: días de plazo",
  blanco_desde: "BLANCO: desde",
  blanco_plazo_cheque: "BLANCO: plazo máx. del cheque",
  blanco_entrega: "BLANCO: cómo se entrega",
  negro_medio: "NEGRO: medio de pago",
  negro_dias: "NEGRO: días de plazo",
  negro_desde: "NEGRO: desde",
  negro_plazo_cheque: "NEGRO: plazo máx. del cheque",
  negro_entrega: "NEGRO: cómo se entrega",
  acepta_cheques_terceros: "Acepta cheques de terceros",
  acepta_echeq: "Acepta e-cheq",
  ganancias: "Retención Ganancias",
  exento_hasta: "Exento: vence certificado",
  transporte_habitual: "Transporte habitual",
  dias_entrega: "Días que tarda en entregar",
  observaciones: "Observaciones",
  mixto_pct: "Mixto: % con factura",
  tipo_descuento: "Descuentos: cómo se aplican",
  percepcion_iva: "Percepción IVA %",
  percepcion_iibb: "Percepción IIBB %",
}

/** Fila del Excel tal cual se leyó: texto por clave + número de fila de Excel (la 1 es el encabezado). */
export type FilaCruda = { fila: number } & Partial<Record<ClaveExcel, string>>

/** Sin acentos, minúsculas, lo que no es letra o número → "_". "E-cheq " → "e_cheq". */
function clave(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

/** Encabezado → clave. Tolera que cambie (o falte) el texto entre paréntesis. null = columna desconocida. */
export function claveDeEncabezado(encabezado: unknown): ClaveExcel | null {
  const sinParentesis = String(encabezado ?? "").replace(/\([^)]*\)?/g, " ")
  const n = clave(sinParentesis)
  if (!n) return null
  const tiene = (...xs: string[]) => xs.some((x) => n.includes(x))
  const canal = n.startsWith("blanco") ? "blanco" : n.startsWith("negro") ? "negro" : null
  if (canal) {
    if (tiene("medio")) return `${canal}_medio`
    if (tiene("cheque")) return `${canal}_plazo_cheque`
    if (tiene("entrega")) return `${canal}_entrega`
    if (tiene("desde")) return `${canal}_desde`
    if (tiene("dias", "plazo")) return `${canal}_dias`
    return null
  }
  // "Mixto: % con factura" (columna opcional, Juan 17/11: la proporción varía según el proveedor)
  if (n.startsWith("mixto")) return "mixto_pct"
  // columnas de la plantilla nueva (17/11): van antes de "tipo…" para que "Tipo de descuento" no se lea como Tipo
  if (tiene("descuento")) return "tipo_descuento"
  if (tiene("percepcion")) return tiene("iibb", "ingresos", "brutos") ? "percepcion_iibb" : "percepcion_iva"
  if (n.startsWith("codigo") || n === "cod") return "codigo"
  if (n === "proveedor" || n === "nombre" || n === "razon_social") return "nombre"
  if (tiene("cuit")) return "cuit"
  if (n.startsWith("tipo")) return "tipo"
  if (tiene("mail", "correo")) {
    if (tiene("orden", "compra")) return "mail_oc"
    if (tiene("administracion", "cobranza", "oficina")) return "mail_admin"
    return null
  }
  if (tiene("telefono")) return "telefono_vendedor"
  if (n === "cbu" || n === "cbu_cvu" || n === "cvu") return "cbu"
  if (n.startsWith("alias")) return "alias"
  if (n.startsWith("titular")) return "titular"
  if (n.startsWith("banco")) return "banco"
  if (tiene("acepta")) {
    if (tiene("tercero")) return "acepta_cheques_terceros"
    if (n.replace(/_/g, "").includes("echeq")) return "acepta_echeq"
    return null
  }
  if (tiene("ganancias")) return "ganancias"
  if (tiene("exento", "certificado")) return "exento_hasta"
  if (n.startsWith("transporte")) return "transporte_habitual"
  if (tiene("dias") && tiene("entrega", "tarda")) return "dias_entrega"
  if (n.startsWith("observacion")) return "observaciones"
  return null
}

export interface LecturaExcel {
  filas: FilaCruda[]
  /** Error que impide seguir (por ejemplo, falta la columna Código). */
  error: string | null
  /** Encabezados del Excel que no se reconocieron (se ignoran). */
  columnasDesconocidas: string[]
  /** Columnas esperadas que el Excel no trae (no se tocan). */
  columnasFaltantes: string[]
}

/**
 * Matriz de la hoja (fila 1 = encabezados; leída con `raw: false, defval: ""`) → filas crudas.
 * Las columnas se reconocen por encabezado, no por posición. Las filas totalmente vacías se saltean.
 */
export function leerFilasExcel(matriz: unknown[][]): LecturaExcel {
  const vacio: LecturaExcel = { filas: [], error: null, columnasDesconocidas: [], columnasFaltantes: [] }
  if (!Array.isArray(matriz) || matriz.length === 0) return { ...vacio, error: "El archivo está vacío." }
  const encabezados = Array.isArray(matriz[0]) ? matriz[0] : []
  const columnaDe = new Map<ClaveExcel, number>()
  const desconocidas: string[] = []
  const repetidas: string[] = []
  encabezados.forEach((h, i) => {
    const texto = String(h ?? "").trim()
    if (!texto) return
    const k = claveDeEncabezado(texto)
    if (!k) { desconocidas.push(texto); return }
    if (columnaDe.has(k)) { repetidas.push(NOMBRE_COLUMNA[k]); return }
    columnaDe.set(k, i)
  })
  if (!columnaDe.has("codigo")) {
    return { ...vacio, columnasDesconocidas: desconocidas, error: 'No encontré la columna "Código" en la primera fila. Usá el Excel "proveedores-para-completar" sin cambiarle los encabezados.' }
  }
  if (repetidas.length > 0) {
    return { ...vacio, columnasDesconocidas: desconocidas, error: `Hay columnas repetidas en el Excel: ${[...new Set(repetidas)].join(", ")}. Dejá una sola de cada una.` }
  }
  const filas: FilaCruda[] = []
  for (let r = 1; r < matriz.length; r++) {
    const celdas = Array.isArray(matriz[r]) ? matriz[r] : []
    const cruda: FilaCruda = { fila: r + 1 }
    let hayAlgo = false
    for (const [k, i] of columnaDe) {
      const texto = String(celdas[i] ?? "").trim()
      if (!texto) continue
      cruda[k] = texto
      hayAlgo = true
    }
    if (hayAlgo) filas.push(cruda)
  }
  return {
    filas,
    error: filas.length === 0 ? "El Excel no tiene ninguna fila con datos." : null,
    columnasDesconocidas: desconocidas,
    // Informativo, no es error: sirve la plantilla vieja. Lo que el archivo no trae, no se modifica.
    columnasFaltantes: CLAVES_EXCEL.filter((k) => k !== "nombre" && !columnaDe.has(k)).map((k) => NOMBRE_COLUMNA[k]),
  }
}

/** Deja de lo que llega por la red solo lo esperado: claves conocidas, texto, largo acotado. */
export function limpiarFilaCruda(x: unknown, orden: number): FilaCruda {
  const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {}
  const n = Number(o.fila)
  const cruda: FilaCruda = { fila: Number.isInteger(n) && n > 0 && n < 1_000_000 ? n : orden + 2 }
  for (const k of CLAVES_EXCEL) {
    const v = o[k]
    if (typeof v !== "string" && typeof v !== "number") continue
    const texto = String(v).trim().slice(0, 2000)
    if (texto) cruda[k] = texto
  }
  return cruda
}

// ─── Columnas de `proveedores` ───────────────────────────────────────────────

/** Lo que el Excel puede escribir en `proveedores` (clave = nombre de la columna). */
export interface ValoresProveedor {
  cuit?: string
  tipo_proveedor?: "mercaderia_general" | "transporte" | "servicios"
  mail_ordenes_compra?: string
  mail_oficina?: string
  telefono_vendedor?: string
  banco_nombre?: string
  cbu?: string
  cbu_alias?: string
  banco_titular?: string
  pago_blanco_medio?: MedioPago
  pago_blanco_dias?: number
  pago_blanco_cuotas?: string | null
  pago_blanco_desde?: DesdePago
  pago_blanco_plazo_cheque?: number
  pago_blanco_entrega?: EntregaPago
  pago_negro_medio?: MedioPago
  pago_negro_dias?: number
  pago_negro_cuotas?: string | null
  pago_negro_desde?: DesdePago
  pago_negro_plazo_cheque?: number
  pago_negro_entrega?: EntregaPago
  acepta_cheques_terceros?: boolean
  acepta_echeq?: boolean
  regimen_ganancias?: "bienes" | "transporte"
  condicion_ganancias?: "inscripto" | "exento"
  ganancias_exento_hasta?: string
  transporte_habitual?: string
  dias_entrega?: number
  observaciones_compra?: string
  mixto_pct_factura?: number
  tipo_descuento?: "cascada" | "sobre_lista"
  percepcion_iva?: number
  percepcion_iibb?: number
}
export type CampoProveedor = keyof ValoresProveedor

/** Etiqueta de cada campo para la vista previa (en el orden en que se muestran). */
export const ETIQUETA_CAMPO: Record<CampoProveedor, string> = {
  cuit: "CUIT",
  tipo_proveedor: "Tipo",
  mail_ordenes_compra: "Mail para la orden de compra",
  mail_oficina: "Mail de administración",
  telefono_vendedor: "Teléfono del vendedor",
  banco_nombre: "Banco",
  cbu: "CBU",
  cbu_alias: "Alias",
  banco_titular: "Titular de la cuenta",
  pago_blanco_medio: "Blanco: medio de pago",
  pago_blanco_dias: "Blanco: días de plazo",
  pago_blanco_cuotas: "Blanco: cuotas",
  pago_blanco_desde: "Blanco: plazo desde",
  pago_blanco_plazo_cheque: "Blanco: plazo máx. del cheque",
  pago_blanco_entrega: "Blanco: cómo se entrega",
  pago_negro_medio: "Negro: medio de pago",
  pago_negro_dias: "Negro: días de plazo",
  pago_negro_cuotas: "Negro: cuotas",
  pago_negro_desde: "Negro: plazo desde",
  pago_negro_plazo_cheque: "Negro: plazo máx. del cheque",
  pago_negro_entrega: "Negro: cómo se entrega",
  acepta_cheques_terceros: "Acepta cheques de terceros",
  acepta_echeq: "Acepta e-cheq",
  regimen_ganancias: "Ganancias: régimen",
  condicion_ganancias: "Ganancias: condición",
  ganancias_exento_hasta: "Exento: vence el certificado",
  transporte_habitual: "Transporte habitual",
  dias_entrega: "Días que tarda en entregar",
  observaciones_compra: "Observaciones",
  mixto_pct_factura: "Mixto: % con factura",
  tipo_descuento: "Descuentos: cómo se aplican",
  percepcion_iva: "Percepción IVA %",
  percepcion_iibb: "Percepción IIBB %",
}
export const CAMPOS_IMPORTABLES = Object.keys(ETIQUETA_CAMPO) as CampoProveedor[]

/** Columnas de `proveedores` que hay que leer para comparar (las importables + identificación). */
export const COLUMNAS_PROVEEDOR: string[] = ["id", "codigo_proveedor", "nombre", "activo", ...CAMPOS_IMPORTABLES]

/** Fila de `proveedores` con (al menos) las columnas de COLUMNAS_PROVEEDOR. */
export type ProveedorActual = { id: string; codigo_proveedor?: string | null; nombre?: string | null; activo?: boolean | null } & Record<string, unknown>

// ─── Validación de una fila ──────────────────────────────────────────────────

export interface ErrorFila {
  columna: string
  mensaje: string
  /** Columna de la base y texto del Excel: si el sistema YA tiene ese mismo valor, el error baja a aviso (no es un cambio). */
  campo?: CampoProveedor
  crudo?: string
}
export interface FilaValidada {
  /** Código normalizado (null si falta). */
  codigo: string | null
  nombreExcel: string | null
  valores: ValoresProveedor
  errores: ErrorFila[]
  avisos: string[]
}

const RE_MAIL = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>().]{2,}$/
const RE_ALIAS = /^[A-Za-z0-9.-]{6,20}$/

const MEDIO_POR_TEXTO: Record<string, MedioPago> = {
  transferencia: "transferencia", transferencias: "transferencia",
  cheque: "cheques", cheques: "cheques",
  efectivo: "efectivo",
  cheques_y_efectivo: "cheques_y_efectivo", cheque_y_efectivo: "cheques_y_efectivo", efectivo_y_cheques: "cheques_y_efectivo", efectivo_y_cheque: "cheques_y_efectivo",
  echeq: "echeq", e_cheq: "echeq", echeqs: "echeq", e_cheqs: "echeq", echeque: "echeq", e_cheque: "echeq",
}
const ENTREGA_POR_TEXTO: Record<string, EntregaPago> = {
  transferencia: "transferencia",
  deposito_bancario: "deposito_bancario", deposito: "deposito_bancario",
  retira_oficina: "retira_oficina", retira_en_oficina: "retira_oficina", retira: "retira_oficina",
  envio_grimar: "envio_grimar", envio: "envio_grimar",
}
const TIPO_POR_TEXTO: Record<string, NonNullable<ValoresProveedor["tipo_proveedor"]>> = {
  mercaderia: "mercaderia_general", mercaderias: "mercaderia_general", mercaderia_general: "mercaderia_general",
  transporte: "transporte", transportes: "transporte",
  servicios: "servicios", servicio: "servicios",
}
const SI = new Set(["si", "s", "x", "1", "true", "verdadero"])
const NO = new Set(["no", "n", "0", "false", "falso"])

/** "30", "30 días" → 30. Cualquier otra cosa (decimales, negativos, texto) → null. */
function enteroDe(texto: string): number | null {
  const s = texto.trim().toLowerCase().replace(/\s*(dias|días|dia|día|d)\.?$/, "").trim()
  if (!/^\d{1,4}$/.test(s)) return null
  return Number(s)
}

const textoLimpio = (s: string) => s.replace(/\s+/g, " ").trim()

/**
 * Valida una fila cruda y arma lo que habría que guardar. No mira la base.
 * Lo vacío no aparece en `valores` (no se modifica).
 */
export function validarFila(cruda: FilaCruda): FilaValidada {
  const valores: ValoresProveedor = {}
  const errores: ErrorFila[] = []
  const avisos: string[] = []
  const error = (k: ClaveExcel, mensaje: string) => errores.push({ columna: NOMBRE_COLUMNA[k], mensaje })
  const dato = (k: ClaveExcel): string => String(cruda?.[k] ?? "").trim()

  const codigo = normalizarCodigo(dato("codigo"))
  if (!codigo) error("codigo", "falta el código del proveedor")

  // CUIT
  if (dato("cuit")) {
    const e = errorCuit(dato("cuit"))
    const n = e ? null : normalizarCuit(dato("cuit"))
    if (e) errores.push({ columna: NOMBRE_COLUMNA.cuit, mensaje: `${e} ("${dato("cuit")}")`, campo: "cuit", crudo: dato("cuit") })
    else if (n) valores.cuit = n
    // "00-00000000-0" = sin CUIT: es como dejarlo vacío, no borra el que tenga
  }

  // Tipo
  if (dato("tipo")) {
    const t = TIPO_POR_TEXTO[clave(dato("tipo"))]
    if (t) valores.tipo_proveedor = t
    else error("tipo", `"${dato("tipo")}" no es un tipo: poné mercaderia, transporte o servicios`)
  }

  // Mails
  if (dato("mail_oc")) {
    const partes = dato("mail_oc").split(/[;,]/).map((m) => m.trim().toLowerCase()).filter(Boolean)
    const malos = partes.filter((m) => !RE_MAIL.test(m))
    if (partes.length === 0 || malos.length > 0) error("mail_oc", `no es un mail válido: "${malos.join('", "') || dato("mail_oc")}" (si son varios, separalos con coma)`)
    else valores.mail_ordenes_compra = [...new Set(partes)].join(", ")
  }
  if (dato("mail_admin")) {
    const m = dato("mail_admin").toLowerCase()
    if (/[;,]/.test(m)) error("mail_admin", "va un solo mail (sin comas)")
    else if (!RE_MAIL.test(m)) errores.push({ columna: NOMBRE_COLUMNA.mail_admin, mensaje: `no es un mail válido: "${dato("mail_admin")}"`, campo: "mail_oficina", crudo: dato("mail_admin") })
    else valores.mail_oficina = m
  }

  // Textos libres
  const texto = (k: ClaveExcel, campo: "telefono_vendedor" | "banco_nombre" | "banco_titular" | "transporte_habitual" | "observaciones_compra", max: number) => {
    if (!dato(k)) return
    const t = textoLimpio(dato(k))
    if (t.length > max) error(k, `es muy largo (${t.length} caracteres; el máximo es ${max})`)
    else valores[campo] = t
  }
  texto("telefono_vendedor", "telefono_vendedor", 100)
  texto("banco", "banco_nombre", 100)
  texto("titular", "banco_titular", 150)
  texto("transporte_habitual", "transporte_habitual", 150)
  texto("observaciones", "observaciones_compra", 1000)

  // CBU: 22 dígitos (se le sacan espacios y guiones)
  if (dato("cbu")) {
    const d = dato("cbu").replace(/^'/, "").replace(/[\s\-.]/g, "")
    if (/^\d{22}$/.test(d)) valores.cbu = d
    else error("cbu", `el CBU tiene que tener 22 dígitos: poné la celda como texto ("${dato("cbu")}")`)
  }
  // Alias
  if (dato("alias")) {
    const a = dato("alias").replace(/\s+/g, "")
    if (RE_ALIAS.test(a)) valores.cbu_alias = a
    else error("alias", `el alias lleva de 6 a 20 caracteres: letras, números, punto y guion ("${dato("alias")}")`)
  }

  // Acuerdo de pago por canal
  for (const canal of ["blanco", "negro"] as const) {
    const kMedio = `${canal}_medio` as const, kDias = `${canal}_dias` as const, kDesde = `${canal}_desde` as const
    const kCheque = `${canal}_plazo_cheque` as const, kEntrega = `${canal}_entrega` as const
    if (dato(kMedio)) {
      const m = MEDIO_POR_TEXTO[clave(dato(kMedio))]
      if (m) valores[`pago_${canal}_medio`] = m
      else error(kMedio, `"${dato(kMedio)}" no es un medio de pago: poné ${MEDIOS_PAGO.map((x) => x.valor).join(", ")}`)
    }
    if (dato(kDias)) {
      const crudo = dato(kDias)
      const n = clave(crudo) === "contado" ? 0 : enteroDe(crudo)
      const cuotas = n === null ? normalizarCuotas(crudo) : null
      if (n !== null) {
        if (n > 365) error(kDias, `los días de plazo van de 0 a 365 ("${crudo}")`)
        else { valores[`pago_${canal}_dias`] = n; valores[`pago_${canal}_cuotas`] = null }
      } else if (cuotas) {
        const lista = cuotas.split("/").map(Number)
        if (lista.some((d) => d > 365)) error(kDias, `cada cuota va de 0 a 365 días ("${crudo}")`)
        else if (lista.some((d, i) => i > 0 && d <= lista[i - 1])) error(kDias, `las cuotas van de menor a mayor, por ejemplo 30/60/90 ("${crudo}")`)
        else { valores[`pago_${canal}_cuotas`] = cuotas; valores[`pago_${canal}_dias`] = lista[0] }
      } else {
        error(kDias, `"${crudo}" no es un plazo: poné un número de días (0 = contado) o las cuotas así: 30/60/90`)
      }
    }
    if (dato(kDesde)) {
      const d = clave(dato(kDesde))
      if (d === "factura" || d === "recepcion") valores[`pago_${canal}_desde`] = d
      else error(kDesde, `"${dato(kDesde)}" no vale: poné factura o recepcion`)
    }
    if (dato(kCheque)) {
      const n = enteroDe(dato(kCheque))
      if (n === null || n > 365) error(kCheque, `tiene que ser un número entero de 0 a 365 ("${dato(kCheque)}")`)
      else valores[`pago_${canal}_plazo_cheque`] = n
    }
    if (dato(kEntrega)) {
      const e = ENTREGA_POR_TEXTO[clave(dato(kEntrega))]
      if (e) valores[`pago_${canal}_entrega`] = e
      else error(kEntrega, `"${dato(kEntrega)}" no vale: poné ${ENTREGAS_PAGO.map((x) => x.valor).join(", ")}`)
    }
  }

  // Sí / no
  for (const [k, campo] of [["acepta_cheques_terceros", "acepta_cheques_terceros"], ["acepta_echeq", "acepta_echeq"]] as const) {
    if (!dato(k)) continue
    const v = clave(dato(k))
    if (SI.has(v)) valores[campo] = true
    else if (NO.has(v)) valores[campo] = false
    else error(k, `"${dato(k)}" no vale: poné si o no`)
  }

  // Retención de Ganancias
  if (dato("ganancias")) {
    const g = clave(dato("ganancias"))
    if (g.includes("exento") || g.includes("exenta")) {
      valores.condicion_ganancias = "exento"
    } else if (g.includes("transporte") || g.includes("0_25") || g.includes("025")) {
      valores.regimen_ganancias = "transporte"
      valores.condicion_ganancias = "inscripto"
    } else if (g.includes("mercaderia") || g.includes("bienes") || g.includes("2")) {
      valores.regimen_ganancias = "bienes"
      valores.condicion_ganancias = "inscripto"
    } else {
      error("ganancias", `"${dato("ganancias")}" no vale: poné mercaderia, transporte o exento`)
    }
  }
  if (dato("exento_hasta")) {
    const f = parseFecha(dato("exento_hasta"))
    if (!f) error("exento_hasta", `"${dato("exento_hasta")}" no es una fecha: escribila dd/mm/aaaa`)
    else if (valores.condicion_ganancias === "inscripto") avisos.push(`Tiene fecha de certificado de exención (${fecha(f)}) pero no figura como exento: la fecha no se guarda.`)
    else valores.ganancias_exento_hasta = f
  }

  // Días de entrega
  if (dato("dias_entrega")) {
    const n = enteroDe(dato("dias_entrega"))
    if (n === null || n > 365) error("dias_entrega", `tiene que ser un número entero de 0 a 365 ("${dato("dias_entrega")}")`)
    else valores.dias_entrega = n
  }

  // Artículos mixtos: qué % viene con factura
  if (dato("mixto_pct")) {
    const pct = parseMonto(dato("mixto_pct").replace("%", "").trim())
    if (pct === null || pct < 0 || pct > 100) error("mixto_pct", `tiene que ser un porcentaje de 0 a 100 ("${dato("mixto_pct")}")`)
    else valores.mixto_pct_factura = Math.round(pct * 100) / 100
  }

  // Cómo aplica sus descuentos (Juan, 17/11: en cascada / sobre precio lista)
  if (dato("tipo_descuento")) {
    const t = clave(dato("tipo_descuento"))
    if (t.includes("cascada")) valores.tipo_descuento = "cascada"
    else if (t.includes("lista")) valores.tipo_descuento = "sobre_lista"
    else error("tipo_descuento", `"${dato("tipo_descuento")}" no vale: poné cascada o sobre_lista`)
  }

  // Percepciones que nos cobra en la factura
  for (const [k, campo] of [["percepcion_iva", "percepcion_iva"], ["percepcion_iibb", "percepcion_iibb"]] as const) {
    if (!dato(k)) continue
    const pct = parseMonto(dato(k).replace("%", "").trim())
    if (pct === null || pct < 0 || pct > 100) error(k, `tiene que ser un porcentaje de 0 a 100 ("${dato(k)}")`)
    else valores[campo] = Math.round(pct * 100) / 100
  }

  return { codigo, nombreExcel: dato("nombre") || null, valores, errores, avisos }
}

// ─── Comparación con lo que hay en la base ───────────────────────────────────

export type ValorCampo = string | number | boolean | null
export interface Cambio { campo: CampoProveedor; etiqueta: string; antes: ValorCampo; despues: ValorCampo }

const NUMERICOS = new Set<CampoProveedor>(["pago_blanco_dias", "pago_negro_dias", "pago_blanco_plazo_cheque", "pago_negro_plazo_cheque", "dias_entrega", "mixto_pct_factura", "percepcion_iva", "percepcion_iibb"])
const BOOLEANOS = new Set<CampoProveedor>(["acepta_cheques_terceros", "acepta_echeq"])

/** Valor de la base llevado a algo comparable (texto vacío = null). */
function valorActual(campo: CampoProveedor, p: ProveedorActual | null | undefined): ValorCampo {
  const v = p ? p[campo] : null
  if (v === null || v === undefined) return null
  if (BOOLEANOS.has(campo)) return v === true
  if (NUMERICOS.has(campo)) {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  const s = String(v).trim()
  if (!s) return null
  return campo === "ganancias_exento_hasta" ? s.slice(0, 10) : s
}

function iguales(campo: CampoProveedor, antes: ValorCampo, despues: ValorCampo): boolean {
  if (antes === null || despues === null) return antes === despues
  if (campo === "cuit") return mismoCuit(String(antes), String(despues))
  if (campo === "pago_blanco_cuotas" || campo === "pago_negro_cuotas") return String(antes).replace(/\s+/g, "") === String(despues)
  return antes === despues
}

/**
 * Qué hay que guardar de `valores` para que la comparación con la base salga bien parada:
 *  · "inscripto" (mercaderia / transporte) solo cambia la condición si hoy está exento:
 *    un proveedor "no inscripto" no se toca desde el Excel.
 *  · La fecha del certificado solo se guarda si el proveedor queda exento.
 */
function valoresAplicables(valores: ValoresProveedor, actual: ProveedorActual | null | undefined): ValoresProveedor {
  const v: ValoresProveedor = { ...valores }
  const condicionHoy = valorActual("condicion_ganancias", actual)
  if (v.condicion_ganancias === "inscripto" && condicionHoy === "no_inscripto") delete v.condicion_ganancias
  const quedaExento = (v.condicion_ganancias ?? condicionHoy) === "exento"
  if (v.ganancias_exento_hasta && !quedaExento) delete v.ganancias_exento_hasta
  return v
}

/** Campos que cambian (valor actual → valor nuevo). Lo que no viene en `valores` no se toca. */
export function calcularCambios(valores: ValoresProveedor, proveedorActual: ProveedorActual | null | undefined): Cambio[] {
  const aplicar = valoresAplicables(valores, proveedorActual)
  const cambios: Cambio[] = []
  for (const campo of CAMPOS_IMPORTABLES) {
    if (!(campo in aplicar)) continue
    const despues = aplicar[campo] as ValorCampo | undefined
    if (despues === undefined) continue
    const antes = valorActual(campo, proveedorActual)
    if (iguales(campo, antes, despues)) continue
    cambios.push({ campo, etiqueta: ETIQUETA_CAMPO[campo], antes, despues })
  }
  return cambios
}

const soloLetras = (s: unknown) => clave(s).split("_").filter((t) => t.length >= 3 && !["srl", "sas", "sociedad", "anonima"].includes(t))

/** ¿El nombre del Excel se parece al del sistema? (comparación floja: alcanza una palabra en común) */
export function nombresParecidos(a: unknown, b: unknown): boolean {
  const x = clave(a).replace(/_/g, ""), y = clave(b).replace(/_/g, "")
  if (!x || !y) return true
  if (x === y || x.includes(y) || y.includes(x)) return true
  const ta = soloLetras(a), tb = new Set(soloLetras(b))
  return ta.some((t) => tb.has(t))
}

/** Avisos que dependen de lo que hay en la base (nombre distinto, dado de baja, Ganancias). */
export function avisosContraActual(v: FilaValidada, actual: ProveedorActual): string[] {
  const avisos: string[] = []
  if (v.nombreExcel && !nombresParecidos(v.nombreExcel, actual.nombre)) {
    avisos.push(`En el Excel dice "${v.nombreExcel}" y en el sistema el código ${v.codigo} es "${actual.nombre ?? ""}". Fijate que sea el mismo proveedor (el nombre no se modifica).`)
  }
  if (actual.activo === false) avisos.push("El proveedor está dado de baja en el sistema.")
  const condicionHoy = valorActual("condicion_ganancias", actual)
  if (v.valores.condicion_ganancias === "inscripto" && condicionHoy === "no_inscripto") {
    avisos.push('El proveedor figura como "no inscripto" en Ganancias: eso no se cambia desde el Excel (se cambia en la ficha fiscal).')
  }
  if (v.valores.ganancias_exento_hasta && (v.valores.condicion_ganancias ?? condicionHoy) !== "exento") {
    avisos.push(`Tiene fecha de certificado de exención (${fecha(v.valores.ganancias_exento_hasta)}) pero el proveedor no es exento: la fecha no se guarda.`)
  }
  return avisos
}

/** Cómo se muestra un valor en la vista previa. */
export function textoValor(campo: CampoProveedor, v: ValorCampo): string {
  if (v === null || v === "") return "(vacío)"
  if (typeof v === "boolean") return v ? "Sí" : "No"
  if (campo === "cuit") return formatCuit(String(v))
  if (campo === "ganancias_exento_hasta") return fecha(String(v)) || String(v)
  if (campo === "pago_blanco_medio" || campo === "pago_negro_medio") return MEDIOS_PAGO.find((m) => m.valor === v)?.nombre ?? String(v)
  if (campo === "pago_blanco_entrega" || campo === "pago_negro_entrega") return ENTREGAS_PAGO.find((m) => m.valor === v)?.nombre ?? String(v)
  if (campo === "pago_blanco_desde" || campo === "pago_negro_desde") return v === "recepcion" ? "Recepción" : v === "factura" ? "Factura" : String(v)
  if (campo === "tipo_proveedor") return v === "mercaderia_general" ? "Mercadería" : v === "transporte" ? "Transporte" : v === "servicios" ? "Servicios" : String(v)
  if (campo === "regimen_ganancias") return v === "bienes" ? "Mercadería (2 %)" : v === "transporte" ? "Transporte (0,25 %)" : String(v)
  if (campo === "condicion_ganancias") return v === "inscripto" ? "Inscripto" : v === "exento" ? "Exento" : v === "no_inscripto" ? "No inscripto" : String(v)
  return String(v)
}

// ─── Todo el Excel contra todos los proveedores ──────────────────────────────

export type EstadoFila = "cambios" | "sin_cambios" | "error" | "no_existe"

export interface FilaAnalizada {
  /** Número de fila en el Excel */
  fila: number
  codigo: string | null
  nombre_excel: string | null
  proveedor_id: string | null
  /** Nombre en el sistema (null si el código no existe) */
  nombre_sistema: string | null
  estado: EstadoFila
  cambios: Cambio[]
  errores: ErrorFila[]
  avisos: string[]
}

export interface ResumenImportacion { total: number; con_cambios: number; sin_cambios: number; con_errores: number; no_existen: number }

/**
 * Valida todas las filas y las compara con los proveedores de la base. Función única para
 * la vista previa y para el guardado (que vuelve a correrla antes de escribir).
 * `no_existe` también cuenta como error (esa fila no se importa).
 */
export function analizarImportacion(crudas: FilaCruda[], proveedores: ProveedorActual[]): { filas: FilaAnalizada[]; resumen: ResumenImportacion } {
  const porCodigo = new Map<string, ProveedorActual[]>()
  for (const p of proveedores) {
    const c = normalizarCodigo(p.codigo_proveedor as string | null)
    if (!c) continue
    porCodigo.set(c, [...(porCodigo.get(c) ?? []), p])
  }
  const validadas = crudas.map((c) => validarFila(c))
  const filasDelCodigo = new Map<string, number[]>()
  validadas.forEach((v, i) => {
    if (v.codigo) filasDelCodigo.set(v.codigo, [...(filasDelCodigo.get(v.codigo) ?? []), crudas[i].fila])
  })

  const filas: FilaAnalizada[] = validadas.map((v, i) => {
    const fila = crudas[i].fila
    const errores = [...v.errores]
    const avisos = [...v.avisos]
    let estado: EstadoFila = "sin_cambios"
    let cambios: Cambio[] = []
    let actual: ProveedorActual | null = null

    if (v.codigo) {
      const repetidas = (filasDelCodigo.get(v.codigo) ?? []).filter((f) => f !== fila)
      if (repetidas.length > 0) {
        errores.push({ columna: NOMBRE_COLUMNA.codigo, mensaje: `el código ${v.codigo} está repetido en el Excel (filas ${(filasDelCodigo.get(v.codigo) ?? []).join(" y ")}): dejá una sola` })
      }
      const encontrados = porCodigo.get(v.codigo) ?? []
      if (encontrados.length === 0) {
        errores.push({ columna: NOMBRE_COLUMNA.codigo, mensaje: `no hay ningún proveedor con el código ${v.codigo} en el sistema (el Excel no crea proveedores)` })
        estado = "no_existe"
      } else if (encontrados.length > 1) {
        errores.push({ columna: NOMBRE_COLUMNA.codigo, mensaje: `hay ${encontrados.length} proveedores con el código ${v.codigo} en el sistema: hay que corregirlo antes de importar` })
      } else {
        actual = encontrados[0]
        // Un dato inválido que el sistema YA tenía igual (venía escrito en el Excel) no es un cambio: aviso, no error
        for (let k = errores.length - 1; k >= 0; k--) {
          const e = errores[k]
          if (!e.campo || !e.crudo) continue
          const hoy = String(actual[e.campo] ?? "").trim().toLowerCase()
          if (hoy && hoy === e.crudo.trim().toLowerCase()) {
            errores.splice(k, 1)
            avisos.push(`${e.columna}: ${e.mensaje}. Ya estaba así en el sistema: no se modifica.`)
          }
        }
        avisos.push(...avisosContraActual(v, actual))
        cambios = calcularCambios(v.valores, actual)
      }
    }
    if (estado !== "no_existe") estado = errores.length > 0 ? "error" : cambios.length > 0 ? "cambios" : "sin_cambios"
    return {
      fila, codigo: v.codigo, nombre_excel: v.nombreExcel,
      proveedor_id: actual ? String(actual.id) : null,
      nombre_sistema: actual ? String(actual.nombre ?? "") : null,
      estado, cambios, errores, avisos,
    }
  })

  const resumen: ResumenImportacion = {
    total: filas.length,
    con_cambios: filas.filter((f) => f.estado === "cambios").length,
    sin_cambios: filas.filter((f) => f.estado === "sin_cambios").length,
    con_errores: filas.filter((f) => f.estado === "error" || f.estado === "no_existe").length,
    no_existen: filas.filter((f) => f.estado === "no_existe").length,
  }
  return { filas, resumen }
}

/** Objeto para el UPDATE: solo las columnas que cambian. */
export function updateDeCambios(cambios: Cambio[]): Record<string, ValorCampo> {
  const u: Record<string, ValorCampo> = {}
  for (const c of cambios) u[c.campo] = c.despues
  return u
}

// ─── Plantilla para completar ────────────────────────────────────────────────
// La arma el sistema con lo que cada proveedor tiene cargado HOY, con las mismas columnas y
// los mismos textos que este importador entiende: lo que se descarga se puede volver a subir
// tal cual y no cambia nada (hay un test que lo comprueba). No hay una plantilla aparte que mantener.

/** Columnas de la plantilla, en orden, con la ayuda entre paréntesis (el importador la ignora). */
export const COLUMNAS_PLANTILLA: { clave: ClaveExcel; encabezado: string; ancho: number; ayuda: string }[] = [
  { clave: "codigo", encabezado: "Código (no tocar)", ancho: 10, ayuda: "Con el código se vuelve a importar. No lo cambies." },
  { clave: "nombre", encabezado: "Proveedor (no tocar)", ancho: 32, ayuda: "Solo para ubicarse: el nombre no se modifica desde acá." },
  { clave: "cuit", encabezado: "CUIT (xx-xxxxxxxx-x)", ancho: 16, ayuda: "Con guiones: 30-12345678-9" },
  { clave: "tipo", encabezado: "Tipo (mercaderia / transporte / servicios)", ancho: 14, ayuda: "mercaderia / transporte / servicios" },
  { clave: "mail_oc", encabezado: "Mail para enviar la orden de compra", ancho: 30, ayuda: "A esta casilla se le manda la orden. Varios separados por coma." },
  { clave: "mail_admin", encabezado: "Mail de administración / cobranzas", ancho: 30, ayuda: "Un solo mail." },
  { clave: "telefono_vendedor", encabezado: "Teléfono del vendedor", ancho: 20, ayuda: "Texto libre." },
  { clave: "tipo_descuento", encabezado: "Descuentos: cómo se aplican (cascada / sobre_lista)", ancho: 16, ayuda: "cascada = uno sobre otro · sobre_lista = se suman y se aplican sobre el precio de lista" },
  { clave: "mixto_pct", encabezado: "Mixto: % con factura", ancho: 12, ayuda: "Artículos de compra mixta: qué porcentaje viene con factura (0 a 100). El resto viene sin. Vacío = 50." },
  { clave: "percepcion_iva", encabezado: "Percepción IVA %", ancho: 11, ayuda: "Porcentaje que nos percibe en la factura (0 si no percibe)." },
  { clave: "percepcion_iibb", encabezado: "Percepción IIBB %", ancho: 11, ayuda: "Porcentaje de Ingresos Brutos que nos percibe (0 si no percibe)." },
  { clave: "blanco_medio", encabezado: "BLANCO: medio de pago", ancho: 18, ayuda: "transferencia / cheques / echeq / efectivo / cheques_y_efectivo" },
  { clave: "blanco_dias", encabezado: "BLANCO: días de plazo", ancho: 12, ayuda: "Número de días (0 = contado). En cuotas: 30/60/90" },
  { clave: "blanco_desde", encabezado: "BLANCO: desde (factura / recepcion)", ancho: 12, ayuda: "factura = corre desde la fecha de la factura · recepcion = desde que llega la mercadería" },
  { clave: "blanco_plazo_cheque", encabezado: "BLANCO: plazo máx. del cheque (días)", ancho: 12, ayuda: "Hasta cuántos días de vencimiento acepta un cheque (30, 60…)." },
  { clave: "blanco_entrega", encabezado: "BLANCO: cómo se entrega", ancho: 18, ayuda: "transferencia / deposito_bancario / retira_oficina / envio_grimar" },
  { clave: "negro_medio", encabezado: "NEGRO: medio de pago", ancho: 18, ayuda: "Igual que BLANCO. Si se paga igual que lo que viene con factura, dejá vacías las columnas NEGRO." },
  { clave: "negro_dias", encabezado: "NEGRO: días de plazo", ancho: 12, ayuda: "Igual que BLANCO." },
  { clave: "negro_desde", encabezado: "NEGRO: desde (factura / recepcion)", ancho: 12, ayuda: "Igual que BLANCO." },
  { clave: "negro_plazo_cheque", encabezado: "NEGRO: plazo máx. del cheque (días)", ancho: 12, ayuda: "Igual que BLANCO." },
  { clave: "negro_entrega", encabezado: "NEGRO: cómo se entrega", ancho: 18, ayuda: "Igual que BLANCO." },
  { clave: "banco", encabezado: "Banco del proveedor", ancho: 18, ayuda: "Texto libre." },
  { clave: "cbu", encabezado: "CBU", ancho: 26, ayuda: "22 dígitos, sin espacios. La celda tiene que ser texto." },
  { clave: "alias", encabezado: "Alias", ancho: 20, ayuda: "De 6 a 20 caracteres: letras, números, punto y guion." },
  { clave: "titular", encabezado: "Titular de la cuenta", ancho: 26, ayuda: "Texto libre." },
  { clave: "acepta_cheques_terceros", encabezado: "Acepta cheques de terceros (si / no)", ancho: 12, ayuda: "si / no" },
  { clave: "acepta_echeq", encabezado: "Acepta e-cheq (si / no)", ancho: 12, ayuda: "si / no" },
  { clave: "ganancias", encabezado: "Retención Ganancias (mercaderia 2% / transporte 0,25% / exento)", ancho: 16, ayuda: "mercaderia (2 %) / transporte (0,25 %) / exento (no se le retiene)" },
  { clave: "exento_hasta", encabezado: "Exento: vence certificado (dd/mm/aaaa)", ancho: 14, ayuda: "Solo si es exento: hasta cuándo vale el certificado. dd/mm/aaaa" },
  { clave: "transporte_habitual", encabezado: "Transporte habitual", ancho: 22, ayuda: "Texto libre." },
  { clave: "dias_entrega", encabezado: "Días que tarda en entregar", ancho: 12, ayuda: "Número de días desde que se le manda la orden." },
  { clave: "observaciones", encabezado: "Observaciones", ancho: 34, ayuda: "Texto libre." },
]

const TIPO_A_TEXTO: Record<string, string> = { mercaderia_general: "mercaderia", transporte: "transporte", servicios: "servicios" }

/** Una fila de la plantilla con lo que el proveedor tiene cargado (texto, como lo entiende validarFila). */
export function filaPlantilla(p: ProveedorActual): Record<ClaveExcel, string> {
  const t = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim())
  const num = (v: unknown) => { const n = Number(v); return v === null || v === undefined || v === "" || !Number.isFinite(n) ? "" : String(n).replace(".", ",") }
  const siNo = (v: unknown) => (v === true ? "si" : v === false ? "no" : "")
  const dias = (canal: "blanco" | "negro") => t(p[`pago_${canal}_cuotas`]) || num(p[`pago_${canal}_dias`])
  const condicion = t(p.condicion_ganancias)
  const regimen = t(p.regimen_ganancias)
  // "no inscripto" y el régimen de servicios no se pueden expresar en el Excel: quedan vacíos (no se tocan)
  const ganancias = condicion === "exento" ? "exento" : condicion === "inscripto" ? (regimen === "transporte" ? "transporte" : regimen === "bienes" ? "mercaderia" : "") : ""
  const cuit = t(p.cuit)
  return {
    codigo: t(p.codigo_proveedor),
    nombre: t(p.nombre),
    // un CUIT guardado con error no se vuelve a escribir: saldría como error al importar
    cuit: cuit && !errorCuit(cuit) ? formatCuit(cuit) : "",
    tipo: TIPO_A_TEXTO[t(p.tipo_proveedor)] ?? "",
    mail_oc: t(p.mail_ordenes_compra),
    mail_admin: t(p.mail_oficina),
    telefono_vendedor: t(p.telefono_vendedor),
    tipo_descuento: t(p.tipo_descuento) === "sobre_lista" ? "sobre_lista" : t(p.tipo_descuento) === "cascada" ? "cascada" : "",
    mixto_pct: num(p.mixto_pct_factura),
    percepcion_iva: num(p.percepcion_iva),
    percepcion_iibb: num(p.percepcion_iibb),
    blanco_medio: t(p.pago_blanco_medio), blanco_dias: dias("blanco"), blanco_desde: t(p.pago_blanco_desde),
    blanco_plazo_cheque: num(p.pago_blanco_plazo_cheque), blanco_entrega: t(p.pago_blanco_entrega),
    negro_medio: t(p.pago_negro_medio), negro_dias: dias("negro"), negro_desde: t(p.pago_negro_desde),
    negro_plazo_cheque: num(p.pago_negro_plazo_cheque), negro_entrega: t(p.pago_negro_entrega),
    banco: t(p.banco_nombre), cbu: t(p.cbu), alias: t(p.cbu_alias), titular: t(p.banco_titular),
    acepta_cheques_terceros: siNo(p.acepta_cheques_terceros), acepta_echeq: siNo(p.acepta_echeq),
    ganancias,
    exento_hasta: condicion === "exento" && t(p.ganancias_exento_hasta) ? fecha(t(p.ganancias_exento_hasta).slice(0, 10)) : "",
    transporte_habitual: t(p.transporte_habitual),
    dias_entrega: num(p.dias_entrega),
    observaciones: t(p.observaciones_compra),
  }
}

/** Hoja "Cómo completar" de la plantilla. */
export function ayudaPlantilla(): string[][] {
  return [
    ["Cómo completar"],
    ["Una fila por proveedor, con lo que el sistema tiene cargado hoy. Corregí o completá lo que haga falta y volvé a subir el archivo en Fichas de proveedores → Importar datos de compra (Excel)."],
    ["No cambies las dos primeras columnas: con el código se vuelve a importar."],
    ["Lo que dejes vacío NO se modifica (una celda vacía nunca borra un dato)."],
    ["Antes de guardar, el sistema muestra proveedor por proveedor qué cambia (antes → después) y qué filas tienen errores. Una fila con error no se importa; el resto sí."],
    ["Si con un proveedor no se compra sin factura, o se le paga igual, dejá vacías las columnas NEGRO."],
    [],
    ["Columna", "Qué se puede escribir"],
    ...COLUMNAS_PLANTILLA.map((c) => [c.encabezado.replace(/\s*\([^)]*\)\s*$/, ""), c.ayuda]),
  ]
}
