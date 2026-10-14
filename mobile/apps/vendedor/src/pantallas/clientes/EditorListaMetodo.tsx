import { useState } from "react"
import { clienteListasDe, COLS_SEGMENTO, resumirSegmentos, type FichaListas } from "../../datos/segmentos"
import { CuadroSegmentos } from "../segmentos-ui"

// Lista y método de facturación de la ficha: GENERAL o POR SEGMENTO (Limpieza/Bazar ·
// Perfumería 0 · Perfumería plus), igual que la ficha del ERP (decisión del dueño,
// 09/10/2026). Lo usan el alta de cliente, la edición de la ficha y la venta a cliente
// nuevo. Abajo muestra cómo queda cada segmento: un segmento sin lista o sin método se
// marca en rojo (con eso no se puede cerrar un pedido).

const METODOS = [
  { key: "Factura", label: "Factura (21% IVA)" },
  { key: "Final", label: "Final (mixto)" },
  { key: "Presupuesto", label: "Presupuesto" },
]
const selCls = "w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-gray-900"

function Toggle({ porSegmento, onCambiar }: { porSegmento: boolean; onCambiar: (v: boolean) => void }) {
  return (
    <div className="flex rounded-lg bg-gray-100 p-0.5 text-xs font-bold">
      {([false, true] as const).map((v) => (
        <button key={String(v)} type="button" onClick={() => onCambiar(v)}
          className={`min-h-9 rounded-md px-3 ${porSegmento === v ? "bg-white text-emerald-700 shadow-sm" : "text-gray-500"}`}>
          {v ? "Por segmento" : "General"}
        </button>
      ))}
    </div>
  )
}

export function EditorListaMetodo({ valor, onCambiar, listas, puedeLista, listaImpuesta }: {
  valor: FichaListas
  onCambiar: (f: FichaListas) => void
  /** Listas que el vendedor puede asignar (Neco + las de sus viajantes) */
  listas: Array<{ id: string; nombre: string }>
  /** Sin permiso: la lista no se toca (la asigna la oficina / el viajante) */
  puedeLista: boolean
  /** Nombre de la lista GENERAL que impone el viajante (no se elige a mano) */
  listaImpuesta?: string | null
}) {
  const [listaSeg, setListaSeg] = useState(() => COLS_SEGMENTO.some((c) => !!valor[c.lista]))
  const [metodoSeg, setMetodoSeg] = useState(() => COLS_SEGMENTO.some((c) => !!valor[c.metodo]))
  const set = (cambios: Partial<FichaListas>) => onCambiar({ ...valor, ...cambios })
  const nombreLista = (id: string) => listas.find((l) => l.id === id)?.nombre ?? null
  const listaGeneral = listaImpuesta || (valor.lista_precio_id ? nombreLista(valor.lista_precio_id) : null)
  const resumen = resumirSegmentos(clienteListasDe(valor), {}, (id) => nombreLista(id) ?? (id === valor.lista_precio_id ? listaImpuesta ?? null : null))

  const cambiarListaSeg = (v: boolean) => {
    setListaSeg(v)
    if (!v) set({ lista_limpieza_id: "", lista_perf0_id: "", lista_perf_plus_id: "" })
  }
  const cambiarMetodoSeg = (v: boolean) => {
    setMetodoSeg(v)
    // Igual que el ERP: por segmento, el general queda vacío (cada segmento define el suyo)
    if (v) set({ metodo_facturacion: "", metodo_limpieza: valor.metodo_limpieza || valor.metodo_facturacion, metodo_perf0: valor.metodo_perf0 || valor.metodo_facturacion, metodo_perf_plus: valor.metodo_perf_plus || valor.metodo_facturacion })
    else set({ metodo_facturacion: valor.metodo_facturacion || valor.metodo_limpieza || valor.metodo_perf0 || valor.metodo_perf_plus, metodo_limpieza: "", metodo_perf0: "", metodo_perf_plus: "" })
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-gray-700">Lista de precios</span>
          {puedeLista && <Toggle porSegmento={listaSeg} onCambiar={cambiarListaSeg} />}
        </div>
        {!puedeLista ? (
          <p className="rounded-xl bg-gray-50 px-3 py-3 text-sm text-gray-600">{listaGeneral || "Sin lista"} <span className="text-xs text-gray-400">(la asigna la oficina)</span></p>
        ) : listaSeg ? (
          <p className="text-xs text-gray-500">Se elige en cada segmento, más abajo.{listaGeneral ? ` Lo que quede en "como la general" va con ${listaGeneral}.` : ""}</p>
        ) : listaImpuesta ? (
          <p className="rounded-xl bg-gray-50 px-3 py-3 text-sm text-gray-600">{listaImpuesta} <span className="text-xs text-gray-400">(por viajante)</span></p>
        ) : (
          <select value={valor.lista_precio_id} onChange={(e) => set({ lista_precio_id: e.target.value })} className={selCls}>
            <option value="">Elegir lista...</option>
            {listas.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
          </select>
        )}
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-gray-700">Facturación</span>
          <Toggle porSegmento={metodoSeg} onCambiar={cambiarMetodoSeg} />
        </div>
        {metodoSeg ? (
          <p className="text-xs text-gray-500">Se elige en cada segmento, más abajo.</p>
        ) : (
          <select value={valor.metodo_facturacion} onChange={(e) => set({ metodo_facturacion: e.target.value })} className={selCls}>
            <option value="">Elegir método...</option>
            {METODOS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        )}
      </div>

      {(listaSeg || metodoSeg) && (
        <div className="space-y-2">
          {COLS_SEGMENTO.map((c) => (
            <div key={c.seg} className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
              <p className="text-sm font-bold text-gray-800">{c.label}</p>
              <div className="grid grid-cols-2 gap-2">
                {listaSeg && (
                  <select value={valor[c.lista]} onChange={(e) => set({ [c.lista]: e.target.value } as Partial<FichaListas>)} className={selCls} aria-label={`Lista ${c.label}`}>
                    <option value="">Como la general{listaGeneral ? ` (${listaGeneral})` : ""}</option>
                    {listas.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                  </select>
                )}
                {metodoSeg && (
                  <select value={valor[c.metodo]} onChange={(e) => set({ [c.metodo]: e.target.value } as Partial<FichaListas>)} className={`${selCls} ${listaSeg ? "" : "col-span-2"}`} aria-label={`Facturación ${c.label}`}>
                    <option value="">Elegir método...</option>
                    {METODOS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                  </select>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <CuadroSegmentos resumen={resumen} titulo="Así queda cada segmento" />
      {resumen.incompleto && <p className="text-xs font-bold text-red-600">Falta lista o método en algún segmento: así no se puede cerrar un pedido.</p>}
    </div>
  )
}

/** true = los tres segmentos tienen lista y método (regla del dueño). */
export function fichaCompleta(f: FichaListas): boolean {
  return !resumirSegmentos(clienteListasDe(f), {}, () => "x").incompleto
}

