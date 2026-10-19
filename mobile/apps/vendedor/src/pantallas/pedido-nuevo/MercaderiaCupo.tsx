import { useDeferredValue, useMemo, useState } from "react"
import { useOverlay } from "@gm/core"
import { Hoja } from "@gm/core/ui"
import { buscarCatalogo } from "../../datos/busqueda"
import { cuposDelPedido, useCondicionesFicha } from "../../datos/condiciones"
import { useCatalogo, useProveedores } from "../../datos/hooks"
import { useInsumosBase } from "../../datos/precios"
import { formatCurrency } from "../../ui"
import { usePedidoEnCurso } from "./contexto"

// MERCADERÍA BONIFICADA POR CUPO (= ERP, regla del dueño 06/10): el cliente tiene un % de
// mercadería sin cargo (ficha, pedido o condición de proveedor/marca). Cada cupo es ese % del
// neto de lo que cae en él; el vendedor elige QUÉ artículos regalar. Las unidades las fija el
// sistema al cerrar el picking sobre lo preparado. Un cupo sin artículos queda PENDIENTE y esa
// mercadería no se factura hasta que la oficina la elija.

export function MercaderiaCupo() {
  const p = usePedidoEnCurso()
  const base = useInsumosBase()
  const ficha = useCondicionesFicha(p.clienteId)
  const proveedores = useProveedores()
  const { indice } = useCatalogo()
  const hoja = useOverlay("regalo")
  const [origen, setOrigen] = useState("")
  const [q, setQ] = useState("")
  const qd = useDeferredValue(q)
  const esNuevo = !p.borrador?.pedidoId

  const marcaDe = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of indice.articulos) if (a.marca_id && a.marca) m.set(a.marca_id, a.marca)
    return m
  }, [indice])
  const cupos = useMemo(() => cuposDelPedido(
    p.lineas.filter((l) => !l.fijo && l.precio).flatMap((l) => {
      const art = base.articulos.get(l.articuloId)
      return art ? [{ art, cantidad: l.cantidad, neto: l.precio!.precioNeto }] : []
    }),
    ficha,
    p.cond,
    { proveedor: (id) => proveedores.find((x) => x.id === id)?.nombre ?? "", marca: (id) => marcaDe.get(id) ?? "" },
  ), [p.lineas, p.cond, base.articulos, ficha, proveedores, marcaDe])

  if (!cupos.length) return null
  const elegidos = (o: string) => p.cond.mercaderia?.[o] ?? []
  const setElegidos = (o: string, arts: Array<{ id: string; descripcion: string; sku: string | null }>) =>
    p.setCond({ ...p.cond, mercaderia: { ...(p.cond.mercaderia ?? {}), [o]: arts } })
  const nombreArt = (a: { id: string; descripcion: string }) => a.descripcion || indice.porId.get(a.id)?.descripcion || "Artículo"
  const resultados = qd.trim().length >= 2 ? buscarCatalogo(indice, qd).slice(0, 40) : []

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <div>
        <p className="text-sm font-bold text-gray-700">🎁 Mercadería bonificada</p>
        <p className="text-xs text-gray-400">Elegí qué artículos regalar en cada cupo. Las unidades las calcula el sistema al preparar el pedido.</p>
      </div>
      {cupos.map((c) => (
        <div key={c.origen} className="space-y-2 rounded-lg bg-gray-50 p-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-bold text-gray-900">{c.nombre} · {c.pct}%</p>
            <p className="shrink-0 text-sm font-bold text-green-700">≈ {formatCurrency(c.monto)}</p>
          </div>
          {elegidos(c.origen).map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate">{nombreArt(a)}</span>
              {esNuevo && <button onClick={() => setElegidos(c.origen, elegidos(c.origen).filter((x) => x.id !== a.id))} className="h-8 w-8 text-red-500" aria-label="Quitar">✕</button>}
            </div>
          ))}
          {!elegidos(c.origen).length && <p className="text-xs font-bold text-amber-700">Sin artículos elegidos: esta mercadería queda pendiente y no se factura hasta que se elija.</p>}
          {esNuevo
            ? <button onClick={() => { setOrigen(c.origen); setQ(""); hoja.abrir() }} className="min-h-11 w-full rounded-lg border border-emerald-600 bg-white text-sm font-bold text-emerald-700">Elegir qué regalar</button>
            : <p className="text-xs text-gray-500">En un pedido ya enviado, la mercadería la elige la oficina.</p>}
        </div>
      ))}

      <Hoja abierta={hoja.abierto && !!origen} onCerrar={hoja.cerrar} titulo="Elegí qué regalar">
        <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="Buscar artículo, SKU o EAN..." inputMode="search" className="mb-3 w-full rounded-xl border border-gray-300 px-4 py-3" />
        <div className="max-h-[50vh] space-y-1.5 overflow-y-auto">
          {qd.trim().length < 2 && <p className="py-6 text-center text-sm text-gray-400">Escribí al menos 2 letras.</p>}
          {resultados.map((a) => {
            const ya = elegidos(origen).some((x) => x.id === a.id)
            return (
              <button key={a.id} onClick={() => setElegidos(origen, ya ? elegidos(origen).filter((x) => x.id !== a.id) : [...elegidos(origen), { id: a.id, descripcion: a.descripcion, sku: a.sku }])}
                className={`flex min-h-12 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm ${ya ? "border-emerald-500 bg-emerald-50" : "border-gray-200 bg-white"}`}>
                <span className="text-lg">{ya ? "☑" : "☐"}</span>
                <span className="min-w-0 flex-1"><span className="block truncate font-bold text-gray-900">{a.descripcion}</span><span className="block text-xs text-gray-400">{a.sku ? `SKU ${a.sku}` : ""}{a.marca ? ` · ${a.marca}` : ""}</span></span>
              </button>
            )
          })}
        </div>
        <button onClick={hoja.cerrar} className="mt-3 w-full rounded-xl bg-emerald-600 py-3 font-bold text-white">Listo</button>
      </Hoja>
    </div>
  )
}
