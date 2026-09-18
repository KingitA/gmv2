import { useCallback } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router"

/**
 * Convención de navegación (MOBILE.md → "Navegación"). Resumen:
 *
 *  Qué es                          | Cómo se representa            | ¿Entrada de historial?
 *  --------------------------------|-------------------------------|-----------------------
 *  Pantalla / detalle              | ruta propia /viajes/:id       | sí (push)
 *  Paso de un wizard               | ?paso=2  (usePaso)            | sí (push) — atrás = paso anterior
 *  Sheet / modal / foto / confirmar| ?ver=cobro (useOverlay)       | sí (push) — atrás lo cierra
 *  Tabs de una pantalla            | ?tab=x   (useParamEstado)     | NO (replace) — atrás sale de la pantalla
 *  Filtros / búsqueda / orden      | ?q=&orden= (useParamEstado)   | NO (replace)
 *
 * Nunca useState para algo que el usuario percibe como pantalla.
 */

/** Estado en la URL SIN entrada de historial (tabs, filtros, búsqueda). */
export function useParamEstado(nombre: string, porDefecto = ""): [string, (v: string) => void] {
  const [sp, setSp] = useSearchParams()
  const valor = sp.get(nombre) ?? porDefecto
  const set = useCallback(
    (v: string) => {
      setSp(
        (prev) => {
          const n = new URLSearchParams(prev)
          if (!v || v === porDefecto) n.delete(nombre)
          else n.set(nombre, v)
          return n
        },
        { replace: true, preventScrollReset: true },
      )
    },
    [nombre, porDefecto, setSp],
  )
  return [valor, set]
}

/**
 * Overlay (sheet, modal, zoom de foto, confirmación) como entrada de historial.
 * abrir() hace push de ?<param>=<valor>; cerrar() vuelve atrás si lo abrimos
 * nosotros (así el botón físico y el botón "X" hacen lo mismo), o reemplaza la
 * URL sin el parámetro si se entró directo con el overlay abierto.
 */
export function useOverlay(valor: string, param = "ver") {
  const [sp] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const abierto = sp.get(param) === valor

  const abrir = useCallback(() => {
    if (abierto) return
    const n = new URLSearchParams(location.search)
    n.set(param, valor)
    navigate({ pathname: location.pathname, search: `?${n}` }, { state: { overlay: true } })
  }, [abierto, location.pathname, location.search, navigate, param, valor])

  const cerrar = useCallback(() => {
    if (!abierto) return
    if ((location.state as any)?.overlay) navigate(-1)
    else {
      const n = new URLSearchParams(location.search)
      n.delete(param)
      navigate({ pathname: location.pathname, search: n.size ? `?${n}` : "" }, { replace: true })
    }
  }, [abierto, location.pathname, location.search, location.state, navigate, param])

  return { abierto, abrir, cerrar }
}

/** Paso de wizard en ?paso=N (1-based). ir(n) hace push: atrás vuelve al paso anterior. */
export function usePaso(total: number) {
  const [sp] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const paso = Math.min(total, Math.max(1, Number(sp.get("paso")) || 1))
  const ir = useCallback(
    (n: number, opts: { replace?: boolean } = {}) => {
      const q = new URLSearchParams(location.search)
      if (n <= 1) q.delete("paso")
      else q.set("paso", String(n))
      navigate({ pathname: location.pathname, search: q.size ? `?${q}` : "" }, { replace: opts.replace })
    },
    [location.pathname, location.search, navigate],
  )
  return { paso, ir, siguiente: () => ir(paso + 1), anterior: () => navigate(-1) }
}
