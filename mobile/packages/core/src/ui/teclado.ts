import { useEffect, useState } from "react"

// TECLADO EN PANTALLA (P2-14 vendedor, P2-17 depósito; vale para las 3 apps, 29/10/2026).
//
// Con Android 15 y la app dibujada de borde a borde, el WebView NO se achica al abrir el
// teclado: el teclado TAPA el contenido. Un campo de la mitad de abajo y lo que está fijo
// abajo (pie, hojas con botones) quedan detrás. `instalarTeclado()` (lo llama montarApp,
// las apps no hacen nada):
//  1. le pide al WebView que achique el contenido con el teclado (viewport
//     `interactive-widget=resizes-content`): lo fijo abajo sube solo;
//  2. si igual quedó tapado, al enfocar un campo lo trae a la vista (scrollIntoView);
//  3. al CERRAR el teclado (botón atrás de Android) suelta el foco del campo: lo escrito se
//     confirma como al tocar afuera (onBlur). Ej.: la cantidad del catálogo (P2-12);
//  4. publica el alto del teclado en la variable CSS `--gm-teclado` (0px si el WebView ya
//     achicó el contenido): un elemento fijo abajo que no sube solo usa
//     `style={{ bottom: "var(--gm-teclado, 0px)" }}` o la clase `pb-[var(--gm-teclado,0px)]`.

/** Alto que tapa el teclado: lo que falta del alto de la ventana en la parte visible. */
export function altoTeclado(altoVentana: number, altoVisible: number, desdeArriba = 0): number {
  const tapado = altoVentana - (altoVisible + desdeArriba)
  // Menos de 80 px no es el teclado (barras del sistema, redondeos)
  return tapado > 80 ? Math.round(tapado) : 0
}

/** Alto de referencia sin teclado: el mayor entre lo visible, la ventana y la pantalla del equipo. */
export function altoReferencia(visible: number, ventana: number, pantalla?: number | null): number {
  return Math.max(visible || 0, ventana || 0, Number(pantalla) || 0)
}

/** ¿El elemento quedó fuera de la parte visible (abajo, tapado por el teclado, o arriba)? */
export function quedoTapado(rect: { top: number; bottom: number }, visibleArriba: number, visibleAlto: number, margen = 12): boolean {
  return rect.bottom > visibleArriba + visibleAlto - margen || rect.top < visibleArriba
}

const esEditable = (el: EventTarget | null): el is HTMLElement => {
  if (!(el instanceof HTMLElement)) return false
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true
  if (el instanceof HTMLInputElement) return !["checkbox", "radio", "button", "submit", "range", "file", "color"].includes(el.type)
  return el.isContentEditable
}

/** viewport `interactive-widget=resizes-content` (el WebView achica el contenido con el teclado). */
export function viewportConTeclado(content: string): string {
  if (/interactive-widget\s*=/.test(content)) return content
  return content ? `${content}, interactive-widget=resizes-content` : "interactive-widget=resizes-content"
}

let instalado = false

export function instalarTeclado(): () => void {
  if (typeof window === "undefined" || instalado) return () => {}
  instalado = true
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  if (meta) meta.content = viewportConTeclado(meta.content)

  const vv = window.visualViewport
  const raiz = document.documentElement
  // Alto SIN teclado: también el de la pantalla del equipo, por si la app arranca con el
  // teclado ya abierto (si no, ese alto chico pasaba por "normal" hasta otro cambio de tamaño)
  let maxAlto = altoReferencia(vv?.height ?? window.innerHeight, window.innerHeight, window.screen?.availHeight)
  let abierto = false
  const medir = () => {
    const alto = vv ? altoTeclado(window.innerHeight, vv.height, vv.offsetTop) : 0
    raiz.style.setProperty("--gm-teclado", `${alto}px`)
    const ahora = alto > 0 || (vv ? vv.height < maxAlto * 0.75 : false)
    raiz.classList.toggle("gm-teclado-abierto", ahora)
    // Se cerró el teclado con el campo todavía enfocado: soltarlo (confirma lo escrito)
    if (abierto && !ahora && esEditable(document.activeElement) && document.activeElement instanceof HTMLInputElement) document.activeElement.blur()
    abierto = ahora
  }
  const alResize = () => {
    if (vv && vv.height > maxAlto) maxAlto = vv.height
    medir()
    traerALaVista()
  }

  // El teclado tarda en abrir (animación) y no siempre avisa: se mira de nuevo un rato después
  let enfocado: HTMLElement | null = null
  const timers: number[] = []
  const traerALaVista = () => {
    const el = enfocado
    if (!el || document.activeElement !== el) return
    const arriba = vv?.offsetTop ?? 0
    const alto = vv?.height ?? window.innerHeight
    if (quedoTapado(el.getBoundingClientRect(), arriba, alto)) el.scrollIntoView({ block: "center", behavior: "smooth" })
  }
  const alEnfocar = (e: FocusEvent) => {
    if (!esEditable(e.target)) return
    enfocado = e.target
    timers.splice(0).forEach(clearTimeout)
    for (const ms of [150, 400, 750]) timers.push(window.setTimeout(() => { medir(); traerALaVista() }, ms))
  }
  const alSoltar = () => {
    enfocado = null
    timers.splice(0).forEach(clearTimeout)
    for (const ms of [150, 400]) timers.push(window.setTimeout(medir, ms))
  }

  medir()
  vv?.addEventListener("resize", alResize)
  window.addEventListener("resize", alResize)
  document.addEventListener("focusin", alEnfocar)
  document.addEventListener("focusout", alSoltar)
  return () => {
    instalado = false
    vv?.removeEventListener("resize", alResize)
    window.removeEventListener("resize", alResize)
    document.removeEventListener("focusin", alEnfocar)
    document.removeEventListener("focusout", alSoltar)
    timers.forEach(clearTimeout)
  }
}

/** true mientras el teclado está abierto (lo publica instalarTeclado en <html>). */
export function useTecladoAbiertoCore(): boolean {
  const [abierto, setAbierto] = useState(() => typeof document !== "undefined" && document.documentElement.classList.contains("gm-teclado-abierto"))
  useEffect(() => {
    const raiz = document.documentElement
    const obs = new MutationObserver(() => setAbierto(raiz.classList.contains("gm-teclado-abierto")))
    obs.observe(raiz, { attributes: true, attributeFilter: ["class"] })
    return () => obs.disconnect()
  }, [])
  return abierto
}
