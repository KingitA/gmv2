/**
 * Banco Credicoop — API Empresas. Reglas PURAS: formatos del banco, armado de los pedidos,
 * lectura de estados y traducción de errores. Sin imports (se prueba en la batería como
 * @gm/credicoop y lo usan el cliente real y el simulador).
 *
 * Documentación: https://www.bancocredicoop.coop/apiempresas/docs/intro/ (leída el 19/11/2026).
 *
 * Decisión de Juan (19/11/2026): «emisión de echeqs, confirmación y realizar transferencias y
 * pagos de VEPs y servicios siempre lo hacemos desde Credicoop» / «Siempre, desde el banco que
 * sea vamos a tener que confirmar vía token.»
 * ⇒ SIEMPRE la modalidad "con firma": la operación queda "Enviada a la firma" en Banca Internet
 *   Empresa y una persona la firma con su token. Este sistema NUNCA usa el envío directo.
 */

// ─── Modalidad: solo con firma ─────────────────────────────────────────────
export const SCOPES = {
  cuentas: "cuentas",
  transferencias: "transferenciasConFirma",
  echeq: "echeqConFirma",
  vep: "vepConFirma",
  /** Agenda de beneficiarios de e-cheq (de ahí sale el nombre que el banco acepta) */
  beneficiarioEcheq: "beneficiarioEcheq",
} as const
export type AmbitoCredicoop = keyof typeof SCOPES

/** Rutas de la API (relativas a la URL del ambiente). Las que mueven plata son SIEMPRE /ConFirma/. */
export const RUTAS = {
  token: (realm: string) => `/auth/realms/${realm}/protocol/openid-connect/token`,
  audiencia: (base: string, realm: string) => `${base}/auth/realms/${realm}`,
  cuentas: "/api/cuentas/v2/listaCuentas",
  movimientos: (nroCuenta: string) => `/api/cuentas/v2/${encodeURIComponent(nroCuenta)}/movimientos`,
  transferir: "/api/transferencias/v1/ConFirma/transferencia",
  consultaTransferencia: "/api/transferencias/v1/transferencia",
  emitirEcheq: "/api/echeq/v1/ConFirma/emision",
  consultaEcheq: "/api/echeq/v1/emision",
  gestionEcheq: "/api/echeq/v1/ConFirma/gestion",
  listarEcheqs: "/api/echeq/v1/lista-cheques",
  beneficiarioEcheq: (numeroAdherente: number | string) => `/api/echeq/v1/beneficiario/${encodeURIComponent(String(numeroAdherente))}`,
  listarVeps: "/api/vep/v1/consulta",
  pagarVep: "/api/vep/v1/ConFirma/pago",
  consultaPagoVep: "/api/vep/v1/pago",
} as const

export const URL_HOMOLOGACION = "https://homoapibccl.bancocredicoop.coop"
export const REALM_HOMOLOGACION = "homologacion"
/** Tope del banco: 50 pedidos por minuto entre todas las APIs. */
export const PEDIDOS_POR_MINUTO = 50
export const MAX_BENEFICIARIOS = 200

// ─── Formatos del banco ────────────────────────────────────────────────────

/** Importe del sistema (número) → texto del banco: "123456.25". Lanza si no es un importe válido. */
export function montoBanco(n: number): string {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) throw new ErrorCredicoop("El importe no es válido.", "DATOS")
  const centavos = Math.round(n * 100)
  if (centavos <= 0) throw new ErrorCredicoop("El importe no es válido.", "DATOS")
  const entero = Math.floor(centavos / 100), dec = centavos % 100
  if (String(entero).length > 13) throw new ErrorCredicoop("El importe es demasiado grande para el banco.", "DATOS")
  return `${entero}.${dec < 10 ? "0" : ""}${dec}`
}

/** Texto del banco ("100.0", "1234.56", 700099.28) → número del sistema. null si no se entiende. */
export function montoDesdeBanco(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : null
  const s = String(v ?? "").trim()
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  return Math.round(Number(s) * 100) / 100
}

/** "2026-11-19" → "20261119" */
export function fechaBanco(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""))
  if (!m) throw new ErrorCredicoop("La fecha no es válida.", "DATOS")
  return `${m[1]}${m[2]}${m[3]}`
}

/** "20261119" → "2026-11-19" (null si no es una fecha) */
export function fechaDesdeBanco(v: unknown): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(v ?? "").trim())
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

/**
 * Texto para el banco: solo letras A-Z, números y espacios (sin tildes ni signos), en
 * mayúsculas, recortado al máximo. El banco rechaza cualquier otro carácter.
 */
export function textoBanco(v: unknown, max: number): string {
  return String(v ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/ñ/gi, "N")
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ").trim().toUpperCase().slice(0, max).trim()
}

export const soloDigitos = (v: unknown) => String(v ?? "").replace(/[^0-9]/g, "")

/** CBU o CVU: 22 dígitos. No valida los dígitos verificadores (lo hace el banco). */
export function cbuValido(v: unknown): boolean {
  return /^\d{22}$/.test(soloDigitos(v)) && soloDigitos(v) === String(v ?? "").trim()
}
export function cuitDeOnce(v: unknown): string | null {
  const d = soloDigitos(v)
  return d.length === 11 ? d : null
}

// ─── Errores ───────────────────────────────────────────────────────────────

export type ClaseError =
  | "SIN_CONEXION"   // faltan las credenciales: no se manda nada
  | "DATOS"          // el pedido está mal armado de nuestro lado (no salió hacia el banco)
  | "RECHAZO"        // el banco contestó que no (no hay que reintentar igual)
  | "DUPLICADO"      // ya existe una operación con ese idOrigen: consultar su estado
  | "INCIERTO"       // corte, tiempo agotado o error del banco: NO se sabe si entró → consultar antes de reintentar
  | "LIMITE"         // demasiados pedidos por minuto
  | "AUTORIZACION"   // el banco no aceptó las credenciales o el token

export class ErrorCredicoop extends Error {
  name = "ErrorCredicoop"
  constructor(mensaje: string, public clase: ClaseError, public codigo?: string, public detalle?: unknown) {
    super(mensaje)
  }
}

/** Códigos de "ya existe una operación con el mismo idOrigen" de cada API. */
const CODIGOS_DUPLICADO = new Set(["APIE-0003", "APIE-1003", "APIE-2003", "APIE-3003", "APIE-4011", "APIE-5010"])
/** Códigos de "AccessToken no válido". */
const CODIGOS_TOKEN = new Set(["APIE-0030", "APIE-1030", "APIE-2030", "APIE-3020", "APIE-4030", "APIE-5020"])

/** Mensajes en castellano claro para los errores que puede corregir la oficina. */
const MENSAJES: Record<string, string> = {
  "APIE-0002": "La cuenta de la que sale la plata no está bien cargada o no está vinculada en Credicoop.",
  "APIE-0004": "La empresa no está habilitada para operar en Credicoop en este momento.",
  "APIE-0006": "Una transferencia a varios beneficiarios no puede incluir un CVU (billetera virtual): mandala sola.",
  "APIE-0008": "El beneficiario no está en la lista de cuentas de terceros de Credicoop: hay que darlo de alta en Banca Internet Empresa.",
  "APIE-0010": "El CBU o CVU del beneficiario no es válido.",
  "APIE-0012": "La cuenta de la que sale la plata no es válida para esta operación.",
  "APIE-0013": "La fecha de pago no es válida: una transferencia solo se puede mandar con fecha de hoy.",
  "APIE-0015": "El CBU o CVU del beneficiario no es válido.",
  "APIE-0016": "El importe no es válido.",
  "APIE-0017": "El nombre del beneficiario tiene caracteres que el banco no acepta.",
  "APIE-0018": "El CUIT o CUIL del beneficiario no es válido.",
  "APIE-0024": "No hay ningún firmante habilitado en Credicoop para esta cuenta.",
  "APIE-0029": "El CVU no pertenece al titular indicado.",
  "APIE-1002": "La cuenta de la que sale el e-cheq no está vinculada en Credicoop.",
  "APIE-1004": "La empresa no está activa en Credicoop.",
  "APIE-1005": "Falta aceptar los términos y condiciones de e-cheq en Banca Internet Empresa.",
  "APIE-1006": "Esa cuenta no está habilitada para emitir e-cheq.",
  "APIE-1013": "El nombre del beneficiario del e-cheq no coincide con el que Credicoop tiene registrado para ese CUIT.",
  "APIE-1015": "El CUIT del beneficiario del e-cheq no es válido.",
  "APIE-8014": "El proveedor no está en la agenda de beneficiarios de Credicoop: hay que darlo de alta en Banca Internet Empresa.",
  "APIE-1020": "El beneficiario no está en la lista de beneficiarios de e-cheq de Credicoop: hay que darlo de alta en Banca Internet Empresa.",
  "APIE-1022": "La fecha de pago del e-cheq no es válida: un e-cheq común va con fecha de hoy y uno diferido, con fecha posterior.",
  "APIE-1024": "No hay ningún firmante habilitado en Credicoop para emitir e-cheq desde esa cuenta.",
  "APIE-2018": "No hay ningún firmante habilitado en Credicoop para esa cuenta.",
  "APIE-2026": "El e-cheq no está en poder de la empresa (ya se endosó, se depositó o no se aceptó todavía).",
  "APIE-2029": "El e-cheq está vencido.",
  "APIE-2042": "El e-cheq no está en un estado que se pueda aceptar.",
  "APIE-2046": "El e-cheq no está en un estado que se pueda endosar (tiene que estar activo, ya aceptado).",
  "APIE-2047": "El e-cheq está vencido: no admite ninguna acción.",
  "APIE-2050": "Hay una orden de no pagar sobre ese e-cheq.",
  "APIE-2051": "El proveedor no está en la lista de beneficiarios de e-cheq de Credicoop: hay que darlo de alta en Banca Internet Empresa.",
  "APIE-2052": "El proveedor no está bancarizado: no puede recibir un e-cheq.",
  "APIE-4013": "La cuenta de la que sale el pago no está vinculada en Credicoop.",
  "APIE-4014": "No hay ningún firmante habilitado en Credicoop para pagar ese VEP.",
  "APIE-4016": "El banco no encontró ese VEP.",
  "APIE-4019": "La moneda del VEP no coincide con la que informa ARCA.",
  "APIE-4020": "El importe del VEP no coincide con el que informa ARCA.",
  "APIE-4023": "El VEP no está pendiente de pago.",
}

interface ErrorDelBanco { codigo?: unknown; descripcion?: unknown; errores?: Array<{ codigo?: unknown; descripcion?: unknown; orden?: unknown }> }

/**
 * Convierte una respuesta de error del banco en un ErrorCredicoop con mensaje en castellano.
 * `estadoHttp` ≥ 500 o sin cuerpo entendible ⇒ INCIERTO (no se sabe si la operación entró).
 */
export function errorDelBanco(estadoHttp: number, cuerpo: unknown): ErrorCredicoop {
  // El banco contesta los errores envueltos: {"error":{"codigo":"APIE-1013","descripcion":"…"}}
  const envuelto = cuerpo && typeof cuerpo === "object" ? (cuerpo as { error?: unknown }).error : undefined
  const raiz = envuelto && typeof envuelto === "object" ? envuelto : cuerpo
  const c = (raiz && typeof raiz === "object" ? raiz : {}) as ErrorDelBanco
  const lista = Array.isArray(c.errores) ? c.errores : []
  const codigos = [...lista.map((e) => String(e?.codigo ?? "")), String(c.codigo ?? "")]
    .map((x) => (/^\d+$/.test(x) ? `APIE-${x.padStart(4, "0")}` : x)).filter((x) => /^APIE-\d{4}$/.test(x))
  const principal = codigos[0]

  if (estadoHttp === 429) return new ErrorCredicoop("Credicoop está recibiendo demasiados pedidos seguidos (el tope es 50 por minuto). Esperá un minuto y probá de nuevo.", "LIMITE", principal, cuerpo)
  if (estadoHttp === 401 || estadoHttp === 403 || codigos.some((x) => CODIGOS_TOKEN.has(x))) {
    return new ErrorCredicoop("Credicoop no aceptó las credenciales de conexión. Avisá a sistemas: hay que revisar el identificador y la clave de la conexión.", "AUTORIZACION", principal, cuerpo)
  }
  if (codigos.some((x) => CODIGOS_DUPLICADO.has(x))) {
    return new ErrorCredicoop("Esa operación ya había sido enviada a Credicoop. Tocá “Actualizar estado” para ver cómo quedó: no la mandes de nuevo.", "DUPLICADO", principal, cuerpo)
  }
  if (estadoHttp >= 500 || (estadoHttp >= 400 && !principal && !c.descripcion)) {
    return new ErrorCredicoop("Credicoop no contestó bien y NO se sabe si la operación entró. Tocá “Actualizar estado” antes de volver a mandarla.", "INCIERTO", principal, cuerpo)
  }
  const partes = lista.length
    ? lista.map((e) => MENSAJES[String(e?.codigo ?? "")] ?? String(e?.descripcion ?? "").trim()).filter(Boolean)
    : [MENSAJES[principal ?? ""] ?? String(c.descripcion ?? "").trim()].filter(Boolean)
  const texto = [...new Set(partes)].join(" ") || "El banco rechazó la operación sin explicar el motivo."
  return new ErrorCredicoop(`Credicoop rechazó la operación: ${texto}${principal ? ` (${codigos.join(", ")})` : ""}`, "RECHAZO", principal, cuerpo)
}

// ─── Estados ───────────────────────────────────────────────────────────────

/**
 * Estado de una operación en ESTE sistema:
 *   preparada        armada y guardada, todavía no salió hacia el banco
 *   enviada_a_firma  el banco la tiene esperando la firma con token en Banca Internet Empresa
 *   en_proceso       firmada o aceptada por el banco, pero todavía no terminó (en procesamiento,
 *                    retenida por límite, reintentando el envío)
 *   firmada          el banco la procesó: la transferencia salió / el e-cheq se emitió / el VEP se pagó
 *   rechazada        el banco la rechazó (falta de fondos, firmante que la rechazó…)
 *   error            no se pudo mandar, o no se sabe si entró (hay que actualizar el estado)
 *   acreditada       además, se vio el movimiento en la cuenta (conciliada con el extracto)
 */
export type EstadoOperacion = "preparada" | "enviada_a_firma" | "en_proceso" | "firmada" | "rechazada" | "error" | "acreditada"

export const ESTADO_NOMBRE: Record<EstadoOperacion, string> = {
  preparada: "Sin enviar", enviada_a_firma: "Esperando la firma en Credicoop", en_proceso: "El banco la está procesando",
  firmada: "Firmada y procesada por el banco", rechazada: "Rechazada por el banco", error: "No se sabe si entró: actualizá el estado",
  acreditada: "Hecha y vista en la cuenta",
}

/** ¿El banco ya terminó con la operación (para bien o para mal)? */
export const esEstadoFinal = (e: EstadoOperacion) => e === "firmada" || e === "rechazada" || e === "acreditada"
/** ¿La plata salió (o el e-cheq / VEP quedó hecho)? */
export const estaHecha = (e: EstadoOperacion) => e === "firmada" || e === "acreditada"

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()

/**
 * Texto de estado del banco → estado del sistema. Lo que no se reconoce queda "en_proceso":
 * NUNCA se da por hecha una operación por un texto desconocido.
 * Ojo: "Aceptada parcialmente" (operaciones de varios beneficiarios) queda en_proceso: hay que
 * mirar cada beneficiario.
 */
export function estadoDesdeBanco(descripcion: unknown): EstadoOperacion {
  const d = sinTildes(String(descripcion ?? ""))
  if (!d) return "en_proceso"
  // Primero lo que termina mal: "Rechazada por el firmante" habla de la firma, pero es un rechazo
  if (/rechazad|anulad|vencid|cancelad|caducad|repudiad/.test(d)) return "rechazada"
  if (d.includes("firma")) return "enviada_a_firma"
  if (d.includes("parcial")) return "en_proceso"
  if (d === "enviada a banco destino" || d === "aceptada" || d === "pagado" || d === "pagada") return "firmada"
  return "en_proceso"   // en procesamiento, retenida, enviada a proceso, confeccionada, o cualquier texto nuevo
}

/** ¿El texto del banco es uno de los que este sistema conoce? Si no, se muestra tal cual y lo resuelve una persona. */
export function estadoBancoConocido(descripcion: unknown): boolean {
  const d = sinTildes(String(descripcion ?? ""))
  return /rechazad|anulad|vencid|cancelad|caducad|repudiad|firma|parcial/.test(d)
    || ["enviada a banco destino", "aceptada", "pagado", "pagada", "en procesamiento", "retenida", "enviada a proceso", "confeccionada"].includes(d)
}

/** Estado de un e-cheq tal como lo lista el banco, normalizado: mayúsculas y guiones ("activo pendiente" → "ACTIVO-PENDIENTE"). */
export const estadoEcheq = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase().replace(/[\s_]+/g, "-")

/**
 * ¿El endoso de un e-cheq quedó hecho? Solo con un estado CONCRETO del cheque:
 *   ACTIVO-PENDIENTE = endosado a un tercero, esperando que lo acepte (así lo define el banco).
 * ACTIVO = sigue en nuestro poder (el endoso no se firmó). Cualquier otra cosa —el cheque no
 * aparece, o un estado que no se esperaba— NO se toma como hecho: queda en proceso y lo mira una persona.
 */
export function endosoSegunEcheq(estado: unknown): "hecho" | "pendiente" | "desconocido" {
  const e = estadoEcheq(estado)
  if (e === "ACTIVO-PENDIENTE") return "hecho"
  if (e === "ACTIVO") return "pendiente"
  return "desconocido"
}

// ─── Pedidos ───────────────────────────────────────────────────────────────

export interface DatosEmpresa {
  numeroAdherente: number
  /** Firmantes a proponer (opcional): documento y tipo (DNI, CUIT…) */
  firmantes?: Array<{ documento: string; documentoTipo: string }>
}

export const CONCEPTOS_TRANSFERENCIA = ["ALQ", "CUO", "EXP", "FAC", "PRE", "SEG", "HON", "VAR", "OIH", "BRH", "SON", "APC", "ROP", "SIS", "ESE", "HAB"] as const
export const CONCEPTOS_ECHEQ = ["ALQ", "CUO", "EXP", "FAC", "PRE", "SEG", "HON", "VAR"] as const

export interface BeneficiarioTransferencia {
  cbuCvu: string
  cuit: string
  nombre: string
  monto: number
  concepto?: string
  /** Hasta 12 letras o números (ej. el número de la orden de pago) */
  referencia?: string
  /** Hasta 60 letras o números */
  observaciones?: string
  mails?: string[]
}

const mailsValidos = (xs: string[] | undefined, max: number) =>
  [...new Set((xs ?? []).flatMap((x) => String(x ?? "").split(/[,;\s]+/)).map((x) => x.trim()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x) && x.length <= 150))].slice(0, max)

const firmantesDe = (e: DatosEmpresa) => (e.firmantes?.length ? { operadoresFirmantes: e.firmantes.map((f) => ({ documento: soloDigitos(f.documento), documentoTipo: String(f.documentoTipo).toUpperCase() })) } : {})

function exigirEmpresa(e: DatosEmpresa) {
  if (!Number.isInteger(e.numeroAdherente) || e.numeroAdherente <= 0) throw new ErrorCredicoop("Falta el número de adherente de Credicoop.", "SIN_CONEXION")
}
function exigirIdOrigen(id: string) {
  if (!id || id.length > 36) throw new ErrorCredicoop("El identificador de la operación no es válido.", "DATOS")
}
function exigirCbuDebito(cbu: string) {
  if (!cbuValido(cbu)) throw new ErrorCredicoop("La cuenta de la que sale la plata no tiene cargado un CBU de 22 dígitos.", "DATOS")
}

/**
 * Transferencia con firma. Un beneficiario = individual (se procesa en el acto, admite CVU);
 * varios = múltiple (hasta 200, solo CBU, el banco la procesa después).
 * `fechaPago` es SIEMPRE hoy: el banco no acepta fechas futuras.
 */
export function armarTransferencia(e: DatosEmpresa, p: { idOrigen: string; cbuCuentaDebito: string; hoy: string; beneficiarios: BeneficiarioTransferencia[] }) {
  exigirEmpresa(e); exigirIdOrigen(p.idOrigen); exigirCbuDebito(p.cbuCuentaDebito)
  if (!p.beneficiarios.length) throw new ErrorCredicoop("La transferencia no tiene ningún beneficiario.", "DATOS")
  if (p.beneficiarios.length > MAX_BENEFICIARIOS) throw new ErrorCredicoop(`Una transferencia admite hasta ${MAX_BENEFICIARIOS} beneficiarios.`, "DATOS")
  return {
    numeroAdherente: e.numeroAdherente,
    idOrigen: p.idOrigen,
    cbuCuentaDebito: p.cbuCuentaDebito,
    fechaPago: fechaBanco(p.hoy),
    ...firmantesDe(e),
    beneficiarios: p.beneficiarios.map((b, i) => {
      const quien = b.nombre ? `de ${b.nombre}` : `del beneficiario ${i + 1}`
      if (!cbuValido(b.cbuCvu)) throw new ErrorCredicoop(`El CBU ${quien} no tiene 22 dígitos. Cargalo en la ficha del proveedor.`, "DATOS")
      const cui = cuitDeOnce(b.cuit)
      if (!cui) throw new ErrorCredicoop(`Falta el CUIT ${quien} (11 dígitos). Cargalo en la ficha del proveedor.`, "DATOS")
      const nombre = textoBanco(b.nombre, 100)
      if (!nombre) throw new ErrorCredicoop(`Falta el nombre ${quien}.`, "DATOS")
      const concepto = (CONCEPTOS_TRANSFERENCIA as readonly string[]).includes(String(b.concepto)) ? String(b.concepto) : "FAC"
      const referencia = textoBanco(b.referencia, 60).replace(/ /g, "").slice(0, 12)
      const observaciones = textoBanco(b.observaciones, 60)
      const mails = mailsValidos(b.mails, 3)
      return {
        orden: i,
        cbuCvu: b.cbuCvu,
        esCuentaPropia: "N",
        monto: montoBanco(b.monto),
        moneda: "ARS",
        ...(observaciones ? { observaciones } : {}),
        concepto,
        ...(referencia ? { referenciaConcepto: referencia } : {}),
        cui,
        nombre,
        ...(mails.length ? { mails } : {}),
      }
    }),
  }
}

export interface EcheqAEmitir {
  monto: number
  /** Fecha de pago (ISO). Igual a hoy = e-cheq común; posterior = diferido. */
  fechaPago: string
  beneficiarioNombre: string
  beneficiarioCuit: string
  concepto?: string
  /** Texto libre: solo letras y números */
  motivo?: string
  mails?: string[]
}

/** Emisión de e-cheq con firma. Siempre cruzado y a la orden. */
export function armarEmisionEcheq(e: DatosEmpresa, p: { idOrigen: string; cbuCuentaDebito: string; hoy: string; echeqs: EcheqAEmitir[] }) {
  exigirEmpresa(e); exigirIdOrigen(p.idOrigen); exigirCbuDebito(p.cbuCuentaDebito)
  if (!p.echeqs.length) throw new ErrorCredicoop("No hay ningún e-cheq para emitir.", "DATOS")
  return {
    numeroAdherente: e.numeroAdherente,
    idOrigen: p.idOrigen,
    cbuCuentaDebito: p.cbuCuentaDebito,
    ...firmantesDe(e),
    echeqs: p.echeqs.map((c) => {
      if (fechaBanco(c.fechaPago) < fechaBanco(p.hoy)) throw new ErrorCredicoop("La fecha de pago del e-cheq no puede ser anterior a hoy.", "DATOS")
      const doc = cuitDeOnce(c.beneficiarioCuit)
      if (!doc) throw new ErrorCredicoop(`Falta el CUIT de ${c.beneficiarioNombre || "el beneficiario"} (11 dígitos). Cargalo en la ficha del proveedor.`, "DATOS")
      const nombre = textoBanco(c.beneficiarioNombre, 100)
      if (!nombre) throw new ErrorCredicoop("Falta el nombre del beneficiario del e-cheq.", "DATOS")
      const mails = mailsValidos(c.mails, 3)
      return {
        monto: montoBanco(c.monto),
        fechaPago: fechaBanco(c.fechaPago),
        motivoPago: textoBanco(c.motivo, 60) || "PAGO A PROVEEDOR",
        concepto: (CONCEPTOS_ECHEQ as readonly string[]).includes(String(c.concepto)) ? String(c.concepto) : "FAC",
        caracter: "1",   // a la orden
        modo: "1",       // cruzado
        beneficiarioNombre: nombre,
        beneficiarioDocumentoTipo: "CUIT",
        beneficiarioDocumento: doc,
        tipoCheque: c.fechaPago > p.hoy ? "ECHD" : "ECHC",   // diferido / común
        ...(mails.length ? { mails } : {}),
      }
    }),
  }
}

export type AccionEcheq = "ACEPTAR" | "ENDOSAR" | "DEPOSITAR" | "PONER-EN-CUSTODIA"

/** Identifica un e-cheq recibido: el id del cheque (alfanumérico) o su CMC7 (29 dígitos). */
export interface EcheqRecibido { idCheque?: string | null; cmc7?: string | null; monto?: number; fechaPago?: string }

/**
 * Gestión de e-cheq recibidos, con firma. ENDOSAR (nominal) = pasarle al proveedor un e-cheq
 * que nos dio un cliente. DEPOSITAR y PONER-EN-CUSTODIA piden el importe y la fecha de cada cheque.
 */
export function armarGestionEcheq(e: DatosEmpresa, p: { idOrigen: string; cbuCuenta: string; accion: AccionEcheq; echeqs: EcheqRecibido[]; beneficiarioCuit?: string }) {
  exigirEmpresa(e); exigirIdOrigen(p.idOrigen)
  if (!cbuValido(p.cbuCuenta)) throw new ErrorCredicoop("La cuenta de Credicoop no tiene cargado un CBU de 22 dígitos.", "DATOS")
  if (!p.echeqs.length) throw new ErrorCredicoop("No hay ningún e-cheq elegido.", "DATOS")
  const conImporte = p.accion === "DEPOSITAR" || p.accion === "PONER-EN-CUSTODIA"
  const cheques = p.echeqs.map((c) => {
    const idCheque = String(c.idCheque ?? "").trim(), cmc7 = soloDigitos(c.cmc7)
    if (!idCheque && cmc7.length !== 29) throw new ErrorCredicoop("Falta el identificador del e-cheq (el que le pone el banco). Traé los e-cheq recibidos de Credicoop para completarlo.", "DATOS")
    if (conImporte && (c.monto == null || !c.fechaPago)) throw new ErrorCredicoop("Para depositar o poner en custodia hacen falta el importe y la fecha de pago del e-cheq.", "DATOS")
    return {
      ...(idCheque ? { idCheque } : {}), ...(cmc7.length === 29 ? { cmc7 } : {}),
      ...(conImporte ? { monto: montoBanco(c.monto as number), fechaPago: fechaBanco(c.fechaPago as string) } : {}),
    }
  })
  let endoso = {}
  if (p.accion === "ENDOSAR") {
    const doc = cuitDeOnce(p.beneficiarioCuit)
    if (!doc) throw new ErrorCredicoop("Falta el CUIT del proveedor al que se le endosa el e-cheq (11 dígitos). Cargalo en su ficha.", "DATOS")
    endoso = { tipoEndoso: "NOM", beneficiario: { documento: doc, documentoTipo: "CUIT" } }
  }
  return { numeroAdherente: e.numeroAdherente, idOrigen: p.idOrigen, cbuCuenta: p.cbuCuenta, ...firmantesDe(e), accion: p.accion, ...endoso, echeqs: cheques }
}

/** Listado de e-cheq (recibidos o generados). El banco devuelve de a 20. */
export function armarListaEcheqs(e: DatosEmpresa, p: { idOrigen: string; gestion: "RECIBIDOS" | "GENERADOS"; estado?: string; numeroCheque?: string; idCheque?: string | null; cuit?: string; pagina?: number }) {
  exigirEmpresa(e); exigirIdOrigen(p.idOrigen)
  return {
    idOrigen: p.idOrigen, numeroAdherente: e.numeroAdherente,
    filtro: {
      gestion: p.gestion, estado: (p.estado || "TODOS").toUpperCase(),
      ...(p.idCheque ? { idCheque: String(p.idCheque) } : {}),
      ...(p.numeroCheque ? { numeroCheque: soloDigitos(p.numeroCheque) } : {}),
      ...(cuitDeOnce(p.cuit) ? { cuitCuilCdi: cuitDeOnce(p.cuit) } : {}),
      pagina: Math.max(1, Math.trunc(p.pagina ?? 1)), limite: 20,
    },
  }
}

/** VEP pendientes (o pagados) de ARCA. El banco admite hasta 180 días entre las dos fechas. */
export function armarListaVeps(e: DatosEmpresa, p: { idOrigen: string; estado?: "PENDIENTE_PAGO" | "PAGADO"; desde?: string; hasta?: string; cuitContribuyente?: string }) {
  exigirEmpresa(e); exigirIdOrigen(p.idOrigen)
  return {
    numeroAdherente: e.numeroAdherente, idOrigen: p.idOrigen,
    filtro: {
      estado: p.estado ?? "PENDIENTE_PAGO",
      ...(cuitDeOnce(p.cuitContribuyente) ? { cuitContribuyente: cuitDeOnce(p.cuitContribuyente) } : {}),
      ...(p.desde && p.hasta ? { fechaDesde: fechaBanco(p.desde), fechaHasta: fechaBanco(p.hasta) } : {}),
    },
  }
}

/** Pago de UN VEP con firma (el banco solo admite de a uno). El importe tiene que ser el que informa ARCA. */
export function armarPagoVep(e: DatosEmpresa, p: { idOrigen: string; cbuCuentaDebito: string; numeroVep: number | string; monto: number; cuitContribuyente?: string; cuitOriginante?: string }) {
  exigirEmpresa(e); exigirIdOrigen(p.idOrigen); exigirCbuDebito(p.cbuCuentaDebito)
  const numero = Number(soloDigitos(p.numeroVep))
  if (!Number.isInteger(numero) || numero <= 0 || String(numero).length > 12) throw new ErrorCredicoop("El número de VEP no es válido.", "DATOS")
  return {
    numeroAdherente: e.numeroAdherente, idOrigen: p.idOrigen, cbuCuentaDebito: p.cbuCuentaDebito, ...firmantesDe(e),
    veps: [{
      numeroVep: numero,
      ...(cuitDeOnce(p.cuitContribuyente) ? { cuitContribuyente: cuitDeOnce(p.cuitContribuyente) } : {}),
      ...(cuitDeOnce(p.cuitOriginante) ? { cuitOriginante: cuitDeOnce(p.cuitOriginante) } : {}),
      monto: montoBanco(p.monto), moneda: "ARS",
    }],
  }
}

// ─── Respuestas ────────────────────────────────────────────────────────────

export interface ResultadoOperacion {
  idOperacion: string | null
  estado: EstadoOperacion
  /** Texto de estado tal como lo dijo el banco */
  estadoBanco: string
  motivo: string | null
  /** e-cheq emitido: el identificador que le puso el banco */
  idCheque?: string | null
  /** e-cheq emitido: el número de cheque que le puso el banco (si lo informa) */
  numeroCheque?: string | null
}

/** Lee la respuesta de enviar o consultar una transferencia, una emisión, una gestión o un pago de VEP. */
export function leerOperacion(respuesta: unknown): ResultadoOperacion {
  const data = ((respuesta as any)?.data ?? {}) as any
  // Pago de VEP: la operación viene dentro de data.operaciones[0]
  const op = Array.isArray(data.operaciones) && data.operaciones[0] ? data.operaciones[0] : data
  const estadoBanco = String(op?.estadoOperacion?.descripcion ?? "").trim()
  if (!estadoBanco) throw new ErrorCredicoop("Credicoop contestó sin decir en qué estado quedó la operación. Tocá “Actualizar estado” antes de volver a mandarla.", "INCIERTO", undefined, respuesta)
  const cheque = data.echeq ?? (Array.isArray(data.echeqs) ? data.echeqs[0] : null)
  return {
    idOperacion: op?.idOperacion != null ? String(op.idOperacion) : null,
    estado: estadoDesdeBanco(estadoBanco),
    estadoBanco,
    motivo: String(op?.estadoOperacion?.motivo ?? cheque?.estado?.motivo ?? "").trim() || null,
    idCheque: cheque?.idCheque != null ? String(cheque.idCheque) : null,
    numeroCheque: String(cheque?.numeroCheque ?? "").trim() || null,
  }
}

export interface CuentaCredicoop { nroCuenta: string; denominacion: string; saldo: number | null; tipo: string; moneda: string; cbu: string }
export function leerCuentas(respuesta: unknown): CuentaCredicoop[] {
  const lista = ((respuesta as any)?.clarifCuentas ?? []) as any[]
  return (Array.isArray(lista) ? lista : []).map((c) => ({
    nroCuenta: String(c?.nroCuenta ?? ""), denominacion: String(c?.denominacionCuenta ?? ""), saldo: montoDesdeBanco(c?.saldo),
    tipo: String(c?.tipoCuenta ?? ""), moneda: String(c?.moneda ?? ""), cbu: String(c?.CBU ?? c?.cbu ?? ""),
  }))
}

export interface MovimientoCredicoop {
  fecha: string            // ISO
  descripcion: string
  /** Con signo: crédito (+) entra plata, débito (−) sale */
  monto: number
  saldo: number | null
  nroComprobante: string
  codOperativo: string
  idTransaccion: string
}

/**
 * Movimientos de una cuenta. El primer renglón del banco es un ENCABEZADO (saldo), no un
 * movimiento. `parcial` = el banco avisó que cortó por el tope de registros: hay que pedir un
 * rango de fechas más corto, porque faltan movimientos.
 */
export function leerMovimientos(respuesta: unknown): { movimientos: MovimientoCredicoop[]; saldo: number | null; parcial: boolean } {
  const r = (respuesta ?? {}) as any
  const filas = (Array.isArray(r.consMovCtas) ? r.consMovCtas : []) as any[]
  const encabezado = filas.find((f) => String(f?.descripcion ?? "").toUpperCase() === "ENCABEZADO")
  const movimientos: MovimientoCredicoop[] = []
  for (const f of filas) {
    if (f === encabezado) continue
    const fecha = fechaDesdeBanco(f?.fecha), monto = montoDesdeBanco(f?.monto)
    const sentido = String(f?.indDBCR ?? "").toUpperCase()
    if (!fecha || monto == null || (sentido !== "DB" && sentido !== "CR")) continue
    movimientos.push({
      fecha, descripcion: String(f?.descripcion ?? "").trim(), monto: sentido === "DB" ? -Math.abs(monto) : Math.abs(monto),
      saldo: montoDesdeBanco(f?.saldo), nroComprobante: String(f?.nroComprobante ?? "").trim(),
      codOperativo: String(f?.codOperativo ?? "").trim(), idTransaccion: String(f?.idTransaccion ?? "").trim(),
    })
  }
  return { movimientos, saldo: encabezado ? montoDesdeBanco(encabezado.saldo) : null, parcial: Array.isArray(r.alerta) && r.alerta.length > 0 }
}

export interface VepCredicoop {
  numeroVep: string; estado: string; descripcion: string; concepto: string; periodoFiscal: string
  /** ISO, o null si el banco lo mandó en un formato que no se entiende */
  vence: string | null
  monto: number | null; moneda: string; cuitContribuyente: string; cuitOriginante: string
}
export function leerVeps(respuesta: unknown): VepCredicoop[] {
  const lista = ((respuesta as any)?.data?.veps ?? []) as any[]
  return (Array.isArray(lista) ? lista : []).map((v) => {
    // "02/07/25 - 15:25:43" → 2025-07-02
    const m = /^(\d{2})\/(\d{2})\/(\d{2,4})/.exec(String(v?.fechaVencimiento ?? ""))
    return {
      numeroVep: String(v?.numeroVep ?? ""), estado: String(v?.estado ?? ""), descripcion: String(v?.descripcion ?? ""),
      concepto: String(v?.concepto ?? ""), periodoFiscal: String(v?.periodoFiscal ?? ""),
      vence: m ? `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2]}-${m[1]}` : null,
      monto: montoDesdeBanco(v?.monto), moneda: String(v?.moneda ?? "ARS"),
      cuitContribuyente: String(v?.cuitContribuyente ?? ""), cuitOriginante: String(v?.cuitOriginante ?? ""),
    }
  })
}

export interface EcheqListado {
  idCheque: string; numero: string; cmc7: string; estado: string; banco: string
  fechaPago: string | null; monto: number | null; emisorCuit: string; emisorNombre: string; moneda: string
}
export function leerEcheqs(respuesta: unknown): { echeqs: EcheqListado[]; total: number } {
  const data = ((respuesta as any)?.data ?? {}) as any
  const lista = (Array.isArray(data.echeqs) ? data.echeqs : []) as any[]
  return {
    total: Number(data.totalCheques) || lista.length,
    echeqs: lista.map((c) => ({
      idCheque: String(c?.chequeId ?? c?.idCheque ?? ""), numero: String(c?.numeroCheque ?? ""), cmc7: String(c?.cmc7completo ?? ""),
      estado: String(c?.estado ?? ""), banco: String(c?.bancoNombre ?? ""),
      fechaPago: String(c?.fechaPago?.value ?? "").slice(0, 10) || null, monto: montoDesdeBanco(c?.monto),
      emisorCuit: String(c?.emisorCuit ?? ""), emisorNombre: String(c?.emisorRazonSocial ?? ""), moneda: String(c?.moneda ?? "ARS"),
    })),
  }
}
