import { useEffect, useState, type ReactNode } from "react"
import { ORDENES, type OrdenArticulos } from "@gm/vendedor"
import type { Articulo } from "../../datasets"
import type { Precio } from "../../datos/precios"
import { formatCurrency } from "../../ui"
import { useAbiertos } from "./contexto"

// Piezas visuales del catálogo, portadas 1:1 de la web (app/vendedor/pedido/nuevo/page.tsx,
// components/vendedor/CatalogoArbol.tsx y OrdenSelector.tsx). Única diferencia: los
// artículos y los precios ya están en el equipo, así que no hay "cargando" por fila.

/**
 * Fila compacta del catálogo: miniatura (tap = foto grande) · descripción · -oferta% ·
 * sku · marca · x u/bulto · CC / Ctdo, y a la derecha la casilla de cantidad con
 * "bultos" + botón agregar. Verde = ya está en el pedido (muestra unidades).
 */
export function FilaArticulo({ a, precio, enCarrito, onAbrir, onZoom, onAgregar, onActualizar, onQuitar }: {
  a: Articulo
  precio: Precio | null
  enCarrito?: number
  onAbrir: () => void
  onZoom: () => void
  onAgregar: (unidades: number) => void
  onActualizar: (unidades: number) => void
  onQuitar: () => void
}) {
  const [cant, setCant] = useState("")
  const [bultos, setBultos] = useState(false)
  const [editando, setEditando] = useState(false)

  // La casilla refleja lo que ya está en el pedido (en unidades, en verde).
  // Mientras el vendedor edita, manda lo que tipea.
  useEffect(() => {
    if (!editando) {
      setCant(enCarrito ? String(enCarrito) : "")
      if (enCarrito) setBultos(false) // lo agregado se muestra SIEMPRE en unidades
    }
  }, [enCarrito, editando])

  if (precio && precio.precio <= 0) return null
  const ub = a.unidades_por_bulto || 1
  const n = parseFloat(cant.replace(",", "."))
  const unidades = Number.isFinite(n) && n > 0 ? (bultos ? n * ub : n) : 0
  const cambiado = !!enCarrito && unidades !== enCarrito

  const confirmar = () => {
    setEditando(false)
    if (!enCarrito) {
      if (unidades > 0) { onAgregar(unidades); setCant("") }
      return
    }
    if (unidades <= 0) onQuitar()
    else if (unidades !== enCarrito) onActualizar(unidades)
    setBultos(false)
  }

  return (
    <div className={`flex w-full items-center gap-2 rounded-lg border bg-white py-1.5 pl-1.5 pr-1.5 ${enCarrito ? "border-emerald-500" : "border-gray-100"}`}>
      <button onClick={onZoom} className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gray-50 active:opacity-70">
        {a.imagen_url ? <img src={a.imagen_url} alt="" loading="lazy" className="h-full w-full object-contain" /> : <span className="text-lg text-gray-300">📦</span>}
      </button>
      <button onClick={onAbrir} className="min-w-0 flex-1 text-left active:opacity-70">
        <p className="text-[13px] font-bold leading-snug text-gray-900">
          {a.descripcion}
          {a.descuento_propio > 0 && <span className="ml-1.5 inline-block rounded bg-red-100 px-1.5 align-middle text-[10px] font-bold text-red-700">-{a.descuento_propio}%</span>}
        </p>
        <p className="truncate text-[11px] text-gray-400">
          <span className="font-mono">{a.sku || "—"}</span>
          {a.marca ? ` · ${a.marca}` : ""}
          {a.unidades_por_bulto ? ` · x${a.unidades_por_bulto}` : ""}
        </p>
        <p className="truncate text-[11px]">
          {!precio ? (
            <span className="text-gray-400">Sin precio en este equipo</span>
          ) : precio.especial ? (
            <span className="font-bold text-gray-700">{formatCurrency(precio.precioNeto)} <span className="text-orange-500">+IVA</span></span>
          ) : (
            <>
              <span className="font-bold text-gray-700">CC {formatCurrency(precio.precio)}</span>
              <span className="font-bold text-emerald-700"> · Ctdo {formatCurrency(precio.contado)}</span>
            </>
          )}
        </p>
      </button>
      <div className="flex shrink-0 items-center gap-1">
        <div className="flex flex-col items-center gap-0.5">
          <input
            value={cant}
            onFocus={() => setEditando(true)}
            onChange={(e) => { setEditando(true); setCant(e.target.value.replace(/[^\d.,]/g, "")) }}
            onBlur={() => { if (enCarrito && !cambiado) setEditando(false) }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmar(); (e.target as HTMLInputElement).blur() } }}
            inputMode="decimal"
            placeholder="0"
            disabled={!precio}
            className={`w-14 rounded-md border px-1.5 py-1.5 text-center text-sm font-bold ${enCarrito ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-gray-300 text-gray-900"}`}
            aria-label="Cantidad"
          />
          <label className="flex select-none items-center gap-1 text-[10px] text-gray-500">
            <input type="checkbox" checked={bultos} onChange={(e) => { setEditando(true); setBultos(e.target.checked) }} className="h-3 w-3 accent-emerald-600" />
            bultos{bultos && ub > 1 && unidades > 0 ? ` (=${unidades} u)` : ""}
          </label>
        </div>
        {!enCarrito ? (
          <button onClick={confirmar} disabled={unidades <= 0 || !precio} className="h-11 w-10 rounded-lg bg-emerald-600 text-xl font-bold leading-none text-white disabled:bg-gray-200 disabled:text-gray-400" aria-label="Agregar al pedido">+</button>
        ) : cambiado || editando ? (
          <button onClick={confirmar} className="h-11 w-10 rounded-lg bg-emerald-600 text-lg font-bold leading-none text-white" aria-label={unidades <= 0 ? "Quitar del pedido" : "Confirmar cantidad"}>✓</button>
        ) : (
          <button onClick={onQuitar} className="h-11 w-10 rounded-lg border border-red-200 bg-white text-lg leading-none text-red-600" aria-label="Quitar del pedido">🗑</button>
        )}
      </div>
    </div>
  )
}

export function OrdenSelector({ value, onChange, className = "" }: { value: OrdenArticulos; onChange: (o: OrdenArticulos) => void; className?: string }) {
  return (
    <label className={`flex items-center gap-1.5 ${className}`}>
      <span className="shrink-0 text-xs text-gray-400">↕</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as OrdenArticulos)}
        className={`rounded-lg border bg-white px-2 py-2 text-xs font-bold ${value === "default" ? "border-gray-200 text-gray-600" : "border-emerald-500 text-emerald-700"}`}
      >
        {ORDENES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    </label>
  )
}

/** Buscador DENTRO de un listado acotado (filtro / proveedor / categoría) + orden. */
export function BuscadorLocal({ valor, onCambio, placeholder, orden, onOrden }: { valor: string; onCambio: (v: string) => void; placeholder: string; orden: OrdenArticulos; onOrden: (o: OrdenArticulos) => void }) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <svg viewBox="0 0 24 24" fill="none" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden>
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path d="M16.5 16.5 21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input type="search" value={valor} onChange={(e) => onCambio(e.target.value)} placeholder={placeholder} className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-9 text-gray-900 outline-none" />
        {valor && <button onClick={() => onCambio("")} className="absolute right-1.5 top-1/2 h-8 w-8 -translate-y-1/2 rounded-full bg-gray-200 text-xs leading-none text-gray-500">✕</button>}
      </div>
      <OrdenSelector value={orden} onChange={onOrden} className="shrink-0" />
    </div>
  )
}

// ─── Árbol desplegable Rubro › Categoría › Subcategoría › artículos ──────────

export interface ArbolSub { id: string; nombre: string; cantidad: number }
export interface ArbolCat { id: string; nombre: string; cantidad: number; subcategorias: ArbolSub[] }
export interface ArbolRubro { id: string; nombre: string; cantidad?: number; categorias: ArbolCat[] }

export function CatalogoArbol({ clave, rubros, articulosDe, renderArticulo, ordenar, onVerRubro, tinte, abiertoInicial }: {
  /** Identifica este árbol: su estado desplegado sobrevive a ir al carrito y volver */
  clave: string
  rubros: ArbolRubro[]
  /** Artículos de una categoría (ya en memoria: la réplica local) */
  articulosDe: (catId: string) => Articulo[]
  renderArticulo: (a: Articulo) => ReactNode
  ordenar?: (arts: Articulo[]) => Articulo[]
  onVerRubro?: (r: ArbolRubro) => void
  tinte?: (rubroNombre: string) => { bg: string; border: string; ink: string; accent: string }
  abiertoInicial?: string[]
}) {
  const [rubrosAbiertos, alternarRubro] = useAbiertos(`${clave}:r`, abiertoInicial)
  const [catsAbiertas, alternarCat] = useAbiertos(`${clave}:c`)
  const [subsAbiertas, alternarSub] = useAbiertos(`${clave}:s`)
  const claveSub = (a: Articulo) => a.subcategoria_id || (a.subcategoria_nombre ? `n:${a.subcategoria_nombre}` : null)
  const orden = ordenar || ((x: Articulo[]) => x)

  return (
    <div className="space-y-2">
      {rubros.map((r) => {
        const t = tinte?.(r.nombre)
        const abierto = rubrosAbiertos.has(r.id)
        const totalArts = r.cantidad ?? r.categorias.reduce((s, c) => s + c.cantidad, 0)
        return (
          <div key={r.id} className="overflow-hidden rounded-2xl border bg-white" style={t ? { borderColor: t.border } : undefined}>
            <div className="flex items-stretch" style={t ? { background: t.bg } : undefined}>
              <button onClick={() => alternarRubro(r.id)} className="flex flex-1 items-center gap-3 px-4 py-3 text-left active:opacity-80">
                <span className="w-5 text-center text-lg" style={t ? { color: t.accent } : undefined}>{abierto ? "▾" : "▸"}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-bold leading-tight text-gray-900">{r.nombre}</p>
                  <p className="text-xs" style={t ? { color: t.accent } : { color: "#6b7280" }}>{r.categorias.length} categorías · {totalArts} artículos</p>
                </div>
              </button>
              {onVerRubro && <button onClick={() => onVerRubro(r)} className="px-4 text-2xl font-light active:opacity-70" style={t ? { color: t.accent } : undefined} aria-label="Ver todo el rubro">›</button>}
            </div>

            {abierto && (
              <div className="divide-y divide-gray-100">
                {r.categorias.map((c) => {
                  const cAbierta = catsAbiertas.has(c.id)
                  // Reparto por subcategoría (orden de la taxonomía) + resto. Solo si está abierta.
                  const arts = cAbierta ? articulosDe(c.id) : null
                  const porSub = new Map<string, Articulo[]>()
                  const sinSub: Articulo[] = []
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
                      <button onClick={() => alternarCat(c.id)} className="flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-gray-50">
                        <span className="w-5 text-center text-gray-400">{cAbierta ? "▾" : "▸"}</span>
                        <p className="flex-1 text-[13px] font-bold uppercase tracking-wide text-gray-800">{c.nombre}</p>
                        <span className="text-xs text-gray-400">{c.cantidad}</span>
                      </button>
                      {arts && (
                        <div className="pb-2">
                          {c.subcategorias.length === 0 && <div className="space-y-1 px-3">{orden(arts).map((a) => <div key={a.id}>{renderArticulo(a)}</div>)}</div>}
                          {c.subcategorias.length > 0 &&
                            [...c.subcategorias.map((s) => ({ ...s, arts: porSub.get(s.id) || [] })), ...(sinSub.length ? [{ id: `${c.id}:sin`, nombre: "Sin subcategoría", cantidad: sinSub.length, arts: sinSub }] : [])]
                              .filter((s) => s.arts.length > 0)
                              .map((s) => {
                                const sAbierta = subsAbiertas.has(s.id)
                                return (
                                  <div key={s.id} className="mx-3 my-1 overflow-hidden rounded-xl border border-gray-100 bg-gray-50/60">
                                    <button onClick={() => alternarSub(s.id)} className="flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left active:bg-gray-100">
                                      <span className="w-4 text-center text-sm text-gray-400">{sAbierta ? "▾" : "▸"}</span>
                                      <p className="flex-1 text-sm font-bold text-gray-900">{s.nombre}</p>
                                      <span className="text-xs text-gray-400">{s.arts.length}</span>
                                    </button>
                                    {sAbierta && <div className="space-y-1 px-2 pb-2">{orden(s.arts).map((a) => <div key={a.id}>{renderArticulo(a)}</div>)}</div>}
                                  </div>
                                )
                              })}
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

// ─── Agrupar una lista ya cargada en rubro › categoría › subcategoría ────────
// (= arbolCtx de la web: filtros y proveedor, en el orden de la taxonomía del ERP)

const claveCategoria = (a: Articulo) => a.categoria_id || (a.categoria_nombre ? `n:${a.categoria_nombre}` : "otros")
const claveSubcategoria = (a: Articulo) => a.subcategoria_id || (a.subcategoria_nombre ? `n:${a.subcategoria_nombre}` : null)

export function agruparEnArbol(lista: Articulo[], taxonomia: ArbolRubro[]): { rubros: ArbolRubro[]; artsPorCat: Map<string, Articulo[]> } {
  const posR = new Map<string, number>(), posC = new Map<string, number>(), posS = new Map<string, number>()
  let i = 0, j = 0
  taxonomia.forEach((r, k) => {
    posR.set(r.id, k)
    posR.set(`n:${r.nombre}`, k)
    for (const c of r.categorias) {
      posC.set(c.id, i); posC.set(`n:${c.nombre}`, i); i++
      for (const s of c.subcategorias) { posS.set(s.id, j); posS.set(`n:${s.nombre}`, j); j++ }
    }
  })
  const pos = (m: Map<string, number>, k: string) => m.get(k) ?? Number.MAX_SAFE_INTEGER
  type CatAcc = { id: string; nombre: string; cantidad: number; subs: Map<string, ArbolSub> }
  const rubrosAcc = new Map<string, { id: string; nombre: string; cantidad: number; cats: Map<string, CatAcc> }>()
  const artsPorCat = new Map<string, Articulo[]>()
  for (const a of lista) {
    const rk = a.rubro_id || (a.rubro_nombre ? `n:${a.rubro_nombre}` : "otros")
    let r = rubrosAcc.get(rk)
    if (!r) rubrosAcc.set(rk, (r = { id: rk, nombre: a.rubro_nombre || "Otros", cantidad: 0, cats: new Map() }))
    r.cantidad++
    const ck = claveCategoria(a)
    let c = r.cats.get(ck)
    if (!c) r.cats.set(ck, (c = { id: ck, nombre: a.categoria_nombre || "Otros", cantidad: 0, subs: new Map() }))
    c.cantidad++
    const sk = claveSubcategoria(a)
    if (sk) {
      const s = c.subs.get(sk)
      if (s) s.cantidad++
      else c.subs.set(sk, { id: sk, nombre: a.subcategoria_nombre || "—", cantidad: 1 })
    }
    const l = artsPorCat.get(ck)
    if (l) l.push(a)
    else artsPorCat.set(ck, [a])
  }
  const rubros = [...rubrosAcc.values()]
    .sort((a, b) => pos(posR, a.id) - pos(posR, b.id))
    .map((r) => ({
      id: r.id, nombre: r.nombre, cantidad: r.cantidad,
      categorias: [...r.cats.values()].sort((a, b) => pos(posC, a.id) - pos(posC, b.id)).map((c) => ({
        id: c.id, nombre: c.nombre, cantidad: c.cantidad,
        subcategorias: [...c.subs.values()].sort((a, b) => pos(posS, a.id) - pos(posS, b.id)),
      })),
    }))
  return { rubros, artsPorCat }
}

/** Posición de cada subcategoría en la taxonomía (orden natural dentro de una categoría). */
export function posicionSubcategorias(taxonomia: ArbolRubro[]): (a: Articulo) => number {
  const posS = new Map<string, number>()
  let j = 0
  for (const r of taxonomia) for (const c of r.categorias) for (const s of c.subcategorias) { posS.set(s.id, j); posS.set(`n:${s.nombre}`, j); j++ }
  return (a) => {
    const k = claveSubcategoria(a)
    return k && posS.has(k) ? posS.get(k)! : Number.MAX_SAFE_INTEGER
  }
}
export { claveSubcategoria }
