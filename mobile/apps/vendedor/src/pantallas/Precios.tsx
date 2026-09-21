import { useDeferredValue, useMemo, useState } from "react"
import { useOverlay, useParamEstado } from "@gm/core"
import { Hoja } from "@gm/core/ui"
import { ordenarArticulos, type OrdenArticulos } from "@gm/vendedor"
import { DS, type Articulo, type ListaPrecio } from "../datasets"
import { buscarCatalogo } from "../datos/busqueda"
import { useCatalogo, useListasPermitidas, useTaxonomia, useVentas } from "../datos/hooks"
import { useMotoresLista, usePreciosVencidos } from "../datos/precios"
import { formatCurrency, Pantalla, SinDescargar, useBusqueda, useFotoZoom, ZoomFoto } from "../ui"
import { CatalogoArbol, OrdenSelector } from "./pedido-nuevo/piezas"

// Consulta y comparación de precios por LISTA × método (port de app/vendedor/precios).
// En la web los precios venían de previewPreciosListas (servidor); acá los da el MISMO
// motor sobre la réplica, sin cliente (sin condiciones ni bonificaciones), al instante.

interface Combo { lista_id: string; metodo: string }
const comboKey = (c: Combo) => `${c.lista_id}|${c.metodo}`
const MAX_COMBOS = 4

export function Precios() {
  const { indice, vacio } = useCatalogo()
  const taxonomia = useTaxonomia()
  const ventas = useVentas()
  const { listas, metodos } = useListasPermitidas()
  const foto = useFotoZoom()
  const agregar = useOverlay("agregar")
  const vencidos = usePreciosVencidos()
  const [q, setQ] = useBusqueda("q")
  const [orden, setOrden] = useParamEstado("orden", "default")
  const [combosParam, setCombosParam] = useParamEstado("c")
  const qDiferida = useDeferredValue(q)

  // Columnas: por defecto Neco Factura + Neco Final (igual que la web)
  const combos = useMemo<Combo[]>(() => {
    const deUrl = combosParam.split(",").map((x) => x.split("|")).filter((x) => x.length === 2 && listas.some((l) => l.id === x[0])).map(([lista_id, metodo]) => ({ lista_id: lista_id!, metodo: metodo! }))
    if (deUrl.length) return deUrl.slice(0, MAX_COMBOS)
    const neco = listas.find((l) => l.codigo === "neco") || listas[0]
    return neco ? [{ lista_id: neco.id, metodo: "Factura" }, { lista_id: neco.id, metodo: "Final" }] : []
  }, [combosParam, listas])
  const setCombos = (l: Combo[]) => setCombosParam(l.map(comboKey).join(","))
  const motores = useMotoresLista(combos)

  const nombreLista = (id: string) => listas.find((l) => l.id === id)?.nombre || "Lista"
  const labelMetodo = (m: string) => metodos.find((x) => x.key === m)?.label || m
  const variasListas = new Set(combos.map((c) => c.lista_id)).size > 1
  const labelCombo = (c: Combo) => (variasListas ? `${nombreLista(c.lista_id)} ${labelMetodo(c.metodo)}` : labelMetodo(c.metodo))
  const ordenar = (arts: Articulo[]) => ordenarArticulos(arts, orden as OrdenArticulos, (a) => motores[0]?.precio(a.id)?.precio, ventas)

  const buscando = qDiferida.trim().length >= 2
  const resultados = useMemo(() => (buscando ? buscarCatalogo(indice, qDiferida) : []), [buscando, indice, qDiferida])
  const grid = combos.length <= 2 ? "grid-cols-2" : combos.length === 3 ? "grid-cols-3" : "grid-cols-2"

  const Celdas = ({ a, grande }: { a: Articulo; grande?: boolean }) => (
    <div className={`grid gap-1.5 ${grid} ${grande ? "mt-2.5" : "mt-1.5"}`}>
      {combos.map((c, i) => {
        const p = motores[i]?.precio(a.id)
        return grande ? (
          <div key={comboKey(c) + i} className="rounded-lg bg-gray-50 px-2.5 py-1.5">
            <p className="truncate text-[10px] font-bold uppercase tracking-wide text-gray-400">{labelCombo(c)}</p>
            {!p ? <p className="font-bold text-gray-900">—</p> : (
              <>
                <p className="font-bold leading-tight text-gray-900">{formatCurrency(p.precio)} <span className="text-[10px] font-bold text-gray-400">C.CTE</span></p>
                <p className="text-sm font-bold leading-tight text-emerald-700">{formatCurrency(p.contado)} <span className="text-[10px] font-bold text-emerald-600/70">CONTADO</span></p>
              </>
            )}
          </div>
        ) : (
          <div key={comboKey(c) + i} className="flex items-baseline justify-between gap-1 rounded bg-gray-50 px-2 py-1">
            <span className="truncate text-[9px] font-bold uppercase text-gray-400">{labelCombo(c)}</span>
            <span className="text-right leading-tight">
              <span className="text-[12px] font-bold text-gray-900">{!p ? "—" : formatCurrency(p.precio)}</span>
              {p && <span className="block text-[10px] font-bold text-emerald-700">{formatCurrency(p.contado)} ctdo</span>}
            </span>
          </div>
        )
      })}
    </div>
  )

  // Fila compacta del árbol: sku · descripción · marca · x u/bulto · precio por columna
  const filaArbol = (a: Articulo) => (
    <div className="w-full rounded-lg border border-gray-100 bg-white px-2.5 py-2">
      <div className="flex items-center gap-2.5">
        {a.imagen_url ? (
          <button onClick={() => foto.abrir(a.imagen_url)} className="flex h-11 w-11 shrink-0 items-center justify-center"><img src={a.imagen_url} alt="" loading="lazy" className="h-8 w-8 rounded bg-gray-50 object-contain" /></button>
        ) : <span className="w-8 shrink-0 truncate font-mono text-[11px] text-gray-400">{a.sku || ""}</span>}
        <span className="min-w-0 flex-1">
          <span className="text-[13px] font-bold leading-snug text-gray-900">{a.descripcion}</span>
          <span className="block text-[11px] text-gray-400">{a.sku ? `SKU ${a.sku}` : ""}{a.marca ? ` · ${a.marca}` : ""}{a.unidades_por_bulto ? ` · x${a.unidades_por_bulto}` : ""}</span>
        </span>
      </div>
      <Celdas a={a} />
    </div>
  )

  return (
    <Pantalla titulo="💲 Precios" preciosVencidos={vencidos} dataset={DS.preciosArticulos} etiquetaFrescura="Precios al" viejoTrasMin={30}>
      <div className="bg-slate-900 px-4 pb-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar artículo, SKU o código de barras..." inputMode="search" className="w-full rounded-xl border-0 bg-white px-4 py-2.5 text-gray-900 placeholder:text-gray-400" />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {combos.map((c, i) => (
            <span key={comboKey(c) + i} className="flex min-h-9 items-center gap-1 rounded-full border border-emerald-500 bg-emerald-600 pl-3 pr-1 text-xs font-bold text-white">
              {nombreLista(c.lista_id)} · {labelMetodo(c.metodo)}
              {combos.length > 1 && <button onClick={() => setCombos(combos.filter((_, k) => k !== i))} className="h-8 w-8 rounded-full text-[11px] leading-none" aria-label="Quitar columna">✕</button>}
            </span>
          ))}
          {combos.length < MAX_COMBOS && listas.length > 0 && <button onClick={agregar.abrir} className="min-h-9 rounded-full bg-white px-3 text-xs font-bold text-emerald-700">+ Comparar</button>}
        </div>
      </div>

      {vacio ? <SinDescargar que="el catálogo" /> : (
        <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
          {!buscando ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">Catálogo</p>
                <OrdenSelector value={orden as OrdenArticulos} onChange={setOrden} />
              </div>
              {!taxonomia.length ? <SinDescargar que="el catálogo por rubro" /> : (
                <CatalogoArbol clave="precios" rubros={taxonomia} articulosDe={(catId) => indice.porCategoria.get(catId) || []} renderArticulo={filaArbol} ordenar={ordenar} />
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <p className="text-xs text-gray-400">{resultados.length} artículos</p>
                <OrdenSelector value={orden as OrdenArticulos} onChange={setOrden} />
              </div>
              {!resultados.length && <p className="py-10 text-center text-gray-400">Sin artículos.</p>}
              {ordenar(resultados).map((a) => (
                <div key={a.id} className="rounded-xl border border-gray-200 bg-white p-3.5">
                  <div className="flex gap-3">
                    {a.imagen_url && <button onClick={() => foto.abrir(a.imagen_url)} className="shrink-0"><img src={a.imagen_url} alt="" loading="lazy" className="h-14 w-14 rounded-lg bg-gray-50 object-contain" /></button>}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold leading-snug text-gray-900">{a.descripcion}</p>
                      <p className="mt-0.5 text-xs text-gray-400">{a.sku ? `SKU ${a.sku}` : ""}{a.marca ? ` · ${a.marca}` : ""}{a.unidades_por_bulto ? ` · ${a.unidades_por_bulto} u/bulto` : ""}</p>
                    </div>
                  </div>
                  <Celdas a={a} grande />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {agregar.abierto && (
        <AgregarCombo
          listas={listas} metodos={metodos} onCerrar={agregar.cerrar}
          onAgregar={(c) => { if (!combos.some((x) => comboKey(x) === comboKey(c))) setCombos([...combos, c]); agregar.cerrar() }}
        />
      )}
      {foto.src && <ZoomFoto src={foto.src} onCerrar={foto.cerrar} />}
    </Pantalla>
  )
}

function AgregarCombo({ listas, metodos, onCerrar, onAgregar }: { listas: ListaPrecio[]; metodos: Array<{ key: string; label: string }>; onCerrar: () => void; onAgregar: (c: Combo) => void }) {
  const [listaId, setListaId] = useState(listas[0]?.id || "")
  const [metodo, setMetodo] = useState("Factura")
  return (
    <Hoja abierta onCerrar={onCerrar} titulo="Agregar comparación">
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm text-gray-500">Lista de precios</label>
          <select value={listaId} onChange={(e) => setListaId(e.target.value)} className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3">
            {listas.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm text-gray-500">Facturación</label>
          <div className="grid grid-cols-3 gap-2">
            {metodos.map((m) => (
              <button key={m.key} onClick={() => setMetodo(m.key)} className={`min-h-11 rounded-xl border py-3 text-sm font-bold ${metodo === m.key ? "border-emerald-600 bg-emerald-600 text-white" : "border-gray-300 bg-white text-gray-700"}`}>{m.label}</button>
            ))}
          </div>
        </div>
        <button onClick={() => listaId && onAgregar({ lista_id: listaId, metodo })} className="w-full rounded-xl bg-emerald-600 py-4 font-bold text-white">Agregar columna</button>
      </div>
    </Hoja>
  )
}
