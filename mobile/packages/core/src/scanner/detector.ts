/**
 * Detector de ráfagas "keyboard wedge" (lector que tipea el código + Enter).
 * Portado de lib/hooks/useBarcodeScanner.ts del ERP, sin React ni DOM, para
 * poder testearlo con tiempos simulados. Distingue el lector del tecleo humano
 * por el tiempo entre teclas.
 */

export interface OpcionesDetector {
  /** Largo mínimo del código (evita ruido). Default 3 */
  minLength?: number
  /** Tecla de fin de lectura. Default "Enter" */
  endKey?: string
  /** Gap máximo entre teclas de la misma ráfaga, ms. Default 60 */
  maxInterKeyMs?: number
}

export interface TeclaMin {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
}

export class DetectorWedge {
  private buffer = ""
  private ultima = -Infinity
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private onCodigo: (codigo: string) => void,
    private opts: OpcionesDetector = {},
    private reloj: () => number = () => performance.now(),
  ) {}

  /** Procesa una tecla. Devuelve true si la consumió (hay que preventDefault). */
  tecla(e: TeclaMin): boolean {
    const { endKey = "Enter", maxInterKeyMs = 60 } = this.opts
    const ahora = this.reloj()
    // Resync: si pasó mucho desde la última tecla no es una ráfaga del lector
    if (ahora - this.ultima > maxInterKeyMs) this.buffer = ""
    this.ultima = ahora

    if (e.key === endKey) {
      if (this.buffer.length > 0) {
        this.cerrar()
        return true
      }
      return false
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      this.buffer += e.key
      // Lectores sin sufijo Enter: cierre por inactividad
      this.limpiarTimer()
      this.timer = setTimeout(() => this.cerrar(), maxInterKeyMs + 40)
    }
    return false
  }

  cerrar() {
    this.limpiarTimer()
    const codigo = this.buffer.trim()
    this.buffer = ""
    if (codigo.length >= (this.opts.minLength ?? 3)) this.onCodigo(codigo)
  }

  reset() {
    this.limpiarTimer()
    this.buffer = ""
  }

  private limpiarTimer() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}

/**
 * true si el texto parece un QR/URL y no un código de barras (EAN/DUN).
 * Copia de lib/utils/scan-guard.ts (el ERP web lo sigue usando).
 */
export function esQrOUrl(raw: string): boolean {
  const s = (raw || "").trim()
  if (!s) return false
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return true
  if (s.includes("://")) return true
  if (/\s/.test(s)) return true
  if (/^(www\.|mailto:|tel:|geo:|smsto:|sms:|wifi:|begin:|matmsg:)/i.test(s)) return true
  if (s.length > 18 && !/^\d+$/.test(s)) return true
  return false
}
