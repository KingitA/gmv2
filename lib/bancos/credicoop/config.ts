/**
 * Conexión con Credicoop: de dónde salen las credenciales. SOLO SERVIDOR.
 *
 * Todo viene de variables de entorno (Vercel → Settings → Environment Variables). La clave
 * privada NUNCA se guarda en la base ni en el repositorio.
 *
 *   CREDICOOP_CLIENT_ID          identificador de la conexión (lo da el banco)
 *   CREDICOOP_CLAVE_PRIVADA      clave privada RSA en PEM. Se puede pegar con los saltos de línea
 *                                como "\n", o entera en base64
 *   CREDICOOP_NUMERO_ADHERENTE   número de adherente de Banca Internet Empresa
 *   CREDICOOP_URL                URL del ambiente. Sin definir = homologación
 *   CREDICOOP_REALM              realm del ambiente. Sin definir = "homologacion"
 *   CREDICOOP_FIRMANTES          opcional: firmantes a proponer, "DNI:21123456,CUIT:20211234569"
 *   CREDICOOP_SIMULADOR          "1" = no se habla con el banco: contesta el simulador (para
 *                                probar las pantallas sin credenciales). Lo hecho así queda
 *                                marcado "simulador" y no mueve plata.
 *
 * Sin credenciales (y sin simulador) → "Credicoop no está conectado" y NO se manda nada.
 */
import { crearClienteCredicoop, type ClienteCredicoop, type ConfigCredicoop, type FetchBanco } from "./cliente"
import { ErrorCredicoop, REALM_HOMOLOGACION, URL_HOMOLOGACION } from "./nucleo"
import { crearSimuladorCredicoop, type SimuladorCredicoop } from "./simulador"

export type AmbienteCredicoop = "simulador" | "homologacion" | "produccion"

export interface EstadoConexion {
  conectado: boolean
  ambiente: AmbienteCredicoop | null
  /** Qué falta, en palabras, si no está conectado */
  falta: string[]
  numeroAdherente: number | null
  /** El simulador está encendido en el sistema REAL: nada de lo que se mande llega al banco */
  simulador_en_produccion: boolean
}

/** ¿Este servidor es el sistema real (el que usa la oficina)? */
const esSistemaReal = () => process.env.VERCEL_ENV === "production" || (!process.env.VERCEL_ENV && process.env.NODE_ENV === "production")

/** La clave puede venir en PEM con "\n" escritos, o entera en base64. */
function leerClave(v: string | undefined): string {
  const s = String(v ?? "").trim()
  if (!s) return ""
  if (s.includes("BEGIN")) return s.replace(/\\n/g, "\n")
  try {
    const d = Buffer.from(s, "base64").toString("utf8")
    return d.includes("BEGIN") ? d : ""
  } catch { return "" }
}

function leerFirmantes(v: string | undefined) {
  return String(v ?? "").split(",").map((x) => x.trim()).filter(Boolean).map((x) => {
    const [tipo, doc] = x.split(":").map((y) => y.trim())
    return { documentoTipo: (tipo || "").toUpperCase(), documento: (doc || "").replace(/[^0-9]/g, "") }
  }).filter((f) => f.documento && ["CUIT", "CUIL", "CDI", "DNI", "LC", "PE", "CI", "LE"].includes(f.documentoTipo))
}

const esSimulador = () => process.env.CREDICOOP_SIMULADOR === "1"

export function estadoConexion(): EstadoConexion {
  const adherente = Number(process.env.CREDICOOP_NUMERO_ADHERENTE) || null
  if (esSimulador()) return { conectado: true, ambiente: "simulador", falta: [], numeroAdherente: adherente ?? 1234, simulador_en_produccion: esSistemaReal() }
  const falta: string[] = []
  if (!process.env.CREDICOOP_CLIENT_ID?.trim()) falta.push("el identificador de la conexión (CREDICOOP_CLIENT_ID)")
  if (!leerClave(process.env.CREDICOOP_CLAVE_PRIVADA)) falta.push("la clave privada (CREDICOOP_CLAVE_PRIVADA)")
  if (!adherente) falta.push("el número de adherente (CREDICOOP_NUMERO_ADHERENTE)")
  const url = (process.env.CREDICOOP_URL || URL_HOMOLOGACION).trim()
  return {
    conectado: falta.length === 0,
    ambiente: falta.length ? null : /homo/i.test(url) ? "homologacion" : "produccion",
    falta, numeroAdherente: adherente, simulador_en_produccion: false,
  }
}

/** El simulador en uso (solo en modo simulador): para cargarle las operaciones guardadas antes de consultar. */
export function simuladorEnUso(): SimuladorCredicoop | null {
  if (!esSimulador()) return null
  simulador ??= crearSimuladorCredicoop()
  return simulador
}

/** Segundos después del envío en que el simulador da por firmada una operación (depende de la hora, no de la memoria). */
export const SIMULADOR_FIRMA_A_LOS_SEGUNDOS = 60

// Un simulador y un cliente por proceso: el token (30 minutos) y el contador de pedidos por
// minuto se comparten entre los pedidos que atiende el mismo servidor.
let simulador: SimuladorCredicoop | null = null
let cliente: { clave: string; cliente: ClienteCredicoop } | null = null

const fetchReal: FetchBanco = async (url, init) => {
  const r = await fetch(url, init)
  return { status: r.status, text: () => r.text() }
}

/**
 * El cliente listo para usar. Lanza ErrorCredicoop("SIN_CONEXION") si faltan las credenciales:
 * quien llama corta ahí y no manda nada.
 */
export function clienteCredicoop(): { cliente: ClienteCredicoop; ambiente: AmbienteCredicoop } {
  const estado = estadoConexion()
  if (!estado.conectado || !estado.ambiente) {
    throw new ErrorCredicoop(`Credicoop no está conectado: falta cargar ${estado.falta.join(", ")}. No se mandó nada al banco.`, "SIN_CONEXION")
  }
  if (estado.ambiente === "simulador") {
    simulador ??= crearSimuladorCredicoop()
    const config: ConfigCredicoop = { baseUrl: URL_HOMOLOGACION, realm: REALM_HOMOLOGACION, clientId: "simulador", clavePrivada: "simulador", numeroAdherente: estado.numeroAdherente ?? 1234, firmantes: leerFirmantes(process.env.CREDICOOP_FIRMANTES) }
    const clave = "simulador"
    if (cliente?.clave !== clave) cliente = { clave, cliente: crearClienteCredicoop(config, { fetch: simulador.fetch, firmar: () => "firma-simulada" }) }
    return { cliente: cliente.cliente, ambiente: "simulador" }
  }
  const config: ConfigCredicoop = {
    baseUrl: (process.env.CREDICOOP_URL || URL_HOMOLOGACION).trim().replace(/\/+$/, ""),
    realm: (process.env.CREDICOOP_REALM || REALM_HOMOLOGACION).trim(),
    clientId: process.env.CREDICOOP_CLIENT_ID!.trim(),
    clavePrivada: leerClave(process.env.CREDICOOP_CLAVE_PRIVADA),
    numeroAdherente: estado.numeroAdherente!,
    firmantes: leerFirmantes(process.env.CREDICOOP_FIRMANTES),
  }
  const clave = `${config.baseUrl}|${config.realm}|${config.clientId}|${config.numeroAdherente}`
  if (cliente?.clave !== clave) cliente = { clave, cliente: crearClienteCredicoop(config, { fetch: fetchReal }) }
  return { cliente: cliente.cliente, ambiente: estado.ambiente }
}
