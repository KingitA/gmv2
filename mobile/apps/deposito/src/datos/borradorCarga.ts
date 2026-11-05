import { useCallback, useSyncExternalStore } from "react"
import type { BorradorCarga } from "./cargar"
import { useYo } from "./hooks"

// Pedido a medio cargar ("Cargar pedido"), guardado en el equipo por usuario: volver
// atrás, cerrar la app o cambiar de pantalla NO lo pierde (se sigue desde el inicio de
// "Cargar pedido"). Se borra recién cuando el servidor lo confirma o queda en el outbox
// para enviarse solo, o si el operario lo descarta a propósito.

const clave = (usuarioId: string) => `gm.deposito.cargar.${usuarioId || "anon"}`
const oyentes = new Set<() => void>()
const cache = new Map<string, { crudo: string | null; valor: BorradorCarga | null }>()

function leer(k: string): BorradorCarga | null {
  let crudo: string | null = null
  try { crudo = localStorage.getItem(k) } catch { crudo = null }
  const c = cache.get(k)
  if (c && c.crudo === crudo) return c.valor // misma referencia mientras no cambie (useSyncExternalStore)
  let valor: BorradorCarga | null = null
  try { valor = crudo ? (JSON.parse(crudo) as BorradorCarga) : null } catch { valor = null }
  cache.set(k, { crudo, valor })
  return valor
}

function escribir(k: string, b: BorradorCarga | null) {
  try {
    if (b) localStorage.setItem(k, JSON.stringify(b))
    else localStorage.removeItem(k)
  } catch { /* sin almacenamiento: queda solo en memoria de esta sesión */ }
  if (!b) cache.set(k, { crudo: null, valor: null })
  else {
    let crudo: string | null = null
    try { crudo = localStorage.getItem(k) } catch { crudo = null }
    cache.set(k, { crudo: crudo ?? JSON.stringify(b), valor: b })
  }
  oyentes.forEach((fn) => fn())
}

const suscribir = (fn: () => void) => {
  oyentes.add(fn)
  return () => void oyentes.delete(fn)
}

/** El borrador del operario logueado y cómo cambiarlo (persistido al instante). */
export function useBorradorCarga() {
  const yo = useYo()
  const k = clave(yo.id)
  const borrador = useSyncExternalStore(suscribir, () => leer(k), () => null)
  const guardar = useCallback((b: BorradorCarga | null) => escribir(k, b), [k])
  const cambiar = useCallback((fn: (b: BorradorCarga) => BorradorCarga) => {
    const actual = leer(k)
    if (actual) escribir(k, fn(actual))
  }, [k])
  return { borrador, guardar, cambiar }
}
