"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { formatCurrency } from "@/lib/utils"
import { previewPreciosListas } from "@/lib/actions/pedidos"

// Consulta de precios por lista + método de facturación, sin cliente:
// el vendedor navega el catálogo (o busca) y ve cada artículo con el precio
// en las columnas que eligió (ej. Neco c/IVA · Neco Final), pudiendo agregar
// o quitar comparaciones. Las listas disponibles las decide el server
// (Neco para todos; Viajante solo para quien la tiene asignada; admin todas).

interface Lista {
  id: string
  nombre: string
  codigo: string
}
interface Metodo {
  key: string
  label: string
}
interface Combo {
  lista_id: string
  metodo: string
}
interface Articulo {
  id: string
  sku: string | null
  ean13: string | null
  descripcion: string
  unidades_por_bulto: number | null
  marca: string | null
  imagen_url: string | null
  categoria_id: string | null
  subcategoria_id: string | null
}
interface CatalogoSub {
  id: string
  nombre: string
  cantidad: number
}
interface CatalogoCat {
  id: string
  nombre: string
  cantidad: number
  subcategorias: CatalogoSub[]
}
interface CatalogoRubro {
  id: string
  nombre: string
  cantidad: number
  categorias: CatalogoCat[]
}

const comboKey = (c: Combo) => `${c.lista_id}|${c.metodo}`
const combosKey = (cs: Combo[]) => cs.map(comboKey).join(",")

export default function VendedorPreciosPage() {
  const router = useRouter()

  const [listas, setListas] = useState<Lista[]>([])
  const [metodos, setMetodos] = useState<Metodo[]>([])
  const [combos, setCombos] = useState<Combo[]>([])
  const [verAgregar, setVerAgregar] = useState(false)

  const [catalogo, setCatalogo] = useState<CatalogoRubro[]>([])
  const [catSel, setCatSel] = useState<CatalogoCat | null>(null)
  const [subSel, setSubSel] = useState<string | null>(null)
  const [articulos, setArticulos] = useState<Articulo[]>([])
  const [cargando, setCargando] = useState(false)

  const [q, setQ] = useState("")
  const [resultados, setResultados] = useState<Articulo[] | null>(null)
  const [buscando, setBuscando] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // precios[articulo_id] = {cc, contado} por combo (alineado con `combos`)
  const [precios, setPrecios] = useState<Record<string, Array<{ cc: number; contado: number } | null>>>({})
  const [zoomFoto, setZoomFoto] = useState<string | null>(null)
  const pedidosRef = useRef<Set<string>>(new Set())
  const combosRef = useRef<Combo[]>([])

  // ── Setup: listas permitidas + catálogo ─────────────────────────────
  useEffect(() => {
    fetch("/api/vendedor/precios-listas")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return
        setListas(d.listas || [])
        setMetodos(d.metodos || [])
        // Arranque útil: Neco c/IVA y Neco Final (el ejemplo de todos los días)
        const neco = (d.listas || []).find((l: Lista) => l.codigo === "neco") || d.listas?.[0]
        if (neco) setCombos([{ lista_id: neco.id, metodo: "Factura" }, { lista_id: neco.id, metodo: "Final" }])
      })
      .catch(() => {})
    fetch("/api/vendedor/catalogo")
      .then((r) => r.json())
      .then((d) => !d.error && setCatalogo(d.rubros || []))
      .catch(() => {})
  }, [])

  // ── Precios en batch, cache por artículo (se vacía al cambiar combos) ──
  const cargarPrecios = useCallback(async (arts: Articulo[], cs: Combo[]) => {
    if (!arts.length || !cs.length) return
    const ids = arts.map((a) => a.id).filter((id) => !pedidosRef.current.has(id))
    if (!ids.length) return
    for (const id of ids) pedidosRef.current.add(id)
    const key = combosKey(cs)
    try {
      const res = await previewPreciosListas(ids, cs)
      // Si mientras tanto cambiaron los combos, descartar (evita mezclar columnas)
      if (combosKey(combosRef.current) !== key) return
      setPrecios((prev) => {
        const next = { ...prev }
        for (const r of res) next[r.articulo_id] = r.precios
        return next
      })
    } catch (e) {
      console.error("Error cargando precios:", e)
      for (const id of ids) pedidosRef.current.delete(id)
    }
  }, [])

  useEffect(() => {
    combosRef.current = combos
    // Cambiaron las columnas: recalcular todo lo visible
    setPrecios({})
    pedidosRef.current = new Set()
    const visibles = resultados ?? articulos
    if (visibles.length && combos.length) cargarPrecios(visibles, combos)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combosKey(combos)])

  // ── Navegación por categoría ────────────────────────────────────────
  const abrirCategoria = (cat: CatalogoCat, subId?: string | null) => {
    setCatSel(cat)
    setSubSel(subId || null)
    setResultados(null)
    setQ("")
    setCargando(true)
    const params = new URLSearchParams({ vista: "categoria", categoria: cat.id })
    if (subId) params.set("subcategoria", subId)
    fetch(`/api/vendedor/articulos?${params}`)
      .then((r) => r.json())
      .then((d) => {
        const arts = d.articulos || []
        setArticulos(arts)
        cargarPrecios(arts, combosRef.current)
      })
      .catch(() => setArticulos([]))
      .finally(() => setCargando(false))
  }

  // ── Búsqueda ────────────────────────────────────────────────────────
  const buscar = (value: string) => {
    setQ(value)
    if (debounce.current) clearTimeout(debounce.current)
    if (value.trim().length < 2) {
      setResultados(null)
      return
    }
    setBuscando(true)
    debounce.current = setTimeout(() => {
      fetch(`/api/vendedor/articulos?vista=buscar&q=${encodeURIComponent(value.trim())}`)
        .then((r) => r.json())
        .then((d) => {
          const arts = d.articulos || []
          setResultados(arts)
          cargarPrecios(arts, combosRef.current)
        })
        .catch(() => setResultados([]))
        .finally(() => setBuscando(false))
    }, 350)
  }

  // ── Etiquetas de combos ─────────────────────────────────────────────
  const nombreLista = (id: string) => listas.find((l) => l.id === id)?.nombre || "?"
  const labelMetodo = (m: string) => metodos.find((x) => x.key === m)?.label || m
  const variasListas = new Set(combos.map((c) => c.lista_id)).size > 1
  const labelCombo = (c: Combo) => (variasListas ? `${nombreLista(c.lista_id)} ${labelMetodo(c.metodo)}` : labelMetodo(c.metodo))

  const quitarCombo = (i: number) => {
    if (combos.length <= 1) return
    setCombos((prev) => prev.filter((_, idx) => idx !== i))
  }

  const visibles = resultados ?? articulos
  const enLista = !!resultados || !!catSel

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <header className="bg-emerald-700 text-white sticky top-0 z-10 shadow-md">
        <div className="px-5 py-3 flex items-center gap-3">
          <button
            onClick={() => {
              if (resultados) { setResultados(null); setQ("") }
              else if (catSel) { setCatSel(null); setArticulos([]) }
              else router.push("/vendedor")
            }}
            className="text-2xl leading-none px-1"
          >
            ←
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold truncate">💲 Precios</h1>
            <p className="text-emerald-200 text-xs truncate">
              {catSel && !resultados ? catSel.nombre : "Consultá y compará por lista"}
            </p>
          </div>
        </div>
        <div className="px-4 pb-2">
          <input
            value={q}
            onChange={(e) => buscar(e.target.value)}
            placeholder="Buscar artículo, SKU o código de barras..."
            className="w-full rounded-xl border-0 px-4 py-2.5 text-gray-900 bg-white placeholder:text-gray-400"
            inputMode="search"
          />
        </div>
        {/* Columnas de comparación */}
        <div className="px-4 pb-3 flex gap-1.5 flex-wrap items-center">
          {combos.map((c, i) => (
            <span key={comboKey(c) + i} className="bg-emerald-600 border border-emerald-500 rounded-full pl-3 pr-1.5 py-1 text-xs font-bold flex items-center gap-1">
              {nombreLista(c.lista_id)} · {labelMetodo(c.metodo)}
              {combos.length > 1 && (
                <button onClick={() => quitarCombo(i)} className="w-4 h-4 rounded-full bg-emerald-800/60 leading-none text-[10px]">
                  ✕
                </button>
              )}
            </span>
          ))}
          {combos.length < 4 && (
            <button
              onClick={() => setVerAgregar(true)}
              className="bg-white text-emerald-700 rounded-full px-3 py-1 text-xs font-bold"
            >
              + Comparar
            </button>
          )}
        </div>
      </header>

      <div className="p-4 max-w-2xl mx-auto space-y-4">
        {/* Home: categorías */}
        {!enLista && (
          <div className="space-y-4">
            {catalogo.map((r) => (
              <section key={r.id}>
                <h2 className="text-sm font-bold uppercase tracking-wide text-gray-400 mb-2">{r.nombre}</h2>
                <div className="grid grid-cols-2 gap-2">
                  {r.categorias.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => abrirCategoria(c)}
                      className="bg-white rounded-xl border border-gray-200 p-3.5 text-left active:scale-[0.97]"
                    >
                      <p className="font-bold text-gray-900 text-sm leading-tight">{c.nombre}</p>
                      <p className="text-gray-400 text-xs mt-0.5">{c.cantidad} artículos</p>
                    </button>
                  ))}
                </div>
              </section>
            ))}
            {!catalogo.length && <p className="text-center text-gray-400 py-10">Cargando catálogo...</p>}
          </div>
        )}

        {/* Subcategorías de la categoría abierta */}
        {catSel && !resultados && catSel.subcategorias.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => abrirCategoria(catSel, null)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold ${!subSel ? "bg-emerald-600 text-white" : "bg-white border border-gray-200 text-gray-600"}`}
            >
              Todas
            </button>
            {catSel.subcategorias.map((s) => (
              <button
                key={s.id}
                onClick={() => abrirCategoria(catSel, s.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold ${subSel === s.id ? "bg-emerald-600 text-white" : "bg-white border border-gray-200 text-gray-600"}`}
              >
                {s.nombre}
              </button>
            ))}
          </div>
        )}

        {/* Listado con precios comparados */}
        {enLista && (
          <div className="space-y-2">
            {(cargando || buscando) && <p className="text-center text-gray-400 py-6">Buscando...</p>}
            {!cargando && !buscando && !visibles.length && (
              <p className="text-center text-gray-400 py-10">Sin artículos.</p>
            )}
            {visibles.map((a) => {
              const p = precios[a.id]
              return (
                <div key={a.id} className="bg-white rounded-xl border border-gray-200 p-3.5">
                  <div className="flex gap-3">
                    {a.imagen_url && (
                      <button onClick={() => setZoomFoto(a.imagen_url)} className="shrink-0 active:opacity-80">
                        <img src={a.imagen_url} alt="" className="w-14 h-14 rounded-lg object-contain bg-gray-50" />
                      </button>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-gray-900 text-sm leading-snug">{a.descripcion}</p>
                      <p className="text-gray-400 text-xs mt-0.5">
                        {a.sku ? `SKU ${a.sku}` : ""}
                        {a.marca ? ` · ${a.marca}` : ""}
                        {a.unidades_por_bulto ? ` · ${a.unidades_por_bulto} u/bulto` : ""}
                      </p>
                    </div>
                  </div>
                  <div className={`mt-2.5 grid gap-1.5 ${combos.length <= 2 ? "grid-cols-2" : combos.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
                    {combos.map((c, i) => {
                      const pc = p?.[i]
                      return (
                        <div key={comboKey(c) + i} className="bg-gray-50 rounded-lg px-2.5 py-1.5">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 truncate">{labelCombo(c)}</p>
                          {p === undefined ? (
                            <p className="font-bold text-gray-900">…</p>
                          ) : !pc ? (
                            <p className="font-bold text-gray-900">—</p>
                          ) : (
                            <>
                              <p className="font-bold text-gray-900 leading-tight">
                                {formatCurrency(pc.cc)} <span className="text-[10px] font-bold text-gray-400">C.CTE</span>
                              </p>
                              <p className="font-bold text-emerald-700 text-sm leading-tight">
                                {formatCurrency(pc.contado)} <span className="text-[10px] font-bold text-emerald-600/70">CONTADO</span>
                              </p>
                            </>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Foto ampliada */}
      {zoomFoto && (
        <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4" onClick={() => setZoomFoto(null)}>
          <img src={zoomFoto} alt="" className="max-w-full max-h-[85dvh] object-contain rounded-xl" />
          <button className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/20 text-white text-xl leading-none">✕</button>
        </div>
      )}

      {/* Sheet: agregar comparación */}
      {verAgregar && (
        <AgregarComboSheet
          listas={listas}
          metodos={metodos}
          onCerrar={() => setVerAgregar(false)}
          onAgregar={(c) => {
            setVerAgregar(false)
            setCombos((prev) => (prev.some((x) => comboKey(x) === comboKey(c)) ? prev : [...prev, c]))
          }}
        />
      )}
    </div>
  )
}

function AgregarComboSheet({
  listas,
  metodos,
  onCerrar,
  onAgregar,
}: {
  listas: Lista[]
  metodos: Metodo[]
  onCerrar: () => void
  onAgregar: (c: Combo) => void
}) {
  const [listaId, setListaId] = useState(listas[0]?.id || "")
  const [metodo, setMetodo] = useState("Factura")
  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/40" onClick={onCerrar}>
      <div className="bg-white w-full rounded-t-3xl p-5 max-w-2xl mx-auto space-y-4" onClick={(e) => e.stopPropagation()}>
        <p className="font-bold text-gray-900 text-lg">Agregar comparación</p>
        <div>
          <label className="text-gray-500 text-sm block mb-1">Lista de precios</label>
          <select value={listaId} onChange={(e) => setListaId(e.target.value)} className="w-full rounded-xl border border-gray-300 px-4 py-3 bg-white">
            {listas.map((l) => (
              <option key={l.id} value={l.id}>{l.nombre}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-gray-500 text-sm block mb-1">Facturación</label>
          <div className="grid grid-cols-3 gap-2">
            {metodos.map((m) => (
              <button
                key={m.key}
                onClick={() => setMetodo(m.key)}
                className={`rounded-xl py-3 text-sm font-bold border ${metodo === m.key ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-gray-700 border-gray-300"}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={() => listaId && onAgregar({ lista_id: listaId, metodo })}
          className="w-full bg-emerald-600 text-white rounded-xl py-4 font-bold"
        >
          Agregar columna
        </button>
      </div>
    </div>
  )
}
