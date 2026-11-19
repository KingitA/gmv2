/**
 * Cliente de la API Empresas de Banco Credicoop. SOLO SERVIDOR (firma con la clave privada).
 *
 *  - Autenticación: OAuth2 client_credentials con client_assertion, un JWT firmado RS256 con la
 *    clave privada de la empresa (iss = sub = clientId, aud = realm, vale 60 segundos). El banco
 *    devuelve un token de 30 minutos, sin renovación: se guarda en memoria y se pide otro al vencer.
 *  - Tope del banco: 50 pedidos por minuto en total. Si se llega, NO se manda el pedido.
 *  - Todo lo que mueve plata va por las rutas /ConFirma/ (ver nucleo.ts): queda esperando la
 *    firma con token en Banca Internet Empresa.
 *  - Un corte o un error del banco al ENVIAR deja la operación en duda: se informa como
 *    INCIERTO y hay que consultar el estado (por idOrigen) antes de reintentar.
 *
 * La clave privada llega por parámetro (sale de una variable de entorno, ver config.ts): nunca
 * se guarda en la base ni en el repositorio, y nunca se escribe en un registro.
 */
import { createSign, randomUUID } from "node:crypto"
import {
  ErrorCredicoop, errorDelBanco, leerCuentas, leerEcheqs, leerMovimientos, leerOperacion, leerVeps, fechaBanco,
  PEDIDOS_POR_MINUTO, RUTAS, SCOPES, type AmbitoCredicoop,
} from "./nucleo"

export interface ConfigCredicoop {
  /** URL del ambiente, sin barra final (homologación: https://homoapibccl.bancocredicoop.coop) */
  baseUrl: string
  /** Realm del ambiente (homologación: "homologacion") */
  realm: string
  clientId: string
  /** Clave privada RSA en formato PEM */
  clavePrivada: string
  numeroAdherente: number
  firmantes?: Array<{ documento: string; documentoTipo: string }>
}

/** Lo mínimo de fetch que usa el cliente (así el simulador y los tests lo reemplazan). */
export type FetchBanco = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) =>
  Promise<{ status: number; text: () => Promise<string> }>

export interface Dependencias {
  fetch: FetchBanco
  /** Milisegundos (para los tests) */
  ahora?: () => number
  uuid?: () => string
  /** Firma del JWT (para los tests, que no tienen la clave del banco) */
  firmar?: (datos: string, clavePrivada: string) => string
  tiempoMaximoMs?: number
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url")

/** Firma RS256 con la clave privada. El error nunca incluye la clave. */
function firmarRS256(datos: string, clavePrivada: string): string {
  try {
    return createSign("RSA-SHA256").update(datos).sign(clavePrivada).toString("base64url")
  } catch {
    throw new ErrorCredicoop("La clave privada de Credicoop no es válida (tiene que ser una clave RSA en formato PEM). Avisá a sistemas.", "SIN_CONEXION")
  }
}

/** JWT que identifica a la empresa ante el banco. Vale 60 segundos y sirve para UN pedido de token. */
export function armarJwt(config: Pick<ConfigCredicoop, "baseUrl" | "realm" | "clientId" | "clavePrivada">, deps: Pick<Dependencias, "ahora" | "uuid" | "firmar"> = {}): string {
  const iat = Math.floor((deps.ahora?.() ?? Date.now()) / 1000)
  const cabecera = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const cuerpo = b64url(JSON.stringify({
    iss: config.clientId, sub: config.clientId, aud: RUTAS.audiencia(config.baseUrl, config.realm),
    iat, exp: iat + 60, jti: (deps.uuid ?? randomUUID)(),
  }))
  const firma = (deps.firmar ?? firmarRS256)(`${cabecera}.${cuerpo}`, config.clavePrivada)
  return `${cabecera}.${cuerpo}.${firma}`
}

export type ClienteCredicoop = ReturnType<typeof crearClienteCredicoop>

export function crearClienteCredicoop(config: ConfigCredicoop, deps: Dependencias) {
  const ahora = deps.ahora ?? Date.now
  const tiempoMaximo = deps.tiempoMaximoMs ?? 25_000
  const tokens = new Map<string, { token: string; vence: number }>()
  const pedidos: number[] = []   // momentos de los últimos pedidos (tope de 50 por minuto)

  function anotarPedido() {
    const t = ahora()
    while (pedidos.length && pedidos[0] <= t - 60_000) pedidos.shift()
    if (pedidos.length >= PEDIDOS_POR_MINUTO) {
      throw new ErrorCredicoop("Se llegó al tope de 50 pedidos por minuto de Credicoop. No se mandó nada: esperá un minuto y probá de nuevo.", "LIMITE")
    }
    pedidos.push(t)
  }

  /** Un pedido HTTP. `enDuda` = qué decir si se corta: en un envío de plata no se sabe si entró. */
  async function pedir(url: string, init: Parameters<FetchBanco>[1], enDuda: boolean): Promise<{ status: number; cuerpo: unknown }> {
    anotarPedido()
    const control = new AbortController()
    const reloj = setTimeout(() => control.abort(), tiempoMaximo)
    try {
      const r = await deps.fetch(url, { ...init, signal: control.signal })
      const texto = await r.text()
      let cuerpo: unknown = null
      try { cuerpo = texto ? JSON.parse(texto) : null } catch { cuerpo = null }
      return { status: r.status, cuerpo }
    } catch (e) {
      if (e instanceof ErrorCredicoop) throw e
      throw new ErrorCredicoop(
        enDuda
          ? "Se cortó la comunicación con Credicoop y NO se sabe si la operación entró. Tocá “Actualizar estado” antes de volver a mandarla."
          : "No se pudo comunicar con Credicoop. Probá de nuevo en un momento.",
        enDuda ? "INCIERTO" : "RECHAZO")
    } finally {
      clearTimeout(reloj)
    }
  }

  async function token(ambito: AmbitoCredicoop): Promise<string> {
    const scope = SCOPES[ambito]
    const guardado = tokens.get(scope)
    if (guardado && guardado.vence > ahora() + 30_000) return guardado.token
    const cuerpo = new URLSearchParams({
      grant_type: "client_credentials", scope,
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: armarJwt(config, deps),
    }).toString()
    const r = await pedir(config.baseUrl + RUTAS.token(config.realm), {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: cuerpo,
    }, false)
    const t = (r.cuerpo ?? {}) as { access_token?: string; expires_in?: number; error_description?: string; error?: string }
    if (r.status >= 400 || !t.access_token) {
      const motivo = String(t.error_description ?? t.error ?? "").trim()
      throw new ErrorCredicoop(`Credicoop no aceptó las credenciales de conexión${motivo ? ` (${motivo})` : ""}. Avisá a sistemas: hay que revisar el identificador, la clave y los permisos de la conexión.`, "AUTORIZACION")
    }
    tokens.set(scope, { token: t.access_token, vence: ahora() + (Number(t.expires_in) || 1800) * 1000 })
    return t.access_token
  }

  async function api(ambito: AmbitoCredicoop, metodo: "GET" | "POST", ruta: string, opciones: { body?: unknown; query?: Record<string, string | number | null | undefined>; enDuda?: boolean } = {}): Promise<unknown> {
    const tk = await token(ambito)
    const q = Object.entries(opciones.query ?? {}).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&")
    const r = await pedir(config.baseUrl + ruta + (q ? `?${q}` : ""), {
      method: metodo,
      headers: { Accept: "application/json", Authorization: `Bearer ${tk}`, ...(opciones.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(opciones.body !== undefined ? { body: JSON.stringify(opciones.body) } : {}),
    }, opciones.enDuda === true)
    if (r.status === 401) tokens.delete(SCOPES[ambito])   // token vencido antes de tiempo: el próximo pedido saca otro
    if (r.status >= 400) throw errorDelBanco(r.status, r.cuerpo)
    if (r.cuerpo == null) {
      if (opciones.enDuda) throw new ErrorCredicoop("Credicoop contestó vacío y NO se sabe si la operación entró. Tocá “Actualizar estado” antes de volver a mandarla.", "INCIERTO")
      throw new ErrorCredicoop("Credicoop contestó algo que no se pudo leer. Probá de nuevo en un momento.", "RECHAZO")
    }
    return r.cuerpo
  }

  /** Consulta de una operación por su idOrigen (lo que hay que hacer ante un corte, antes de reintentar). */
  const consulta = (ambito: AmbitoCredicoop, ruta: string) => async (p: { idOrigen?: string | null; idOperacion?: string | null }) => {
    if (!p.idOrigen && !p.idOperacion) throw new ErrorCredicoop("Falta el identificador de la operación a consultar.", "DATOS")
    const cruda = await api(ambito, "GET", ruta, { query: { ...(p.idOperacion ? { idOperacion: p.idOperacion } : { idOrigen: p.idOrigen }), numeroAdherente: config.numeroAdherente } })
    return { cruda, resultado: leerOperacion(cruda) }
  }
  /** Envío de una operación con firma. */
  const envio = (ambito: AmbitoCredicoop, ruta: string) => async (pedido: unknown) => {
    const cruda = await api(ambito, "POST", ruta, { body: pedido, enDuda: true })
    return { cruda, resultado: leerOperacion(cruda) }
  }

  return {
    empresa: { numeroAdherente: config.numeroAdherente, firmantes: config.firmantes },

    /** Cuentas de la empresa con su saldo */
    async cuentas() { return leerCuentas(await api("cuentas", "GET", RUTAS.cuentas)) },
    /** Movimientos de una cuenta entre dos fechas (ISO) */
    async movimientos(nroCuenta: string, desde: string, hasta: string) {
      return leerMovimientos(await api("cuentas", "GET", RUTAS.movimientos(nroCuenta), { query: { fechaDesde: fechaBanco(desde), fechaHasta: fechaBanco(hasta) } }))
    },

    transferir: envio("transferencias", RUTAS.transferir),
    consultarTransferencia: consulta("transferencias", RUTAS.consultaTransferencia),

    emitirEcheq: envio("echeq", RUTAS.emitirEcheq),
    consultarEcheq: consulta("echeq", RUTAS.consultaEcheq),
    /** Aceptar, endosar, depositar o poner en custodia e-cheq recibidos */
    gestionarEcheq: envio("echeq", RUTAS.gestionEcheq),
    async listarEcheqs(pedido: unknown) { return leerEcheqs(await api("echeq", "POST", RUTAS.listarEcheqs, { body: pedido })) },
    /**
     * Nombre con que Credicoop tiene agendado a un beneficiario de e-cheq (por CUIT). El banco
     * rechaza la emisión si el nombre no coincide (APIE-1013), y en el sistema los proveedores
     * figuran "como los conocemos". null = no está en la agenda (APIE-8014).
     */
    async nombreBeneficiarioEcheq(cuit: string): Promise<string | null> {
      try {
        const r = await api("beneficiarioEcheq", "GET", RUTAS.beneficiarioEcheq(config.numeroAdherente), { query: { documento: String(cuit).replace(/[^0-9]/g, ""), documentoTipo: "CUIT" } })
        const nombre = String((r as { data?: { nombre?: unknown } })?.data?.nombre ?? "").trim()
        return nombre || null
      } catch (e) {
        if (e instanceof ErrorCredicoop && e.codigo === "APIE-8014") return null
        throw e
      }
    },

    async listarVeps(pedido: unknown) { return leerVeps(await api("vep", "POST", RUTAS.listarVeps, { body: pedido })) },
    pagarVep: envio("vep", RUTAS.pagarVep),
    consultarPagoVep: consulta("vep", RUTAS.consultaPagoVep),
  }
}
