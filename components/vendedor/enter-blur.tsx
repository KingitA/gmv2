"use client"

import { useEffect } from "react"

// En tablet, Enter en cualquier input del módulo vendedor cierra el teclado
// (blur). Los textarea quedan afuera para no perder el salto de línea.
export function EnterBlur() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return
      const t = e.target
      if (t instanceof HTMLInputElement) t.blur()
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [])
  return null
}
