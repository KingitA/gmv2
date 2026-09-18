import { App } from "@capacitor/app"
import { Capacitor } from "@capacitor/core"

/**
 * Botón ATRÁS físico de Android (ver MOBILE.md → "Navegación").
 *
 * Regla: atrás SIEMPRE va a la pantalla visual anterior, que es la entrada
 * anterior del historial (toda pantalla/overlay es una entrada: ver hooks.ts).
 *  1. Si hay historial propio (idx > 0) → history.back()
 *  2. Si no hay historial pero no estamos en la raíz (se abrió directo en un
 *     detalle, p. ej. desde una notificación) → ir al PADRE lógico con replace
 *  3. En la raíz del módulo → minimizar la app (no se cierra: el outbox sigue
 *     vivo y al volver está todo como estaba)
 * El bundle solo contiene las rutas del módulo: no existe ninguna ruta del ERP
 * a la que atrás pueda llevar.
 */

export interface RouterMin {
  state: { location: { pathname: string } }
  navigate(to: number): unknown
  navigate(to: string, opts?: { replace?: boolean }): unknown
}

/** Padre lógico de una ruta: "/viajes/12/clientes/7" → "/viajes/12/clientes" → ... */
export function padreDe(pathname: string, raiz = "/"): string {
  const partes = pathname.replace(/\/+$/, "").split("/").filter(Boolean)
  if (partes.length <= 1) return raiz
  partes.pop()
  return "/" + partes.join("/")
}

export function indiceHistorial(): number {
  const st = typeof window !== "undefined" ? window.history.state : null
  return typeof st?.idx === "number" ? st.idx : 0
}

export function decidirAtras(pathname: string, idx: number, raiz = "/"): { accion: "back" } | { accion: "padre"; a: string } | { accion: "minimizar" } {
  if (idx > 0) return { accion: "back" }
  const limpio = pathname.replace(/\/+$/, "") || "/"
  if (limpio !== raiz) return { accion: "padre", a: padreDe(limpio, raiz) }
  return { accion: "minimizar" }
}

export function instalarBotonAtras(router: RouterMin, opts: { raiz?: string; enRaiz?: () => void } = {}): () => void {
  const raiz = opts.raiz ?? "/"
  const manejar = () => {
    const d = decidirAtras(router.state.location.pathname, indiceHistorial(), raiz)
    if (d.accion === "back") router.navigate(-1)
    else if (d.accion === "padre") router.navigate(d.a, { replace: true })
    else if (opts.enRaiz) opts.enRaiz()
    else if (Capacitor.isNativePlatform()) void App.minimizeApp()
  }
  if (!Capacitor.isNativePlatform()) return () => {}
  const h = App.addListener("backButton", manejar)
  return () => void h.then((x) => x.remove())
}
