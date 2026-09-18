import { Capacitor } from "@capacitor/core"
import { Network } from "@capacitor/network"
import { Emisor } from "../emitter"

export interface Conectividad {
  readonly online: boolean
  suscribir(fn: () => void): () => void
}

/**
 * Estado de red. En el dispositivo usa @capacitor/network (ConnectivityManager:
 * distingue "WiFi sin internet" mejor que navigator.onLine); en el navegador,
 * los eventos online/offline. "online" es optimista: el que decide de verdad es
 * el request (ErrorRed) — esto solo evita intentar cuando es obvio que no hay red.
 */
export async function crearConectividad(): Promise<Conectividad> {
  const emisor = new Emisor()
  let online = typeof navigator !== "undefined" ? navigator.onLine : true
  const set = (v: boolean) => {
    if (v !== online) {
      online = v
      emisor.emitir()
    }
  }
  if (Capacitor.isNativePlatform()) {
    try {
      online = (await Network.getStatus()).connected
      await Network.addListener("networkStatusChange", (s) => set(s.connected))
    } catch {
      /* plugin ausente: fallback a eventos del WebView */
    }
  }
  if (typeof window !== "undefined") {
    window.addEventListener("online", () => set(true))
    window.addEventListener("offline", () => set(false))
  }
  return {
    get online() {
      return online
    },
    suscribir: emisor.suscribir,
  }
}
