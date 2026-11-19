import { useState } from "react"
import { useOverlay } from "@gm/core"
import { normalizarCondicion, textoCondicionPago, type CondicionPago } from "@gm/condicion-pago"
import { condicionDeCliente } from "../../datos/condicion-pago"
import { EditorCondicionPago } from "../clientes/EditorCondicionPago"
import { usePedidoEnCurso } from "./contexto"

// Condición de pago del pedido en "Confirmar pedido" (condiciones de pago, fase 4 —
// 19/11/2026): la de la ficha, o una distinta SOLO para este pedido (como lista/método).
// Nunca frena: sin condición el pedido se manda igual y el ERP la muestra en rojo.

const igual = (a: CondicionPago, b: CondicionPago) => JSON.stringify(normalizarCondicion(a)) === JSON.stringify(normalizarCondicion(b))

export function CondicionPagoPedido() {
  const p = usePedidoEnCurso()
  const hoja = useOverlay("cond-pago")
  const ficha = condicionDeCliente(p.cliente)
  const vigente = p.cond.condPago ?? ficha
  const texto = textoCondicionPago(normalizarCondicion(vigente))
  const soloEste = !!p.cond.condPago && !igual(p.cond.condPago, ficha)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-gray-500">Condición de pago</span>
        <span className={`text-right text-sm font-bold ${texto ? "text-gray-900" : "text-amber-700"}`}>{texto || "Sin cargar"}</span>
      </div>
      {soloEste && <p className="text-xs font-medium text-amber-700">Cambiada solo para este pedido: la ficha del cliente sigue igual.</p>}
      <button onClick={hoja.abrir} className="min-h-11 w-full rounded-xl border border-emerald-600 bg-white px-3 text-sm font-bold text-emerald-700">
        ✏️ Condición de pago solo este pedido
      </button>
      {hoja.abierto && <HojaCondicionPago inicial={vigente} ficha={ficha} onCerrar={hoja.cerrar} />}
    </div>
  )
}

function HojaCondicionPago({ inicial, ficha, onCerrar }: { inicial: CondicionPago; ficha: CondicionPago; onCerrar: () => void }) {
  const p = usePedidoEnCurso()
  const [valor, setValor] = useState<CondicionPago>(inicial)
  const textoFicha = textoCondicionPago(ficha) || "sin cargar"

  const aplicar = () => {
    // Igual a la ficha = no es un cambio "solo este pedido"
    p.setCond({ ...p.cond, condPago: igual(valor, ficha) ? null : normalizarCondicion(valor) })
    onCerrar()
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/40" onClick={onCerrar}>
      <div className="mx-auto max-h-[92dvh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-t-3xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div>
          <p className="text-lg font-bold text-gray-900">Condición de pago de este pedido</p>
          <p className="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <b>Solo cambia ESTE pedido.</b> La ficha dice: <b>{textoFicha}</b>. Para cambiarla para los próximos, hacelo en la ficha del cliente.
          </p>
        </div>
        <EditorCondicionPago valor={valor} onCambiar={setValor} titulo={false} />
        <div className="space-y-2 pt-1">
          <button onClick={aplicar} className="w-full rounded-xl bg-emerald-600 py-3.5 text-base font-bold text-white">✅ Aplicar solo a este pedido</button>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={onCerrar} className="rounded-xl border border-gray-300 bg-white py-3 text-sm font-bold text-gray-700">Cancelar</button>
            <button onClick={() => { p.setCond({ ...p.cond, condPago: null }); onCerrar() }} className="rounded-xl border border-gray-300 bg-white py-3 text-sm font-bold text-gray-700">↩ Como la ficha</button>
          </div>
        </div>
      </div>
    </div>
  )
}
