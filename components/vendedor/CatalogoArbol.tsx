"use client"

import { useCallback, useRef, useState, type ReactNode } from "react"

// Catálogo como listas desplegables: Rubro › Categoría › Subcategoría ›
// artículos en filas compactas. Respeta el orden de la taxonomía (el que se
// arma por drag & drop en el ERP: rubros → categorías → subcategorías).
// Los artículos de cada categoría se cargan al desplegarla (una vez) y se
// reparten entre sus subcategorías; los que no tienen subcategoría van a
// un bloque "Sin subcategoría" al final.
//
// Genérico en el tipo de artículo: quien lo usa pasa el loader, cómo
// renderizar cada fila y (opcional) cómo ordenar el bloque.

export interface ArbolSub {
  id: string
  nombre: string
  cantidad: number
}
export interface ArbolCat {
  id: string
  nombre: string
  cantidad: number
  subcategorias: ArbolSub[]
}
export interface ArbolRubro {
  id: string
  nombre: string
  cantidad?: number
  categorias: ArbolCat[]
}
export interface ArbolArticulo {
  id: string
  subcategoria_id?: string | null
  subcategoria_nombre?: string | null
}

export function CatalogoArbol<T extends ArbolArticulo>({
  rubros,
  cargarCategoria,
  renderArticulo,
  ordenar,
  onVerRubro,
  tinte,
  abiertoInicial,
}: {
  rubros: ArbolRubro[]
  /** Trae TODOS los artículos de una categoría (el árbol cachea) */
  cargarCategoria: (catId: string) => Promise<T[]>
  renderArticulo: (a: T) => ReactNode
  /** Orden a aplicar dentro de cada bloque (default: como vienen) */
  ordenar?: (arts: T[]) => T[]
  /** Acción "ver todo el rubro" (opcional, botón › en el header) */
  onVerRubro?: (r: ArbolRubro) => void
  /** Colores por rubro (opcional) */
  tinte?: (rubroNombre: string) => { bg: string; border: string; ink: string; accent: string }
  /** Rubros abiertos de entrada (ids) */
  abiertoInicial?: string[]
}) {
  const [rubrosAbiertos, setRubrosAbiertos] = useState<Set<string>>(() => new Set(abiertoInicial || []))
  const [catsAbiertas, setCatsAbiertas] = useState<Set<string>>(new Set())
  const [subsAbiertas, setSubsAbiertas] = useState<Set<string>>(new Set())
  const [artsPorCat, setArtsPorCat] = useState<Record<string, T[]>>({})
  const [cargando, setCargando] = useState<Set<string>>(new Set())
  const pedidas = useRef<Set<string>>(new Set())

  const toggle = (set: Set<string>, id: string) => {
    const n = new Set(set)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  }

  const abrirCat = useCallback(
    async (catId: string) => {
      setCatsAbiertas((prev) => toggle(prev, catId))
      if (pedidas.current.has(catId)) return
      pedidas.current.add(catId)
      setCargando((prev) => new Set(prev).add(catId))
      try {
        const arts = await cargarCategoria(catId)
        setArtsPorCat((prev) => ({ ...prev, [catId]: arts }))
      } catch {
        pedidas.current.delete(catId)
      } finally {
        setCargando((prev) => {
          const n = new Set(prev)
          n.delete(catId)
          return n
        })
      }
    },
    [cargarCategoria]
  )

  const claveSub = (a: T) => a.subcategoria_id || (a.subcategoria_nombre ? `n:${a.subcategoria_nombre}` : null)
  const orden = ordenar || ((x: T[]) => x)

  return (
    <div className="space-y-2">
      {rubros.map((r) => {
        const t = tinte?.(r.nombre)
        const abierto = rubrosAbiertos.has(r.id)
        const totalArts = r.cantidad ?? r.categorias.reduce((s, c) => s + c.cantidad, 0)
        return (
          <div key={r.id} className="rounded-2xl border bg-white overflow-hidden" style={t ? { borderColor: t.border } : undefined}>
            {/* ── Rubro ── */}
            <div className="flex items-stretch" style={t ? { background: t.bg } : undefined}>
              <button
                onClick={() => setRubrosAbiertos((prev) => toggle(prev, r.id))}
                className="flex-1 flex items-center gap-3 px-4 py-3 text-left active:opacity-80"
              >
                <span className="text-lg w-5 text-center" style={t ? { color: t.accent } : undefined}>{abierto ? "▾" : "▸"}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-gray-900 text-lg leading-tight">{r.nombre}</p>
                  <p className="text-xs" style={t ? { color: t.accent } : { color: "#6b7280" }}>
                    {r.categorias.length} categorías · {totalArts} artículos
                  </p>
                </div>
              </button>
              {onVerRubro && (
                <button
                  onClick={() => onVerRubro(r)}
                  className="px-4 text-2xl font-light active:opacity-70"
                  style={t ? { color: t.accent } : undefined}
                  title="Ver todo el rubro"
                >
                  ›
                </button>
              )}
            </div>

            {/* ── Categorías ── */}
            {abierto && (
              <div className="divide-y divide-gray-100">
                {r.categorias.map((c) => {
                  const cAbierta = catsAbiertas.has(c.id)
                  const arts = artsPorCat[c.id]
                  const cargandoCat = cargando.has(c.id)
                  // Reparto por subcategoría (orden de la taxonomía) + resto
                  const porSub = new Map<string, T[]>()
                  const sinSub: T[] = []
                  if (arts) {
                    const idsSub = new Set(c.subcategorias.map((s) => s.id))
                    const porNombre = new Map(c.subcategorias.map((s) => [`n:${s.nombre}`, s.id]))
                    for (const a of arts) {
                      const k = claveSub(a)
                      const id = k && idsSub.has(k) ? k : k && porNombre.get(k)
                      if (id) {
                        if (!porSub.has(id)) porSub.set(id, [])
                        porSub.get(id)!.push(a)
                      } else sinSub.push(a)
                    }
                  }
                  return (
                    <div key={c.id}>
                      <button
                        onClick={() => abrirCat(c.id)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-left active:bg-gray-50"
                      >
                        <span className="text-gray-400 w-5 text-center">{cAbierta ? "▾" : "▸"}</span>
                        <p className="flex-1 font-bold text-gray-800 text-[13px] uppercase tracking-wide">{c.nombre}</p>
                        <span className="text-gray-400 text-xs">{c.cantidad}</span>
                      </button>

                      {cAbierta && (
                        <div className="pb-2">
                          {cargandoCat && (
                            <div className="py-4 text-center">
                              <div className="w-6 h-6 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
                            </div>
                          )}
                          {arts && c.subcategorias.length === 0 && (
                            <div className="px-3 space-y-1">{orden(arts).map((a) => <div key={a.id}>{renderArticulo(a)}</div>)}</div>
                          )}
                          {arts && c.subcategorias.length > 0 && (
                            <>
                              {[...c.subcategorias.map((s) => ({ ...s, arts: porSub.get(s.id) || [] })), ...(sinSub.length ? [{ id: `${c.id}:sin`, nombre: "Sin subcategoría", cantidad: sinSub.length, arts: sinSub }] : [])]
                                .filter((s) => s.arts.length > 0)
                                .map((s) => {
                                  const sAbierta = subsAbiertas.has(s.id)
                                  return (
                                    <div key={s.id} className="mx-3 my-1 rounded-xl border border-gray-100 bg-gray-50/60 overflow-hidden">
                                      <button
                                        onClick={() => setSubsAbiertas((prev) => toggle(prev, s.id))}
                                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left active:bg-gray-100"
                                      >
                                        <span className="text-gray-400 w-4 text-center text-sm">{sAbierta ? "▾" : "▸"}</span>
                                        <p className="flex-1 font-bold text-gray-900 text-sm">{s.nombre}</p>
                                        <span className="text-gray-400 text-xs">{s.arts.length}</span>
                                      </button>
                                      {sAbierta && (
                                        <div className="px-2 pb-2 space-y-1">{orden(s.arts).map((a) => <div key={a.id}>{renderArticulo(a)}</div>)}</div>
                                      )}
                                    </div>
                                  )
                                })}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
