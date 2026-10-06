// Errores de REGLA de negocio al tomar/editar un pedido (no transitorios): el
// cliente no tiene lista asignada, una lista no permitida, etc. El outbox de la
// app los convierte en rechazo definitivo (si fueran Error común, el equipo los
// reintentaría para siempre y trabaría su cola).
export class ErrorReglaPedido extends Error {
  readonly reglaPedido = true
  constructor(message: string) {
    super(message)
    this.name = "ErrorReglaPedido"
  }
}

export function esErrorReglaPedido(e: unknown): e is ErrorReglaPedido {
  return !!e && (e instanceof ErrorReglaPedido || (e as any).reglaPedido === true)
}

export const MSG_SIN_LISTA =
  "El cliente no tiene lista de precios asignada. Asignale una lista antes de tomar el pedido."
