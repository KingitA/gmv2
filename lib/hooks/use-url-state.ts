'use client'

// Estado de pantalla guardado en la URL (?tab=…&estado=…), para que "atrás",
// "adelante", recargar y copiar el link a un compañero devuelvan exactamente
// la misma vista. Usar para todo lo que el usuario siente como "otra pantalla"
// (pestañas, el pedido abierto, filtros). Lo efímero (un menú abierto) no.

import { useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

type Modo = 'push' | 'replace'

/**
 * Lee/escribe varios parámetros de la URL a la vez.
 * - `push` crea una entrada en el historial (abrir un pedido, cambiar de pestaña).
 * - `replace` la pisa (tipear en el buscador, mover un filtro) para no llenar el historial.
 * Valor vacío/null/igual al default ⇒ el parámetro se quita.
 */
export function useUrlParams() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const get = useCallback((clave: string, porDefecto = '') => searchParams.get(clave) ?? porDefecto, [searchParams])

  const set = useCallback(
    (cambios: Record<string, string | null | undefined>, modo: Modo = 'push', defaults: Record<string, string> = {}) => {
      const sp = new URLSearchParams(window.location.search)
      for (const [k, v] of Object.entries(cambios)) {
        if (v == null || v === '' || v === defaults[k]) sp.delete(k)
        else sp.set(k, v)
      }
      const qs = sp.toString()
      const url = qs ? `${pathname}?${qs}` : pathname
      if (url === `${window.location.pathname}${window.location.search}`) return
      if (modo === 'replace') router.replace(url, { scroll: false })
      else router.push(url, { scroll: false })
    },
    [pathname, router],
  )

  return { get, set, searchParams }
}

/** Un solo parámetro, con la misma firma que useState: [valor, setValor]. */
export function useUrlState(clave: string, porDefecto = '', modo: Modo = 'push') {
  const { get, set } = useUrlParams()
  const valor = get(clave, porDefecto)
  const setValor = useCallback(
    (v: string | null) => set({ [clave]: v }, modo, { [clave]: porDefecto }),
    [set, clave, modo, porDefecto],
  )
  return [valor, setValor] as const
}
