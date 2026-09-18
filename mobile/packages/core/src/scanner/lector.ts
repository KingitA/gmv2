import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core"
import { useEffect, useRef } from "react"
import { DetectorWedge, type OpcionesDetector } from "./detector"

/**
 * Lector de códigos del NuStar 65-sp — utilidad compartida (clave en depósito).
 *
 * Dos modos, se usan los dos a la vez sin configurar nada en la app:
 *  1. Keyboard wedge (default del equipo): el lector "tipea" el código + Enter.
 *     DetectorWedge escucha keydown a nivel document y distingue la ráfaga del
 *     lector del tecleo humano. No hace falta un input enfocado (no aparece el
 *     teclado virtual).
 *  2. Broadcast intent: si en el servicio de escaneo del equipo se configura
 *     "salida por broadcast", el plugin nativo GmLector (mobile/packages/
 *     capacitor-lector) recibe el intent y emite el código. Acción y extra se
 *     configuran con configurarBroadcast() (defaults en el plugin).
 * Ver MOBILE.md → "Lector de códigos".
 */

export interface GmLectorPlugin {
  configurar(opts: { accion: string; extra: string }): Promise<void>
  addListener(evento: "codigo", fn: (d: { codigo: string }) => void): Promise<PluginListenerHandle>
}

const GmLector = registerPlugin<GmLectorPlugin>("GmLector")

export async function configurarBroadcast(accion: string, extra: string) {
  if (Capacitor.isPluginAvailable("GmLector")) await GmLector.configurar({ accion, extra })
}

function esEditable(el: EventTarget | null): boolean {
  const n = el as HTMLElement | null
  if (!n?.tagName) return false
  return n.tagName === "INPUT" || n.tagName === "TEXTAREA" || n.tagName === "SELECT" || n.isContentEditable === true
}

export interface OpcionesLector extends OpcionesDetector {
  onCodigo: (codigo: string, origen: "wedge" | "broadcast") => void
  enabled?: boolean
  /** Si hay un input enfocado, dejar que el input reciba el texto. Default true */
  ignorarConInputEnfocado?: boolean
}

/** Hook: escucha el lector (wedge + broadcast) mientras la pantalla está montada. */
export function useLector(opts: OpcionesLector) {
  const ref = useRef(opts)
  ref.current = opts
  const enabled = opts.enabled ?? true

  useEffect(() => {
    if (!enabled) return
    const det = new DetectorWedge((c) => ref.current.onCodigo(c, "wedge"), ref.current)
    const onKey = (e: KeyboardEvent) => {
      if ((ref.current.ignorarConInputEnfocado ?? true) && esEditable(e.target)) return
      if (det.tecla(e)) e.preventDefault()
    }
    document.addEventListener("keydown", onKey, { capture: true })

    let h: Promise<PluginListenerHandle> | null = null
    if (Capacitor.isPluginAvailable("GmLector")) {
      h = GmLector.addListener("codigo", (d) => {
        const c = (d?.codigo || "").trim()
        if (c.length >= (ref.current.minLength ?? 3)) ref.current.onCodigo(c, "broadcast")
      })
    }
    return () => {
      document.removeEventListener("keydown", onKey, { capture: true })
      det.reset()
      void h?.then((x) => x.remove())
    }
  }, [enabled])
}

// ─── Feedback (beep + vibración), mismo sonido que el ERP web ───────────────

let ctx: AudioContext | null = null
function tono(freq: number, ms: number) {
  try {
    const C = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!C) return
    ctx ??= new C() as AudioContext
    if (ctx.state === "suspended") void ctx.resume()
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = "square"
    osc.frequency.value = freq
    g.gain.value = 0.05
    osc.connect(g)
    g.connect(ctx.destination)
    const t = ctx.currentTime
    osc.start(t)
    g.gain.setValueAtTime(0.05, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000)
    osc.stop(t + ms / 1000)
  } catch {
    /* noop */
  }
}

export function lecturaOk() {
  tono(1760, 70)
  try {
    navigator.vibrate?.(40)
  } catch {
    /* noop */
  }
}

export function lecturaError() {
  tono(220, 180)
  try {
    navigator.vibrate?.([60, 50, 60])
  } catch {
    /* noop */
  }
}
