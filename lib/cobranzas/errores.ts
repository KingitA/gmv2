// Clasificación de los errores de las RPC de cobranzas (cobranza_crear / cobranza_anular).
//
// Las RPC rechazan por REGLA DE NEGOCIO con `RAISE EXCEPTION` a secas ⇒ SQLSTATE P0001
// (comprobante anulado, no es del cliente, lo imputado supera el pago…). Repetir el
// mismo pedido va a dar siempre lo mismo: es una respuesta DEFINITIVA. Cualquier otro
// error (red, timeout 57014, deadlock 40P01, serialización 40001, 5xx de PostgREST…) es
// TRANSITORIO: reintentar puede andar.
//
// Un CHEQUE YA REGISTRADO (violación de unicidad de `cheques`, SQLSTATE 23505) también es
// definitivo: volver a mandar el mismo cobro va a chocar siempre con el mismo cheque.
// Antes viajaba como 500 con el texto crudo de Postgres ("duplicate key value violates
// unique constraint…"): la web lo mostraba tal cual y la app lo reintentaba para siempre.
//
// Por qué importa: las apps Vendedor y Chofer encolan los cobros hechos sin señal y
// reintentan los transitorios en orden (FIFO). Si un rechazo definitivo viaja como 500,
// ese cobro se reintenta para siempre y TRABA todo lo cargado después (MOBILE.md §18/§19).
//
// Puro (sin imports): lo testea mobile/packages/core/test/vendedor-reglas.test.ts.

export const SQLSTATE_REGLA_NEGOCIO = "P0001"
export const SQLSTATE_UNICIDAD = "23505"

/** Rechazo definitivo de una RPC de cobranzas: no reintentar, mostrárselo a quien cobró. */
export class ErrorReglaCobranza extends Error {
  readonly codigo = "regla_negocio"
  constructor(message: string) {
    super(message)
    this.name = "ErrorReglaCobranza"
  }
}

export function esReglaDeNegocio(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === SQLSTATE_REGLA_NEGOCIO
}

export interface ErrorRpc {
  code?: string | null
  message?: string | null
  details?: string | null
  hint?: string | null
}

/**
 * ¿Es una violación de unicidad sobre la tabla `cheques` (cheque ya registrado)?
 * Devuelve la clave que chocó, leída del `details` de Postgres
 * ("Key (banco, numero)=(Santander, 11400260) already exists."), o {} si no se puede leer.
 * null ⇒ no es un cheque duplicado.
 */
export function chequeDuplicadoDe(error: ErrorRpc | null | undefined): Record<string, string> | null {
  if (!error || error.code !== SQLSTATE_UNICIDAD) return null
  const texto = `${error.message || ""} ${error.details || ""} ${error.hint || ""}`
  if (!/cheque/i.test(texto)) return null
  const m = /Key \(([^)]+)\)=\(([^)]*)\)/.exec(error.details || error.message || "")
  if (!m) return {}
  const columnas = m[1]!.split(",").map((s) => s.trim())
  const valores = m[2]!.split(",").map((s) => s.trim())
  const clave: Record<string, string> = {}
  columnas.forEach((c, i) => {
    if (valores[i] !== undefined) clave[c] = valores[i]!
  })
  return clave
}

/**
 * Error a lanzar ante el `error` que devolvió `supabase.rpc(nombre, …)`. El mensaje es el
 * de siempre (`<rpc>: <mensaje>`): lo único nuevo es la CLASE cuando es regla de negocio
 * o cheque duplicado (definitivos).
 */
export function errorDeRpcCobranza(nombre: string, error: ErrorRpc): Error {
  // Los RAISE de las RPC ya traen el prefijo "<rpc>: " (verificado contra producción): no duplicarlo
  const crudo = error.message || "error desconocido"
  const mensaje = crudo.startsWith(`${nombre}:`) ? crudo : `${nombre}: ${crudo}`
  if (esReglaDeNegocio(error)) return new ErrorReglaCobranza(mensaje)
  const dup = chequeDuplicadoDe(error)
  if (dup) return new ErrorReglaCobranza(mensajeChequeDuplicado(dup))
  return new Error(mensaje)
}

/** Texto en castellano para un cheque ya registrado; `donde` (cobro/cliente) se agrega si se pudo averiguar. */
export function mensajeChequeDuplicado(clave: Record<string, string>, donde?: { fecha?: string | null; cliente?: string | null; estado?: string | null } | null): string {
  const numero = clave.numero || clave.numero_cheque
  const banco = clave.banco
  const que = numero ? `El cheque N° ${numero}${banco ? ` (${banco})` : ""}` : "Ese cheque"
  let ref = ""
  if (donde) {
    const partes = [donde.fecha ? `cobro del ${String(donde.fecha).slice(0, 10).split("-").reverse().join("/")}` : "un cobro", donde.cliente ? `a ${donde.cliente}` : "", donde.estado ? `(${ESTADO_PAGO_TEXTO[donde.estado] || donde.estado})` : ""].filter(Boolean)
    ref = `: está en el ${partes.join(" ")}`
  }
  return `${que} ya está registrado${ref}. No se puede cargar dos veces: si es un error, hay que anular ese cobro desde oficina.`
}

const ESTADO_PAGO_TEXTO: Record<string, string> = {
  pendiente_rendicion: "pendiente de rendición",
  pendiente: "sin confirmar en oficina",
  confirmado: "confirmado",
  anulado: "anulado",
  rechazado: "rechazado",
}

/** Texto para el vendedor/chofer: sin el prefijo técnico de la RPC. */
export function mensajeParaUsuario(e: Error): string {
  return e.message.replace(/^(cobranza_(crear|anular):\s*)+/, "")
}
