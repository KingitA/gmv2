/**
 * Numeración de comprobantes de venta sin repetidos (P2-22).
 *
 * Todo número de comprobante sale de acá — nunca leer ultimo_numero, sumarle 1
 * y guardarlo después (dos máquinas a la vez leían el mismo número).
 *
 *  - Internos (PRES, REV, …): reservarNumero → numeracion_reservar, que avanza
 *    el contador en la base de una sola vez. Si después el alta falla, el número
 *    queda salteado (hueco en un documento interno, nunca un repetido).
 *  - Fiscales (con CAE): tomarTurnoFiscal → un turno por (tipo, punto de venta)
 *    mientras dura el pedido de CAE a ARCA. El número es el último autorizado en
 *    ARCA + 1: si ARCA rechaza, no se consume y no quedan huecos. El turno se
 *    suelta apenas el comprobante queda grabado (soltar es idempotente: llamarlo
 *    también en un finally) y vence solo si la máquina se cuelga.
 *
 * Migración: supabase/migrations/20261029_numeracion_atomica.sql
 */

/** Vencimiento del turno fiscal: más que un pedido de CAE lento. */
const TURNO_SEGUNDOS = 90
/** Cuánto espera una máquina su turno antes de rendirse. */
const ESPERA_MAX_MS = 60_000

export function formatoNumeroComprobante(puntoVenta: string, numero: number): string {
  return `${puntoVenta}-${numero.toString().padStart(8, "0")}`
}

/** Reserva el próximo número de un comprobante interno (sin CAE). */
export async function reservarNumero(supabase: any, tipo: string, puntoVenta: string): Promise<number> {
  const { data, error } = await supabase.rpc("numeracion_reservar", { p_tipo: tipo, p_punto_venta: puntoVenta })
  if (error || typeof data !== "number") {
    throw new Error(`No se pudo numerar ${tipo} punto de venta ${puntoVenta}: ${error?.message ?? "sin número"}`)
  }
  return data
}

export interface TurnoFiscal {
  /** Número a pedirle a ARCA (último autorizado + 1). */
  readonly numero: number
  /** Llamar apenas ARCA dio el CAE: el número quedó consumido en ARCA. */
  marcarUsado(): void
  /** Suelta el turno (idempotente). Deja el contador local igual al de ARCA. */
  soltar(): Promise<void>
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Espera el turno fiscal de (tipo, punto de venta) y devuelve el número a emitir.
 * `ultimoEnArca` consulta FECompUltimoAutorizado: se llama ya con el turno tomado.
 */
export async function tomarTurnoFiscal(
  supabase: any,
  tipo: string,
  puntoVenta: string,
  ultimoEnArca: () => Promise<number>,
): Promise<TurnoFiscal> {
  const limite = Date.now() + ESPERA_MAX_MS
  let token: string | null = null
  for (let intento = 0; ; intento++) {
    const { data, error } = await supabase.rpc("numeracion_tomar_turno", {
      p_tipo: tipo, p_punto_venta: puntoVenta, p_segundos: TURNO_SEGUNDOS,
    })
    if (error) throw new Error(`No se pudo tomar el turno de ${tipo} punto de venta ${puntoVenta}: ${error.message}`)
    if (data) { token = data as string; break }
    if (Date.now() > limite) {
      throw new Error(
        `Hay otro ${tipo} emitiéndose en el punto de venta ${puntoVenta} hace más de un minuto. ` +
        `Esperá un momento y volvé a intentar. No se emitió nada.`
      )
    }
    // Espera corta con algo de azar para que las máquinas no se pisen al reintentar
    await esperar(Math.min(250 + intento * 100, 1000) + Math.random() * 250)
  }

  let usado = false
  let suelto = false
  let ultimo: number
  try {
    ultimo = await ultimoEnArca()
  } catch (e) {
    await supabase.rpc("numeracion_soltar_turno", {
      p_tipo: tipo, p_punto_venta: puntoVenta, p_token: token, p_ultimo_numero: null,
    })
    throw e
  }

  return {
    numero: ultimo + 1,
    marcarUsado() { usado = true },
    async soltar() {
      if (suelto) return
      suelto = true
      const { error } = await supabase.rpc("numeracion_soltar_turno", {
        p_tipo: tipo, p_punto_venta: puntoVenta, p_token: token,
        p_ultimo_numero: usado ? ultimo + 1 : ultimo,
      })
      // No se corta la emisión: el turno vence solo y el próximo resincroniza con ARCA
      if (error) console.error(`[numeracion] no se pudo soltar el turno ${tipo} ${puntoVenta}:`, error.message)
    },
  }
}
