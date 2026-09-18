import { App } from "@capacitor/app"
import { Capacitor } from "@capacitor/core"

/** Notifica primer plano / segundo plano (dispositivo: App.appStateChange; web: visibilitychange). */
export function alCambiarPrimerPlano(fn: (activo: boolean) => void): () => void {
  if (Capacitor.isNativePlatform()) {
    const h = App.addListener("appStateChange", (s) => fn(s.isActive))
    return () => void h.then((x) => x.remove())
  }
  const onVis = () => fn(document.visibilityState === "visible")
  document.addEventListener("visibilitychange", onVis)
  return () => document.removeEventListener("visibilitychange", onVis)
}
