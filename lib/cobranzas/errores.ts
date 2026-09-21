// Clasificación de los errores de las RPC de cobranzas (cobranza_crear / cobranza_anular).
//
// Las RPC rechazan por REGLA DE NEGOCIO con `RAISE EXCEPTION` a secas ⇒ SQLSTATE P0001
// (comprobante anulado, no es del cliente, lo imputado supera el pago…). Repetir el
// mismo pedido va a dar siempre lo mismo: es una respuesta DEFINITIVA. Cualquier otro
// error (red, timeout 57014, deadlock 40P01, serialización 40001, 5xx de PostgREST…) es
// TRANSITORIO: reintentar puede andar.
//
// Por qué importa: la app Vendedor encola los cobros hechos sin señal y reintenta los
// transitorios en orden (FIFO). Si un rechazo de negocio viaja como 500, ese cobro se
// reintenta para siempre y TRABA todo lo que el vendedor cargó después (MOBILE.md §18).
//
// Puro (sin imports): lo testea mobile/packages/core/test/cobranzas-errores.test.ts.

export const SQLSTATE_REGLA_NEGOCIO = "P0001"

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

/**
 * Error a lanzar ante el `error` que devolvió `supabase.rpc(nombre, …)`. El mensaje es el
 * de siempre (`<rpc>: <mensaje>`): lo único nuevo es la CLASE cuando es regla de negocio.
 */
export function errorDeRpcCobranza(nombre: string, error: { code?: string | null; message?: string | null }): Error {
  const mensaje = `${nombre}: ${error.message || "error desconocido"}`
  return esReglaDeNegocio(error) ? new ErrorReglaCobranza(mensaje) : new Error(mensaje)
}

/** Texto para el vendedor: sin el prefijo técnico de la RPC. */
export function mensajeParaUsuario(e: Error): string {
  return e.message.replace(/^cobranza_(crear|anular):\s*/, "")
}
