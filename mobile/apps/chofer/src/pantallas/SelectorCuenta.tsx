import { useMemo } from "react"
import { PEDIDO_PREFIX } from "@gm/cobro"
import type { ComprobanteCobro } from "../datasets"
import {
  agruparCuenta, alternarAnticipo, alternarComprobante, alternarContadoPedido, alternarContadoTodo, alternarGrupo, alternarTodo, clavesDeLaCuenta,
  fijarMonto, montoAnticipo, resumenCuenta, saldoCobrable, type DatosCuenta, type EstadoCuenta,
} from "../datos/cuenta-cobro"
import { formatCurrency, formatDateAR } from "../ui"

// La cuenta de UN cliente dentro del cobro: pedidos y comprobantes seleccionables, "Incluir
// devoluciones como crédito" y "10% contado a todo". Es la MISMA pantalla para el cliente de la
// parada y para cada cliente agregado al cobro conjunto (regla del dueño, 01/10/2026: al agregar
// un cliente se ve su cuenta completa, igual que la del principal).

const fmt = (n: number) => Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 })

export function SelectorCuenta({ datos, estado, onChange, expandido, onExpandir }: {
  datos: DatosCuenta
  estado: EstadoCuenta
  onChange: (e: EstadoCuenta) => void
  /** id del pedido desplegado ("" = ninguno) */
  expandido: string
  onExpandir: (pedidoId: string) => void
}) {
  const { cobro } = datos
  const { compsPorPedido, sinPedido, pedidosSinFacturar, esSaldado } = useMemo(() => agruparCuenta(cobro), [cobro])
  const dtosHechos = useMemo(() => new Set(cobro.dtos_hechos), [cobro.dtos_hechos])
  const r = resumenCuenta(datos, estado)
  const sel = estado.sel
  const claves = clavesDeLaCuenta(cobro)
  const todoSeleccionado = claves.length > 0 && claves.every((k) => sel[k] !== undefined)
  const devPendientes = datos.devoluciones.filter((d) => d.estado === "pendiente")
  const nadaQueCobrar = cobro.pedidos.length === 0 && sinPedido.length === 0

  // Fila de comprobante (función de render, no componente: los inputs no pierden el foco)
  const filaComprobante = (cp: ComprobanteCobro, dentroDePedido: boolean) => {
    const checked = sel[cp.id] !== undefined
    return (
      <div key={cp.id} className={`flex items-center gap-2 border-t px-3 py-2 text-sm ${checked ? "bg-blue-50" : ""} ${dentroDePedido ? "" : "first:border-t-0"}`}>
        <input type="checkbox" checked={checked} onChange={() => onChange(alternarComprobante(estado, cp))} className="h-5 w-5 shrink-0" />
        <button onClick={() => onChange(alternarComprobante(estado, cp))} className="flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-x-2 text-left">
          <span className="rounded border px-1 text-xs">{cp.tipo_comprobante}</span>
          <span className="font-mono text-xs">{cp.numero_comprobante}</span>
          <span className="text-[10px] text-gray-400">{cp.fecha ? cp.fecha.slice(0, 10).split("-").reverse().join("/") : ""}</span>
          {dtosHechos.has(cp.id) && <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">Dto. ctdo</span>}
          {(cp.en_cobro || 0) > 0.005 && <span className="text-[10px] font-bold text-sky-600">🔒 {fmt(cp.en_cobro!)} en un cobro sin enviar</span>}
          <span className="ml-auto font-mono text-orange-600">saldo ${fmt(saldoCobrable(cp))}</span>
        </button>
        {checked ? (
          <input
            type="number" inputMode="decimal" min={0} max={saldoCobrable(cp)} step="0.01" value={sel[cp.id]}
            onChange={(e) => onChange(fijarMonto(estado, cp, parseFloat(e.target.value) || 0))}
            className="min-h-10 w-28 rounded-lg border border-gray-300 px-2 text-right text-sm"
          />
        ) : (
          <span className="w-28 text-right text-gray-400">—</span>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {nadaQueCobrar ? (
        <div className="py-4 text-center text-sm text-gray-500">No hay pedidos ni comprobantes pendientes para este cliente</div>
      ) : (
        <div className="space-y-2">
          {claves.length > 0 && (
            <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
              {/* "10% contado a todo" está más abajo, junto a "Incluir devoluciones" */}
              <label className="flex min-h-11 items-center gap-2 font-semibold"><input type="checkbox" checked={todoSeleccionado} onChange={() => onChange(alternarTodo(estado, cobro))} className="h-5 w-5" /> Seleccionar todo</label>
            </div>
          )}
          {cobro.pedidos.map((ped) => {
            const comps = compsPorPedido.get(ped.id) || []
            const facturado = comps.length > 0
            const anticipoSel = sel[PEDIDO_PREFIX + ped.id] !== undefined
            const todosCompsSel = facturado && comps.every((c) => sel[c.id] !== undefined)
            const algunoSel = comps.some((c) => sel[c.id] !== undefined)
            const abierto = expandido === ped.id
            if (esSaldado(ped))
              return (
                <div key={ped.id} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/60 p-2.5 text-slate-400">
                  <span className="w-5" />
                  <span className="text-sm font-semibold">Pedido #{ped.numero_pedido}</span>
                  <span className="text-xs">{formatDateAR(ped.fecha)}</span>
                  <span className="rounded border border-green-200 bg-green-50 px-1.5 text-[10px] text-green-700">Saldado</span>
                  <span className="ml-auto font-mono text-sm">${fmt(ped.total)}</span>
                </div>
              )
            const conContado = estado.contadoPedidos.includes(ped.id)
            return (
              <div key={ped.id} className={`rounded-lg border ${anticipoSel || algunoSel ? "border-blue-300 bg-blue-50/40" : "border-gray-200 bg-white"}`}>
                <div className="flex items-center gap-2 p-2.5">
                  <input type="checkbox" checked={facturado ? todosCompsSel : anticipoSel} onChange={() => onChange(facturado ? alternarGrupo(estado, comps) : alternarAnticipo(estado, ped))} className="h-5 w-5 shrink-0" />
                  <button onClick={() => facturado && onExpandir(abierto ? "" : ped.id)} disabled={!facturado} className="flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-x-1.5 text-left">
                    <span className="w-4 text-gray-400">{facturado ? (abierto ? "▾" : "▸") : ""}</span>
                    <span className="text-sm font-semibold">Pedido #{ped.numero_pedido}</span>
                    <span className="text-xs text-gray-400">{formatDateAR(ped.fecha)}</span>
                    {facturado ? (
                      <span className="rounded border px-1.5 text-[10px]">{comps.length} comprob.</span>
                    ) : (
                      <span className="rounded border border-amber-200 bg-amber-50 px-1.5 text-[10px] text-amber-700">Sin facturar (anticipo)</span>
                    )}
                    {ped.anticipo_pago_id && !facturado && <span className="rounded border border-gray-200 bg-gray-100 px-1.5 text-[10px] text-gray-600">ya anticipado</span>}
                  </button>
                  {!facturado && (
                    <label className="mr-1 flex min-h-11 items-center gap-1 text-[11px] text-amber-700"><input type="checkbox" checked={conContado} onChange={() => onChange(alternarContadoPedido(estado, ped))} className="h-5 w-5" /> 10%</label>
                  )}
                  <span className="font-mono text-sm">${fmt(facturado ? comps.reduce((s, c) => s + saldoCobrable(c), 0) : montoAnticipo(ped, conContado))}</span>
                </div>
                {facturado && abierto && <div className="border-t bg-white">{comps.map((c) => filaComprobante(c, true))}</div>}
              </div>
            )
          })}
          {sinPedido.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white">
              <div className="flex items-center gap-2 border-b px-3 py-2 text-xs font-semibold text-gray-500">
                <input type="checkbox" checked={sinPedido.every((c) => sel[c.id] !== undefined)} onChange={() => onChange(alternarGrupo(estado, sinPedido))} className="h-5 w-5" title="Seleccionar todos" />
                <span>Otros comprobantes</span>
                <span className="ml-auto font-mono text-orange-600">saldo ${fmt(sinPedido.reduce((s, c) => s + saldoCobrable(c), 0))}</span>
              </div>
              {sinPedido.map((c) => filaComprobante(c, false))}
            </div>
          )}
          {r.haySeleccion && (
            <div className="flex justify-end pt-1 text-sm font-semibold">Total a pagar: <span className="ml-2 text-blue-700">${fmt(r.totalImputado)}</span></div>
          )}
        </div>
      )}

      {/* Toggle devoluciones */}
      {devPendientes.length > 0 && (
        <div className="rounded-2xl bg-amber-50 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-bold text-amber-800">Incluir devoluciones como crédito</p>
              <p className="text-sm text-amber-600">{formatCurrency(devPendientes.reduce((s, d) => s + Number(d.monto_total), 0))}{devPendientes.some((d) => d.local) ? " (incluye una sin enviar)" : ""}</p>
            </div>
            <button onClick={() => onChange({ ...estado, incluirDevoluciones: !estado.incluirDevoluciones })} className={`h-7 w-14 rounded-full ${estado.incluirDevoluciones ? "bg-green-500" : "bg-gray-300"}`} aria-label="Incluir devoluciones">
              <span className={`mx-1 block h-5 w-5 rounded-full bg-white shadow ${estado.incluirDevoluciones ? "translate-x-7" : ""}`} />
            </button>
          </div>
        </div>
      )}

      {/* 10% contado a todo: solo a los comprobantes seleccionados que aún no lo tengan (el servidor
          vuelve a controlar que ninguno lo reciba dos veces) */}
      {r.haySeleccion && (
        <div className="rounded-2xl bg-emerald-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-bold text-emerald-800">10% contado a todo</p>
              <p className="text-sm text-emerald-700">
                {estado.contadoGeneral
                  ? r.bonificacionEstimada > 0
                    ? `−${formatCurrency(r.bonificacionEstimada)} sobre lo seleccionado (la NC sale al confirmar la rendición)`
                    : "Lo seleccionado ya tiene el 10% aplicado o no bonifica: no se aplica dos veces."
                  : "Aplica a los comprobantes seleccionados que aún no lo tengan; los pedidos sin facturar cobran el 90%."}
              </p>
            </div>
            <button onClick={() => onChange(alternarContadoTodo(estado, cobro))} className={`h-7 w-14 shrink-0 rounded-full ${estado.contadoGeneral ? "bg-green-500" : "bg-gray-300"}`} aria-label="10% contado a todo">
              <span className={`mx-1 block h-5 w-5 rounded-full bg-white shadow ${estado.contadoGeneral ? "translate-x-7" : ""}`} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
