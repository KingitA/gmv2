import { useMemo, useState } from "react"
import { useOverlay } from "@gm/core"
import type { SegsPedido } from "../../datasets"
import { useCatalogosFicha } from "../../datos/hooks"
import { clienteListasDe, fichaListasDe, haySegsPedido, metodoLabel, SEGMENTOS_PRECIO, segsAOverrides, useSegmentosCliente, type CondSegmento } from "../../datos/segmentos"
import { CuadroSegmentos } from "../segmentos-ui"
import { usePedidoEnCurso } from "./contexto"

// Lista y facturación de ESTE pedido, en "Confirmar pedido" (Juan, 03/11/2026): general o
// POR SEGMENTO, sin tocar la ficha del cliente. La ficha (este y los próximos pedidos) se
// cambia desde la ficha del cliente. Lo elegido por segmento le gana a lo general.

const METODOS = [
  { key: "Factura", label: "Factura" },
  { key: "Final", label: "Final (mixto)" },
  { key: "Presupuesto", label: "Presupuesto" },
]
const selCls = "w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-sm text-gray-900"
const textoFicha = (f: CondSegmento | undefined) => (f ? `${f.listaNombre ?? "sin lista"} · ${metodoLabel(f.metodo) ?? "sin método"}` : "")

/** Tarjeta del carrito: cómo se factura el pedido + "Cambiar solo en este pedido". */
export function ListaMetodoPedido() {
  const p = usePedidoEnCurso()
  const hoja = useOverlay("lista-pedido")
  if (!p.segmentos) return null
  return (
    <div className="space-y-2">
      <CuadroSegmentos resumen={p.segmentos} titulo="Cómo se factura este pedido" />
      <button onClick={hoja.abrir} className="min-h-11 w-full rounded-xl border border-emerald-600 bg-white px-3 text-sm font-bold text-emerald-700">
        ✏️ Cambiar solo en este pedido
      </button>
      {hoja.abierto && <HojaListaPedido onCerrar={hoja.cerrar} />}
    </div>
  )
}

function HojaListaPedido({ onCerrar }: { onCerrar: () => void }) {
  const p = usePedidoEnCurso()
  const cat = useCatalogosFicha()
  const puedeLista = !!cat?.puede_cambiar_lista
  const listas = cat?.listas_precio ?? []
  const fichaLocal = useMemo(
    () => (p.cliente?.sinEnviar ? clienteListasDe(fichaListasDe(p.cliente as unknown as Record<string, unknown>)) : null),
    [p.cliente],
  )
  const ficha = useSegmentosCliente(p.clienteId, {}, fichaLocal)
  // Sin tocar: arranca "por segmento" si el pedido o la ficha ya van segmentados (la ficha puede llegar un render después)
  const [modo, setPorSegmento] = useState<boolean | null>(null)
  const porSegmento = modo ?? (haySegsPedido(p.cond.segs) || (!p.cond.metodo && !p.cond.lista && !!ficha && !ficha.uniforme))
  const [metodo, setMetodo] = useState(p.cond.metodo)
  const [lista, setLista] = useState(p.cond.lista)
  const [segs, setSegs] = useState<SegsPedido>(() => p.cond.segs ?? {})

  // Vista previa con lo elegido (mismo resolver que el motor)
  const ov = porSegmento
    ? segsAOverrides(segs)
    : { ...(metodo ? { metodo_facturacion_pedido: metodo } : {}), ...(lista ? { lista_precio_pedido_id: lista } : {}) }
  const preview = useSegmentosCliente(p.clienteId, ov, fichaLocal)

  const setSeg = (seg: keyof SegsPedido, cambio: { lista?: string; metodo?: string }) =>
    setSegs((prev) => ({ ...prev, [seg]: { ...prev[seg], ...cambio } }))

  const aplicar = () => {
    if (porSegmento) p.setCond({ ...p.cond, metodo: "", lista: "", segs })
    else p.setCond({ ...p.cond, metodo, lista, ...(p.cond.segs !== undefined ? { segs: {} } : {}) })
    onCerrar()
  }
  const comoLaFicha = () => {
    p.setCond({ ...p.cond, metodo: "", lista: "", ...(p.cond.segs !== undefined ? { segs: {} } : {}) })
    onCerrar()
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/40" onClick={onCerrar}>
      <div className="mx-auto max-h-[92dvh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-t-3xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div>
          <p className="text-lg font-bold text-gray-900">Lista y facturación de este pedido</p>
          <p className="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <b>Solo cambia ESTE pedido.</b> Para que quede para los próximos, cambialo en la ficha del cliente.
          </p>
        </div>

        <div className="flex rounded-xl bg-gray-100 p-1 text-sm font-bold">
          {([false, true] as const).map((v) => (
            <button key={String(v)} type="button" onClick={() => setPorSegmento(v)}
              className={`min-h-10 flex-1 rounded-lg ${porSegmento === v ? "bg-white text-emerald-700 shadow-sm" : "text-gray-500"}`}>
              {v ? "Por segmento" : "Todo el pedido igual"}
            </button>
          ))}
        </div>

        {!porSegmento ? (
          <div className="space-y-3">
            {puedeLista && (
              <label className="block">
                <span className="mb-1 block text-sm font-bold text-gray-700">Lista de precios</span>
                <select value={lista} onChange={(e) => setLista(e.target.value)} className={selCls}>
                  <option value="">Como la ficha ({ficha?.uniforme ? ficha.filas[0]!.listaNombre ?? "sin lista" : "por segmento"})</option>
                  {listas.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                </select>
              </label>
            )}
            <label className="block">
              <span className="mb-1 block text-sm font-bold text-gray-700">Facturación</span>
              <select value={metodo} onChange={(e) => setMetodo(e.target.value)} className={selCls}>
                <option value="">Como la ficha ({ficha?.uniforme ? metodoLabel(ficha.filas[0]!.metodo) ?? "sin método" : "por segmento"})</option>
                {METODOS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </label>
          </div>
        ) : (
          <div className="space-y-2">
            {SEGMENTOS_PRECIO.map(({ seg, label }) => {
              const f = ficha?.filas.find((x) => x.seg === seg)
              return (
                <div key={seg} className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-bold text-gray-800">{label}</p>
                    <p className="truncate text-[11px] text-gray-400">Ficha: {textoFicha(f)}</p>
                  </div>
                  <div className={`grid gap-2 ${puedeLista ? "grid-cols-2" : "grid-cols-1"}`}>
                    {puedeLista && (
                      <label className="block">
                        <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-wide text-gray-400">Lista</span>
                        <select value={segs[seg]?.lista ?? ""} onChange={(e) => setSeg(seg, { lista: e.target.value })} className={selCls} aria-label={`Lista ${label}`}>
                          <option value="">Como la ficha</option>
                          {listas.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                        </select>
                      </label>
                    )}
                    <label className="block">
                      <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-wide text-gray-400">Facturación</span>
                      <select value={segs[seg]?.metodo ?? ""} onChange={(e) => setSeg(seg, { metodo: e.target.value })} className={selCls} aria-label={`Facturación ${label}`}>
                        <option value="">Como la ficha</option>
                        {METODOS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                      </select>
                    </label>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {preview && <CuadroSegmentos resumen={preview} titulo="Así se factura este pedido" />}
        {!puedeLista && <p className="text-xs text-gray-400">La lista de precios no la podés cambiar (la asigna la oficina o el viajante).</p>}

        <div className="space-y-2 pt-1">
          <button onClick={aplicar} className="w-full rounded-xl bg-emerald-600 py-3.5 text-base font-bold text-white">✅ Aplicar solo a este pedido</button>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={onCerrar} className="rounded-xl border border-gray-300 bg-white py-3 text-sm font-bold text-gray-700">Cancelar</button>
            <button onClick={comoLaFicha} className="rounded-xl border border-gray-300 bg-white py-3 text-sm font-bold text-gray-700">↩ Como la ficha</button>
          </div>
        </div>
      </div>
    </div>
  )
}
