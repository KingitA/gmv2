"use client"

// Condición y forma de pago SOLO PARA ESTE PEDIDO (fase 2, 19/11/2026). Mismos
// controles que la ficha del cliente. Vacío = sin cargar (en rojo), nunca un valor
// supuesto; "Como la ficha" muestra la del cliente para comparar.

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { InputMonto } from "@/components/ui/input-monto"
import { CONDICIONES, FORMAS, textoCondicionPago, type CondicionPago } from "@/lib/clientes/condicion-pago"

const vacioCls = (v: unknown) => (v == null || v === "" ? "text-red-600 border-red-300" : "")
const entero = (n: number | null) => (n == null ? null : Math.trunc(n))

export function CondicionPagoPedido({
  value,
  onChange,
  disabled,
  ficha,
}: {
  value: CondicionPago
  onChange: (c: CondicionPago) => void
  disabled?: boolean
  /** Texto de la condición de la ficha del cliente, para comparar */
  ficha?: string
}) {
  const set = (patch: Partial<CondicionPago>) => onChange({ ...value, ...patch })
  const texto = textoCondicionPago(value)
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={value.condicion_pago_tipo || "__none__"}
          onValueChange={(v) => set({ condicion_pago_tipo: v === "__none__" ? null : (v as CondicionPago["condicion_pago_tipo"]), plazo_dias: v === "cuenta_corriente" ? value.plazo_dias : v === "__none__" ? null : 0 })}
          disabled={disabled}
        >
          <SelectTrigger className={`h-9 w-48 ${vacioCls(value.condicion_pago_tipo)}`}><SelectValue placeholder="Sin cargar" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Sin cargar</SelectItem>
            {CONDICIONES.map((c) => <SelectItem key={c.valor} value={c.valor}>{c.etiqueta}</SelectItem>)}
          </SelectContent>
        </Select>
        {value.condicion_pago_tipo === "cuenta_corriente" && (
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <InputMonto decimales={0} soloPositivos value={value.plazo_dias} onChange={(n) => set({ plazo_dias: entero(n) })} disabled={disabled} className={`h-9 w-20 ${vacioCls(value.plazo_dias)}`} />
            días
          </span>
        )}
        <Select
          value={value.forma_pago || "__none__"}
          onValueChange={(v) => set({ forma_pago: v === "__none__" ? null : (v as CondicionPago["forma_pago"]), ...(v === "cheque" ? {} : { cheque_dias_desde: null, cheque_dias_hasta: null }) })}
          disabled={disabled}
        >
          <SelectTrigger className={`h-9 w-40 ${vacioCls(value.forma_pago)}`}><SelectValue placeholder="Sin cargar" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Sin cargar</SelectItem>
            {FORMAS.map((f) => <SelectItem key={f.valor} value={f.valor}>{f.etiqueta}</SelectItem>)}
          </SelectContent>
        </Select>
        {value.forma_pago === "cheque" && (
          <span className="flex items-center gap-1.5 text-xs text-slate-500" title="Días desde el vencimiento de la deuda. Un cheque a 30: 30 a 30. Al día: 0 a 0. Cheques escalonados: 60 a 90.">
            de
            <InputMonto decimales={0} soloPositivos value={value.cheque_dias_desde} onChange={(n) => set({ cheque_dias_desde: entero(n) })} disabled={disabled} className="h-9 w-16" />
            a
            <InputMonto decimales={0} soloPositivos value={value.cheque_dias_hasta} onChange={(n) => set({ cheque_dias_hasta: entero(n) })} disabled={disabled} className="h-9 w-16" />
            días
          </span>
        )}
      </div>
      <p className="text-xs text-slate-500">
        {texto ? <>Este pedido: <b className="text-slate-700">{texto}</b></> : <span className="font-semibold text-red-600">Sin condición de pago</span>}
        {ficha !== undefined && <> · Ficha del cliente: {ficha || <span className="text-red-600">sin cargar</span>}</>}
      </p>
    </div>
  )
}
