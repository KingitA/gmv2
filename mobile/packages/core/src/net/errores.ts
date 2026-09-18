/** Sin red, timeout o servidor inalcanzable: la operación se puede reintentar. */
export class ErrorRed extends Error {
  readonly reintentable = true
  constructor(message = "Sin conexión con el servidor") {
    super(message)
  }
}

/** Respuesta HTTP no-2xx. */
export class ErrorHttp extends Error {
  constructor(public status: number, public body: any, message?: string) {
    super(message || body?.error || `HTTP ${status}`)
  }
  get reintentable() {
    // 408/425/429 y 5xx son transitorios; el resto de 4xx no mejora reintentando
    return this.status >= 500 || this.status === 408 || this.status === 425 || this.status === 429 || (this.status === 409 && this.body?.reintentable === true)
  }
}

/** La sesión fue revocada o venció sin poder renovarse: hay que volver al login. */
export class ErrorSesion extends Error {
  constructor(message = "La sesión expiró. Volvé a ingresar.") {
    super(message)
  }
}
