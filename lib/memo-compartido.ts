/**
 * Memoria corta, en el servidor, para respuestas que son IGUALES para todos los
 * que las piden (P2-49). Ej.: el dataset vendedor_catalogos no tiene log de
 * cambios: en cada sync de cada equipo se arma entero para comparar el hash. Sin
 * esto, 10 equipos sincronizando a la vez = 10 veces las mismas consultas.
 *
 * - Lo que se está consultando se comparte: si 5 equipos piden a la vez, va UNA
 *   consulta a la base y los 5 esperan esa misma respuesta.
 * - Un error no queda guardado (el próximo pedido vuelve a intentar).
 * - Vive mientras viva la instancia del servidor; cada instancia tiene la suya.
 *
 * Solo para datos que no dependen de quién pide (nada con vendedorIds ni roles).
 */

type Entrada = { vence: number; valor: Promise<unknown> }

const memoria = new Map<string, Entrada>()

export function memoCompartido<T>(clave: string, ttlMs: number, cargar: () => Promise<T>): Promise<T> {
  const ahora = Date.now()
  const e = memoria.get(clave)
  if (e && e.vence > ahora) return e.valor as Promise<T>
  const valor = cargar()
  memoria.set(clave, { vence: ahora + ttlMs, valor })
  valor.catch(() => {
    if (memoria.get(clave)?.valor === valor) memoria.delete(clave)
  })
  return valor
}
