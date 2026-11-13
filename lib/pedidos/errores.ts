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

// Juan 13/11/2026: "No hay valor = vacío". Antes un pedido sin método se calculaba como
// "Final" sin avisar (pedidos 002164/65/66/70, importados).
export const MSG_SIN_METODO =
  "El cliente no tiene método de facturación asignado. Asignale uno en la ficha (o elegilo para este pedido) antes de tomar el pedido."
