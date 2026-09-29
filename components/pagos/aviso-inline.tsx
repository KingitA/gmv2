"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"

// Avisos dentro de la pantalla (error / rechazo / éxito) en vez de alert() nativo:
// en la web queda una ventana de Chrome fea y en las apps (WebView) directamente no
// existe. Mismo patrón que el toast de las apps (mobile/apps/*/src/ui.tsx): banner
// fijo arriba; el de éxito se va solo, el de error queda hasta cerrarlo.
//
// Un aviso que tiene que SOBREVIVIR a un cambio de página (cobro registrado → hoja de
// ruta) se deja con dejarAvisoPagina() y la página siguiente lo levanta con
// useAvisoInline({ entrante: true }).

const CLAVE_AVISO = "gm.web.aviso"

export function dejarAvisoPagina(msg: string) {
  try { sessionStorage.setItem(CLAVE_AVISO, msg) } catch { /* noop */ }
}

export function useAvisoInline(opts: { entrante?: boolean } = {}): { mostrar: (msg: string, tipo?: "ok" | "err") => void; cerrar: () => void; Aviso: ReactNode } {
  const [aviso, setAviso] = useState<{ msg: string; tipo: "ok" | "err" } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mostrar = useCallback((msg: string, tipo: "ok" | "err" = "err") => {
    clearTimeout(timer.current)
    setAviso({ msg, tipo })
    if (tipo === "ok") timer.current = setTimeout(() => setAviso(null), 5000)
  }, [])
  const cerrar = useCallback(() => { clearTimeout(timer.current); setAviso(null) }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    if (!opts.entrante) return
    try {
      const m = sessionStorage.getItem(CLAVE_AVISO)
      if (m) { sessionStorage.removeItem(CLAVE_AVISO); mostrar(m, "ok") }
    } catch { /* noop */ }
  }, [opts.entrante, mostrar])
  const Aviso = aviso ? (
    <div role="alert" className={`fixed left-1/2 top-4 z-[300] flex w-[min(92vw,42rem)] -translate-x-1/2 items-start gap-3 rounded-2xl px-4 py-3 text-[15px] font-semibold text-white shadow-lg ${aviso.tipo === "ok" ? "bg-green-600" : "bg-red-600"}`}>
      <span className="min-w-0 flex-1">{aviso.msg}</span>
      <button onClick={cerrar} aria-label="Cerrar" className="shrink-0 rounded-full px-2 text-xl leading-none">×</button>
    </div>
  ) : null
  return { mostrar, cerrar, Aviso }
}
