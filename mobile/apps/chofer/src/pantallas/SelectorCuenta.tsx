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
import { formatDateAR, MontoInput } from "../ui"

// La cuenta de UN cliente dentro del cobro: pedidos y comprobantes seleccionables, devoluciones
// y "10 % contado". Es la MISMA pantalla para el cliente de la parada y para cada cliente agregado
// al cobro conjunto (regla del dueño, 01/10/2026).
// 03/11/2026 (Juan): pantalla de gente trabajando, sin explicaciones largas. Tocar el pedido abre
// su detalle (deslizar para devolver); tocar un comprobante abre su PDF para compartir. Los
// pedidos ya saldados no se muestran.

export function SelectorCuenta({ datos, estado, onChange, pedidosViaje = [], onAbrirPedido, onAbrirComprobante }: {
  datos: DatosCuenta
  estado: EstadoCuenta
  onChange: (e: EstadoCuenta) => void
  /** Pedidos de ESTE viaje: van primero; lo anterior queda plegado en "Debe de antes" (dueño, 21/10/2026) */
  pedidosViaje?: string[]
  onAbrirPedido?: (pedidoId: string) => void
  onAbrirComprobante?: (cp: ComprobanteCobro) => void
}) {
  const { cobro } = datos
  const { compsPorPedido, sinPedido, esSaldado } = useMemo(() => agruparCuenta(cobro), [cobro])
  const dtosHechos = useMemo(() => new Set(cobro.dtos_hechos), [cobro.dtos_hechos])
  const r = resumenCuenta(datos, estado)
  const sel = estado.sel
  const claves = clavesDeLaCuenta(cobro)
  const todoSeleccionado = claves.length > 0 && claves.every((k) => sel[k] !== undefined)
  const devPendientes = datos.devoluciones.filter((d) => d.estado === "pendiente")
  // Lo de este viaje primero; lo anterior, plegado (se abre solo si tiene algo seleccionado). Lo saldado no se muestra.
  const { delViaje, anteriores } = useMemo(() => {
    const x = separarPorViaje(cobro, pedidosViaje)
    return { delViaje: x.delViaje.filter((p) => !esSaldado(p)), anteriores: x.anteriores.filter((p) => !esSaldado(p)) }
  }, [cobro, pedidosViaje, esSaldado])
  const nadaQueCobrar = delViaje.length === 0 && anteriores.length === 0 && sinPedido.length === 0
  const anterioresSeleccionados = anteriores.some((p) => sel[PEDIDO_PREFIX + p.id] !== undefined || (compsPorPedido.get(p.id) || []).some((c) => sel[c.id] !== undefined)) || sinPedido.some((c) => sel[c.id] !== undefined)
  const [verAnteriores, setVerAnteriores] = useState(false)
  const anterioresAbiertos = verAnteriores || anterioresSeleccionados || delViaje.length === 0
  const saldoAnteriores = r2(
    anteriores.reduce((s, p) => s + (compsPorPedido.get(p.id) || []).reduce((x, c) => x + saldoCobrable(c), 0) + (compsPorPedido.has(p.id) ? 0 : p.total), 0) + sinPedido.reduce((s, c) => s + saldoCobrable(c), 0),
  )
  const gruposAnteriores = anteriores.length + (sinPedido.length ? 1 : 0)
  // Lo que ahorra el 10 %: la NC de los comprobantes + el 10 % de los pedidos sin facturar (cobran el 90 %)
  const descuento10 = r2(r.bonificacionEstimada + cobro.pedidos.reduce((s, p) => s + (estado.contadoPedidos.includes(p.id) && sel[PEDIDO_PREFIX + p.id] !== undefined ? p.total - montoAnticipo(p, true) : 0), 0))

  // Fila de comprobante (función de render, no componente: los inputs no pierden el foco)
  const filaComprobante = (cp: ComprobanteCobro) => {
    const checked = sel[cp.id] !== undefined
    return (
      <div key={cp.id} className={`flex items-center gap-2 border-t border-gray-100 px-3 py-1.5 text-sm ${checked ? "bg-blue-50" : ""}`}>
        <input type="checkbox" checked={checked} onChange={() => onChange(alternarComprobante(estado, cp))} className="h-5 w-5 shrink-0" aria-label={`Cobrar ${cp.tipo_comprobante} ${cp.numero_comprobante}`} />
        <button onClick={() => onAbrirComprobante?.(cp)} className="flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-x-2 text-left">
          <span className="text-sky-700">📄 {cp.tipo_comprobante} <span className="font-mono text-xs underline">{cp.numero_comprobante}</span></span>
          {dtosHechos.has(cp.id) && <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">Dto. ctdo</span>}
          {(cp.en_cobro || 0) > 0.005 && <span className="text-[10px] font-bold text-sky-600">🔒 {moneda(cp.en_cobro!)} en otro cobro</span>}
          <span className="ml-auto font-mono text-orange-600">{moneda(saldoCobrable(cp))}</span>
        </button>
        {checked && (
          <MontoInput
            valor={sel[cp.id] ?? 0}
            onCambio={(n) => onChange(fijarMonto(estado, cp, n))}
            className="min-h-10 w-28 rounded-lg border border-gray-300 px-2 text-right text-sm"
          />
        )}
      </div>
    )
  }

  // Fila de un pedido con sus comprobantes (función de render: los inputs no pierden el foco)
  const filaPedido = (ped: PedidoCobro) => {
    const comps = compsPorPedido.get(ped.id) || []
    const facturado = comps.length > 0
    const anticipoSel = sel[PEDIDO_PREFIX + ped.id] !== undefined
    const todosCompsSel = facturado && comps.every((c) => sel[c.id] !== undefined)
    const algunoSel = comps.some((c) => sel[c.id] !== undefined)
    const conContado = estado.contadoPedidos.includes(ped.id)
    return (
      <div key={ped.id} className={`rounded-lg border ${anticipoSel || algunoSel ? "border-blue-300 bg-blue-50/40" : "border-gray-200 bg-white"}`}>
        <div className="flex items-center gap-2 px-3 py-1.5">
          <input type="checkbox" checked={facturado ? todosCompsSel : anticipoSel} onChange={() => onChange(facturado ? alternarGrupo(estado, comps) : alternarAnticipo(estado, ped))} className="h-5 w-5 shrink-0" aria-label={`Cobrar pedido ${ped.numero_pedido}`} />
          <button onClick={() => onAbrirPedido?.(ped.id)} className="flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-x-1.5 text-left">
            <span className="font-semibold text-gray-800 underline">Pedido #{ped.numero_pedido}</span>
            <span className="text-xs text-gray-400">{formatDateAR(ped.fecha)}</span>
            {!facturado && <span className="rounded border border-amber-200 bg-amber-50 px-1.5 text-[10px] text-amber-700">Sin facturar</span>}
            {ped.anticipo_pago_id && !facturado && <span className="rounded border border-gray-200 bg-gray-100 px-1.5 text-[10px] text-gray-600">ya anticipado</span>}
            {ped.estado === "sistema_viejo" && <span className="rounded border border-gray-200 bg-gray-100 px-1.5 text-[10px] text-gray-600">{ESTADO_LABEL.sistema_viejo}</span>}
          </button>
          {!facturado && (
            <label className="flex min-h-11 items-center gap-1 text-xs text-amber-700"><input type="checkbox" checked={conContado} onChange={() => onChange(alternarContadoPedido(estado, ped))} className="h-5 w-5" /> 10%</label>
          )}
          {!facturado && <span className="font-mono text-sm">{moneda(montoAnticipo(ped, conContado))}</span>}
        </div>
        {comps.map(filaComprobante)}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {nadaQueCobrar ? (
        <div className="py-4 text-center text-sm text-gray-500">No debe nada</div>
      ) : (
        <div className="space-y-2">
          {claves.length > 1 && (
            <div className="flex justify-end">
              <button onClick={() => onChange(alternarTodo(estado, cobro))} className="min-h-10 rounded-lg border border-blue-300 px-3 text-sm font-semibold text-blue-700 active:scale-95">
                {todoSeleccionado ? "Quitar todo" : "Seleccionar todo"}
              </button>
            </div>
          )}
          {delViaje.map(filaPedido)}
          {gruposAnteriores > 0 && delViaje.length > 0 && (
            <button onClick={() => setVerAnteriores((v) => !v)} className={`flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm ${anterioresAbiertos ? "border-gray-300 bg-gray-100" : "border-gray-200 bg-gray-50"}`}>
              <span className="w-4 text-gray-400">{anterioresAbiertos ? "▾" : "▸"}</span>
              <span className="font-semibold text-gray-700">Debe de antes</span>
              <span className="ml-auto font-mono text-orange-600">{moneda(saldoAnteriores)}</span>
            </button>
          )}
          {anterioresAbiertos && anteriores.map(filaPedido)}
          {anterioresAbiertos && sinPedido.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white">
              <div className="flex items-center gap-2 px-3 py-1.5 text-sm">
                <input type="checkbox" checked={sinPedido.every((c) => sel[c.id] !== undefined)} onChange={() => onChange(alternarGrupo(estado, sinPedido))} className="h-5 w-5" aria-label="Cobrar otros comprobantes" />
                <span className="min-h-11 content-center font-semibold text-gray-700">Otros comprobantes</span>
              </div>
              {sinPedido.map(filaComprobante)}
            </div>
          )}
          {r.haySeleccion && (
            <div className="flex justify-end pt-1 text-sm font-semibold">Seleccionado: <span className="ml-2 text-blue-700">{moneda(r.totalImputado)}</span></div>
          )}
        </div>
      )}

      {/* Devoluciones. P2-29: cada una resta SOLO si se cobra el comprobante contra el que va */}
      {devPendientes.length > 0 && (
        <div className="rounded-xl bg-amber-50 px-3 py-2">
          <div className="flex min-h-11 items-center justify-between gap-3">
            <p className="font-bold text-amber-800">Descontar devoluciones{estado.incluirDevoluciones && r.devTotal > 0 ? <span className="ml-2 font-mono">−{moneda(r.devTotal)}</span> : null}</p>
            <Interruptor activo={estado.incluirDevoluciones} onClick={() => onChange({ ...estado, incluirDevoluciones: !estado.incluirDevoluciones })} etiqueta="Descontar devoluciones" />
          </div>
          {devPendientes.map((d) => {
            const comps = comprobantesDeDevolucion(d)
            const aplica = devolucionAplica(d, sel, cobro)
            return (
              <p key={d.id} className={`text-sm text-amber-900 ${aplica ? "" : "opacity-70"}`}>
                {d.local ? "Devolución" : d.numero_devolucion} {moneda(valorDeDevolucion(d))}
                {comps.length > 0 && ` · ${comps.map((id) => etiquetaComprobante(cobro, id, datos.comprobantes_ref)).join(" y ")}`}
                {!aplica && <b> · marcá ese comprobante</b>}
                {d.local && " (sin enviar)"}
              </p>
            )
          })}
        </div>
      )}

      {/* 10 % contado: solo a lo seleccionado que aún no lo tenga (el servidor vuelve a controlar) */}
      {r.haySeleccion && (
        <div className="flex min-h-14 items-center justify-between gap-3 rounded-xl bg-emerald-50 px-3">
          <p className="font-bold text-emerald-800">
            10 % contado
            {estado.contadoGeneral && (descuento10 > 0 ? <span className="ml-2 font-mono">−{moneda(descuento10)}</span> : <span className="ml-2 text-sm font-normal">ya aplicado</span>)}
          </p>
          <Interruptor activo={estado.contadoGeneral} onClick={() => onChange(alternarContadoTodo(estado, cobro))} etiqueta="10 % contado" />
        </div>
      )}
    </div>
  )
}

function Interruptor({ activo, onClick, etiqueta }: { activo: boolean; onClick: () => void; etiqueta: string }) {
  return (
    <button onClick={onClick} role="switch" aria-checked={activo} aria-label={etiqueta} className={`h-7 w-14 shrink-0 rounded-full ${activo ? "bg-green-500" : "bg-gray-300"}`}>
      <span className={`mx-1 block h-5 w-5 rounded-full bg-white shadow ${activo ? "translate-x-7" : ""}`} />
    </button>
  )
}
