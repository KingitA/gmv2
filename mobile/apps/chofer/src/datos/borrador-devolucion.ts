// Devolución en curso de un cliente del viaje (sessionStorage): sobrevive al cambio de
// ruta (deslizar un renglón del pedido en la ficha → pantalla de devolución) y a un
// "atrás" accidental. No es plata todavía: recién al registrar entra al outbox.

import { useCallback, useRef, useState } from "react"
import type { ItemDevolucion } from "../datasets"

export interface BorradorDevolucion {
  items: ItemDevolucion[]
}
const VACIO: BorradorDevolucion = { items: [] }
const clave = (viajeId: string, clienteId: string) => `gm.chofer.devolucion.${viajeId}:${clienteId}`

export function leerBorrador(viajeId: string | undefined, clienteId: string | undefined): BorradorDevolucion {
  if (!viajeId || !clienteId) return VACIO
  try {
    const b = JSON.parse(sessionStorage.getItem(clave(viajeId, clienteId)) || "null") as BorradorDevolucion | null
    return b && Array.isArray(b.items) ? { items: b.items } : VACIO
  } catch {
    return VACIO
  }
}

export function guardarBorrador(viajeId: string, clienteId: string, b: BorradorDevolucion | null) {
  try {
    if (!b || !b.items.length) sessionStorage.removeItem(clave(viajeId, clienteId))
    else sessionStorage.setItem(clave(viajeId, clienteId), JSON.stringify(b))
  } catch { /* noop */ }
}

/** Agrega un ítem (si no estaba) al borrador de ese cliente. Devuelve false si ya estaba. */
export function agregarAlBorrador(viajeId: string, clienteId: string, item: ItemDevolucion): boolean {
  const b = leerBorrador(viajeId, clienteId)
  if (b.items.some((i) => i.articulo_id === item.articulo_id)) return false
  guardarBorrador(viajeId, clienteId, { items: [...b.items, item] })
  return true
}

export function useBorradorDevolucion(viajeId: string | undefined, clienteId: string | undefined) {
  const [borrador, setEstado] = useState<BorradorDevolucion>(() => leerBorrador(viajeId, clienteId))
  const actual = useRef(borrador)
  // Se persiste EN EL ACTO (no dentro del updater de React): si enseguida se cambia de
  // ruta, el componente se desmonta y un updater diferido no llegaría a correr.
  const setBorrador = useCallback(
    (f: (prev: BorradorDevolucion) => BorradorDevolucion) => {
      const next = f(actual.current)
      actual.current = next
      if (viajeId && clienteId) guardarBorrador(viajeId, clienteId, next)
      setEstado(next)
    },
    [viajeId, clienteId],
  )
  return [borrador, setBorrador] as const
}
