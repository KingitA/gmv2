import { useMemo, useState } from "react"
import { PEDIDO_PREFIX } from "@gm/cobro"
import { ESTADO_LABEL } from "@gm/vendedor"
import type { ComprobanteCobro, PedidoCobro } from "../datasets"
import {
  agruparCuenta, alternarAnticipo, comprobantesDeDevolucion, devolucionAplica, etiquetaComprobante, alternarComprobante, alternarContadoPedido, alternarContadoTodo, alternarGrupo, alternarTodo, clavesDeLaCuenta,
  fijarMonto, montoAnticipo, resumenCuenta, saldoCobrable, separarPorViaje, valorDeDevolucion, type DatosCuenta, type EstadoCuenta,
} from "../datos/cuenta-cobro"
import { moneda, redondear } from "@gm/formato"
const r2 = (n: number) => redondear(n)
import { formatCurrency, formatDateAR, MontoInput, RenglonesDevolucion } from "../ui"

// La cuenta de UN cliente dentro del cobro: pedidos y comprobantes seleccionables, "Incluir
// devoluciones como crédito" y "10% contado a todo". Es la MISMA pantalla para el cliente de la
// parada y para cada cliente agregado al cobro conjunto (regla del dueño, 01/10/2026: al agregar
// un cliente se ve su cuenta completa, igual que la del principal).


export function SelectorCuenta({ datos, estado, onChange, expandido, onExpandir, pedidosViaje = [] }: {
  datos: DatosCuenta
  estado: EstadoCuenta
  onChange: (e: EstadoCuenta) => void
  /** id del pedido desplegado ("" = ninguno) */
  expandido: string
  onExpandir: (pedidoId: string) => void
  /** Pedidos de ESTE viaje: van primero y abiertos; lo anterior queda plegado en "Debe de antes" (dueño, 21/10/2026) */
  pedidosViaje?: string[]
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
  // Lo de este viaje primero; lo anterior, plegado (se abre solo si tiene algo seleccionado)
  const { delViaje, anteriores } = useMemo(() => separarPorViaje(cobro, pedidosViaje), [cobro, pedidosViaje])
  const anterioresSeleccionados = anteriores.some((p) => sel[PEDIDO_PREFIX + p.id] !== undefined || (compsPorPedido.get(p.id) || []).some((c) => sel[c.id] !== undefined)) || sinPedido.some((c) => sel[c.id] !== undefined)
  const [verAnteriores, setVerAnteriores] = useState(false)
  const anterioresAbiertos = verAnteriores || anterioresSeleccionados || delViaje.length === 0
  const saldoAnteriores = r2(
    anteriores.reduce((s, p) => s + (esSaldado(p) ? 0 : (compsPorPedido.get(p.id) || []).reduce((x, c) => x + saldoCobrable(c), 0) + (compsPorPedido.has(p.id) ? 0 : p.total)), 0) + sinPedido.reduce((s, c) => s + saldoCobrable(c), 0),
  )

  // Fila de comprobante (función de render, no componente: los inputs no pierden el foco)
  const filaComprobante = (cp: ComprobanteCobro, dentroDePedido: boolean) => {
    const checked = sel[cp.id] !== undefined
    return (
      <div key={cp.id} className={`flex items-center gap-2 border-t px-3 py-2 text-sm ${checked ? "bg-blue-50" : ""} ${dentroDePedido ? "" : "first:border-t-0"}`}>
        <input type="checkbox" checked={checked} onChange={() => onChange(alternarComprobante(estado, cp))} className="h-5 w-5 shrink-0" />
        <button onClick={() => onChange(alternarComprobante(estado, cp))} className="flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-x-2 text-left">
          <span className="rounded border px-1 text-xs">{cp.tipo_comprobante}</span>
          <span className="font-mono text-xs">{cp.numero_comprobante}</span>
          <span className="text-[10px] text-gray-400">{formatDateAR(cp.fecha)}</span>
          {dtosHechos.has(cp.id) && <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">Dto. ctdo</span>}
          {(cp.en_cobro || 0) > 0.005 && <span className="text-[10px] font-bold text-sky-600">🔒 {moneda(cp.en_cobro!)} en otro cobro sin confirmar</span>}
          <span className="ml-auto font-mono text-orange-600">saldo {moneda(saldoCobrable(cp))}</span>
        </button>
        {checked ? (
          <MontoInput
            valor={sel[cp.id] ?? 0}
            onCambio={(n) => onChange(fijarMonto(estado, cp, n))}
            className="min-h-10 w-28 rounded-lg border border-gray-300 px-2 text-right text-sm"
          />
        ) : (
          <span className="w-28 text-right text-gray-400">—</span>
        )}
      </div>
    )
  }

  // Fila de un pedido (función de render: los inputs no pierden el foco)
  const filaPedido = (ped: PedidoCobro, esDelViaje: boolean) => {
            const comps = compsPorPedido.get(ped.id) || []
            const facturado = comps.length > 0
            const anticipoSel = sel[PEDIDO_PREFIX + ped.id] !== undefined
            const todosCompsSel = facturado && comps.every((c) => sel[c.id] !== undefined)
            const algunoSel = comps.some((c) => sel[c.id] !== undefined)
            // Lo de este viaje arranca abierto ("-" = el chofer lo cerró a mano)
            const abierto = expandido === ped.id || (esDelViaje && expandido === "" && facturado)
            if (esSaldado(ped))
              return (
                <div key={ped.id} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/60 p-2.5 text-slate-400">
                  <span className="w-5" />
                  <span className="text-sm font-semibold">Pedido #{ped.numero_pedido}</span>
                  <span className="text-xs">{formatDateAR(ped.fecha)}</span>
                  <span className="rounded border border-green-200 bg-green-50 px-1.5 text-[10px] text-green-700">Saldado</span>
                  {ped.estado === "sistema_viejo" && <span className="rounded border border-gray-200 bg-gray-100 px-1.5 text-[10px] text-gray-600">{ESTADO_LABEL.sistema_viejo}</span>}
                  <span className="ml-auto font-mono text-sm">{moneda(ped.total)}</span>
                </div>
              )
            const conContado = estado.contadoPedidos.includes(ped.id)
            return (
              <div key={ped.id} className={`rounded-lg border ${anticipoSel || algunoSel ? "border-blue-300 bg-blue-50/40" : "border-gray-200 bg-white"}`}>
                <div className="flex items-center gap-2 p-2.5">
                  <input type="checkbox" checked={facturado ? todosCompsSel : anticipoSel} onChange={() => onChange(facturado ? alternarGrupo(estado, comps) : alternarAnticipo(estado, ped))} className="h-5 w-5 shrink-0" />
                  <button onClick={() => facturado && onExpandir(abierto ? "-" : ped.id)} disabled={!facturado} className="flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-x-1.5 text-left">
                    <span className="w-4 text-gray-400">{facturado ? (abierto ? "▾" : "▸") : ""}</span>
                    <span className="text-sm font-semibold">Pedido #{ped.numero_pedido}</span>
                    <span className="text-xs text-gray-400">{formatDateAR(ped.fecha)}</span>
                    {facturado ? (
                      <span className="rounded border px-1.5 text-[10px]">{comps.length} comprob.</span>
                    ) : (
                      <span className="rounded border border-amber-200 bg-amber-50 px-1.5 text-[10px] text-amber-700">Sin facturar (anticipo)</span>
                    )}
                    {ped.anticipo_pago_id && !facturado && <span className="rounded border border-gray-200 bg-gray-100 px-1.5 text-[10px] text-gray-600">ya anticipado</span>}
                    {ped.estado === "sistema_viejo" && <span className="rounded border border-gray-200 bg-gray-100 px-1.5 text-[10px] text-gray-600">{ESTADO_LABEL.sistema_viejo}</span>}
                  </button>
                  {!facturado && (
                    <label className="mr-1 flex min-h-11 items-center gap-1 text-[11px] text-amber-700"><input type="checkbox" checked={conContado} onChange={() => onChange(alternarContadoPedido(estado, ped))} className="h-5 w-5" /> 10%</label>
                  )}
                  <span className="font-mono text-sm">{moneda(facturado ? comps.reduce((s, c) => s + saldoCobrable(c), 0) : montoAnticipo(ped, conContado))}</span>
                </div>
                {facturado && abierto && <div className="border-t bg-white">{comps.map((c) => filaComprobante(c, true))}</div>}
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
          {delViaje.map((ped) => filaPedido(ped, true))}
          {(anteriores.length > 0 || sinPedido.length > 0) && (
            <button onClick={() => setVerAnteriores((v) => !v)} className={`flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm ${anterioresAbiertos ? "border-gray-300 bg-gray-100" : "border-gray-200 bg-gray-50"}`}>
              <span className="w-4 text-gray-400">{anterioresAbiertos ? "▾" : "▸"}</span>
              <span className="font-semibold text-gray-700">{delViaje.length ? "Debe de antes" : "Pedidos y comprobantes"}</span>
              <span className="text-xs text-gray-500">{anteriores.length + (sinPedido.length ? 1 : 0)} {anteriores.length + (sinPedido.length ? 1 : 0) === 1 ? "grupo" : "grupos"}</span>
              <span className="ml-auto font-mono text-orange-600">{moneda(saldoAnteriores)}</span>
            </button>
          )}
          {anterioresAbiertos && anteriores.map((ped) => filaPedido(ped, false))}
          {anterioresAbiertos && sinPedido.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white">
              <div className="flex items-center gap-2 border-b px-3 py-2 text-xs font-semibold text-gray-500">
                <input type="checkbox" checked={sinPedido.every((c) => sel[c.id] !== undefined)} onChange={() => onChange(alternarGrupo(estado, sinPedido))} className="h-5 w-5" title="Seleccionar todos" />
                <span>Otros comprobantes</span>
                <span className="ml-auto font-mono text-orange-600">saldo {moneda(sinPedido.reduce((s, c) => s + saldoCobrable(c), 0))}</span>
              </div>
              {sinPedido.map((c) => filaComprobante(c, false))}
            </div>
          )}
          {r.haySeleccion && (
            <div className="flex justify-end pt-1 text-sm font-semibold">Total a pagar: <span className="ml-2 text-blue-700">{moneda(r.totalImputado)}</span></div>
          )}
        </div>
      )}

      {/* Toggle devoluciones. P2-29: cada una dice contra qué comprobante va y resta SOLO si ese
          comprobante se cobra acá (si no, el cobrado quedaría debiendo lo devuelto). */}
      {devPendientes.length > 0 && (
        <div className="rounded-2xl bg-amber-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-bold text-amber-800">Incluir devoluciones como crédito</p>
              <p className="text-sm text-amber-600">{estado.incluirDevoluciones ? `Se descuenta ${formatCurrency(r.devTotal)}` : "No se descuentan"}{devPendientes.some((d) => d.local) ? " (incluye una sin enviar)" : ""}</p>
              {devPendientes.map((d) => {
                const comps = comprobantesDeDevolucion(d)
                const aplica = devolucionAplica(d, sel)
                return (
                  <div key={d.id} className={`mt-2 border-t border-amber-200 pt-2 ${aplica ? "" : "opacity-70"}`}>
                    <p className="text-sm font-semibold text-amber-900">{d.numero_devolucion || "Devolución"} · {formatCurrency(valorDeDevolucion(d))}</p>
                    {comps.length > 0 && <p className="text-sm text-amber-800">Va contra {comps.map((id) => etiquetaComprobante(cobro, id)).join(" y ")}</p>}
                    {!aplica && <p className="text-sm font-medium text-amber-900">No se descuenta en este cobro: seleccioná ese comprobante para descontarla.</p>}
                    <RenglonesDevolucion renglones={d.devoluciones_detalle} className="text-amber-800" />
                  </div>
                )
              })}
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
                    ? `−${formatCurrency(r.bonificacionEstimada)}: el 10 % del total de cada comprobante seleccionado, una sola vez (la NC sale al confirmar la rendición)`
                    : "Lo seleccionado ya tiene el 10% aplicado o no bonifica: no se aplica dos veces."
                  : "10 % del total de cada comprobante seleccionado que aún no lo tenga (también en un pago parcial); los pedidos sin facturar cobran el 90%."}
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
