/** Emisor mínimo de cambios (para que React re-renderice vía useSyncExternalStore). */
export class Emisor {
  private oyentes = new Set<() => void>()
  suscribir = (fn: () => void) => {
    this.oyentes.add(fn)
    return () => void this.oyentes.delete(fn)
  }
  emitir() {
    for (const fn of [...this.oyentes]) {
      try {
        fn()
      } catch (e) {
        console.error(e)
      }
    }
  }
}

export function uuidv4(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c?.randomUUID) return c.randomUUID()
  const b = new Uint8Array(16)
  c!.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
