import type { Db } from "../db/idb"
import { kvGet, kvSet } from "../db/idb"

/**
 * Reloj corregido contra el servidor.
 *
 * El timestamp de captura (capturado_at) decide qué precios rigen para un
 * pedido offline, y los cambios programados se aplican "a la hora exacta".
 * Si el reloj del handheld está corrido, ambos fallan. Cada vez que hay red se
 * mide el desfasaje (server_time de /api/mobile/sync/estado, corrigiendo por la
 * mitad del RTT) y se persiste; offline se usa el último desfasaje conocido.
 */
export class Reloj {
  private skewMs = 0

  constructor(private db: Db) {}

  async cargar() {
    this.skewMs = (await kvGet<number>(this.db, "reloj.skewMs")) ?? 0
  }

  /** Registrar una medición: serverIso recibido entre t0 y t1 (Date.now del dispositivo). */
  async medir(serverIso: string, t0: number, t1: number) {
    const server = Date.parse(serverIso)
    if (!Number.isFinite(server)) return
    const skew = server - (t0 + (t1 - t0) / 2)
    // Ignorar ruido de red: solo actualizar si cambia más de 1 s
    if (Math.abs(skew - this.skewMs) > 1000) {
      this.skewMs = skew
      await kvSet(this.db, "reloj.skewMs", skew)
    }
  }

  /** Desfasaje actual (servidor − dispositivo), en ms */
  get desfasajeMs() {
    return this.skewMs
  }

  ahora = (): number => Date.now() + this.skewMs
}
