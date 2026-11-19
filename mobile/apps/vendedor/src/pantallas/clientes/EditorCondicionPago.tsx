import { CONDICIONES, FORMAS, normalizarCondicion, textoCondicionPago, type CondicionPago } from "@gm/condicion-pago"

// Condición (cuándo paga) y forma (cómo paga) del cliente — condiciones de pago, fase 4
// (19/11/2026). Igual que la ficha del ERP: cada dato en su fila y abajo "Así queda:
// Contado · Efectivo". Lo usan la ficha, el alta y "solo este pedido". Nada es
// obligatorio: lo que falta queda vacío (nunca frena un alta ni un pedido).

const chip = (activo: boolean) =>
  `min-h-11 flex-1 rounded-xl border px-2 text-sm font-bold ${activo ? "border-emerald-600 bg-emerald-600 text-white" : "border-gray-300 bg-white text-gray-700"}`
const diasCls = "w-16 rounded-xl border border-gray-300 bg-white px-2 py-2.5 text-center text-base font-bold text-gray-900"

/** Días tipeados → número (vacío = null). Solo dígitos. */
const aDias = (s: string): number | null => {
  const t = s.replace(/\D/g, "").slice(0, 3)
  return t === "" ? null : Number(t)
}

function Dias({ valor, onCambiar, etiqueta }: { valor: number | null; onCambiar: (n: number | null) => void; etiqueta: string }) {
  return (
    <input
      value={valor == null ? "" : String(valor)}
      onChange={(e) => onCambiar(aDias(e.target.value))}
      inputMode="numeric"
      placeholder="0"
      aria-label={etiqueta}
      className={diasCls}
    />
  )
}

export function EditorCondicionPago({ valor, onCambiar, titulo = true }: { valor: CondicionPago; onCambiar: (c: CondicionPago) => void; titulo?: boolean }) {
  const set = (c: Partial<CondicionPago>) => onCambiar({ ...valor, ...c })
  const resumen = textoCondicionPago(normalizarCondicion(valor))

  return (
    <div className="space-y-3">
      {titulo && <p className="text-sm font-bold text-gray-700">Condición de pago</p>}

      <div>
        <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">Cuándo paga</p>
        <div className="flex gap-1.5">
          {CONDICIONES.map((c) => (
            <button key={c.valor} type="button" onClick={() => set({ condicion_pago_tipo: valor.condicion_pago_tipo === c.valor ? null : c.valor })} className={chip(valor.condicion_pago_tipo === c.valor)}>
              {c.etiqueta}
            </button>
          ))}
        </div>
        {valor.condicion_pago_tipo === "cuenta_corriente" && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700">
            <span>Paga a</span>
            <Dias valor={valor.plazo_dias} onCambiar={(n) => set({ plazo_dias: n })} etiqueta="Días de plazo" />
            <span>días de la factura</span>
            <div className="flex gap-1">
              {[15, 30, 60].map((d) => (
                <button key={d} type="button" onClick={() => set({ plazo_dias: d })} className="min-h-9 rounded-lg border border-gray-300 bg-white px-2 text-xs font-bold text-gray-600">{d}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div>
        <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">Cómo paga</p>
        <div className="flex gap-1.5">
          {FORMAS.map((f) => (
            <button key={f.valor} type="button" onClick={() => set({ forma_pago: valor.forma_pago === f.valor ? null : f.valor })} className={chip(valor.forma_pago === f.valor)}>
              {f.etiqueta}
            </button>
          ))}
        </div>
        {valor.forma_pago === "cheque" && (
          <div className="mt-2 space-y-1.5 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700">
            <div className="flex flex-wrap items-center gap-2">
              <span>Cheques de</span>
              <Dias valor={valor.cheque_dias_desde} onCambiar={(n) => set({ cheque_dias_desde: n })} etiqueta="Cheque desde días" />
              <span>a</span>
              <Dias valor={valor.cheque_dias_hasta} onCambiar={(n) => set({ cheque_dias_hasta: n })} etiqueta="Cheque hasta días" />
              <span>días</span>
            </div>
            <p className="text-xs text-gray-500">Los días cuentan desde el vencimiento. 0 a 0 = cheque al día; 30 a 30 = a 30 días.</p>
          </div>
        )}
      </div>

      <p className={`rounded-xl px-3 py-2 text-sm ${resumen ? "bg-emerald-50 text-emerald-900" : "bg-gray-50 text-gray-500"}`}>
        Así queda: <b>{resumen || "sin cargar"}</b>
      </p>
    </div>
  )
}
