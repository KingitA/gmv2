"use client"

/**
 * useBarcodeScanner
 *
 * Captura global del botón físico de escaneo de una colectora de datos (ej. 3nStar
 * NuStar 65) configurada en modo keyboard-wedge: el lector "tipea" el código como un
 * teclado y agrega Enter como sufijo. Este hook escucha keydown a nivel document,
 * distingue la ráfaga rápida del lector del tecleo humano (por timing) y dispara
 * onScan(codigo) sin necesidad de tener ningún input enfocado (así no aparece el
 * teclado virtual y el operario solo apunta y aprieta el gatillo).
 *
 * Se autoignora cuando el foco está en un campo editable (input/textarea/select/
 * contenteditable), para no pisar la búsqueda manual por texto: en ese caso el propio
 * input maneja el escaneo.
 *
 * Soporta lectores que NO mandan Enter mediante un cierre por inactividad (timeout).
 */

import { useEffect, useRef } from "react"

export interface UseBarcodeScannerOptions {
  /** Se llama con el código escaneado completo. */
  onScan: (code: string) => void
  /** Si es false, el hook no captura nada. Default true. */
  enabled?: boolean
  /** Largo mínimo del código para considerarlo válido (evita ruido). Default 3. */
  minLength?: number
  /** Tecla que marca fin de escaneo. Default "Enter". */
  endKey?: string
  /** Gap máximo (ms) entre teclas para considerarlas parte de la misma ráfaga del lector. Default 60. */
  maxInterKeyMs?: number
  /** Si true, ignora el escaneo cuando hay un input/textarea/etc enfocado. Default true. */
  ignoreWhenInputFocused?: boolean
}

function isEditableTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null
  if (!node || !node.tagName) return false
  const tag = node.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || node.isContentEditable === true
}

export function useBarcodeScanner(options: UseBarcodeScannerOptions): void {
  const { enabled = true } = options
  // Guardamos las opciones en un ref para que el listener no se recree en cada render
  // (y no perdamos teclas a mitad de una ráfaga).
  const optsRef = useRef(options)
  optsRef.current = options

  const bufferRef = useRef("")
  const lastTimeRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!enabled) return

    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }

    const flush = () => {
      clearTimer()
      const code = bufferRef.current.trim()
      bufferRef.current = ""
      const { onScan, minLength = 3 } = optsRef.current
      if (code.length >= minLength) onScan(code)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const {
        minLength = 3,
        endKey = "Enter",
        maxInterKeyMs = 60,
        ignoreWhenInputFocused = true,
      } = optsRef.current

      if (ignoreWhenInputFocused && isEditableTarget(e.target)) return

      const now = performance.now()
      // Resync: si pasó demasiado desde la última tecla, esto no es una ráfaga del
      // lector → empezamos un buffer limpio (descarta teclas humanas sueltas).
      if (now - lastTimeRef.current > maxInterKeyMs) bufferRef.current = ""
      lastTimeRef.current = now

      if (e.key === endKey) {
        if (bufferRef.current.length > 0) {
          e.preventDefault()
          flush()
        }
        return
      }

      // Solo caracteres imprimibles de 1 char; ignorar Shift/Ctrl/Alt/Meta y teclas especiales.
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        bufferRef.current += e.key
        // Fallback para lectores sin sufijo Enter: cerrar por inactividad.
        clearTimer()
        timerRef.current = setTimeout(flush, maxInterKeyMs + 40)
      }
    }

    document.addEventListener("keydown", onKeyDown, { capture: true })
    return () => {
      document.removeEventListener("keydown", onKeyDown, { capture: true } as any)
      clearTimer()
      bufferRef.current = ""
    }
  }, [enabled])
}
