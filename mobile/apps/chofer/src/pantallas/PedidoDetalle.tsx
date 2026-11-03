import { Hoja } from "@gm/core/ui"
import { esEnCurso } from "../datasets"
import { pdfPedido, usePdf } from "../datos/comprobantes-pdf"
import { useClienteViaje, useViaje } from "../datos/hooks"
import { formatCurrency, formatDateAR } from "../ui"
import { RenglonesPedido } from "./RenglonesPedido"

// Detalle de un pedido abierto desde el cobro (pedido de Juan, 03/11/2026): los renglones con
// "deslizá para devolver" (también los pedidos de antes) y "Comprobantes" para ver y compartir lo
// valorizado (facturas, presupuestos, NC y reversas en un PDF). Es una hoja (?ver=pedido:<id>)
// para que el cobro a medio cargar quede como estaba.

export function HojaPedido({ viajeId, clienteId, pedidoId, onCerrar, mostrar }: {
  viajeId: string
  clienteId: string
  /** "" = cerrada */
  pedidoId: string
  onCerrar: () => void
  mostrar: (m: string, t?: "ok" | "err") => void
}) {
  const { cliente: data } = useClienteViaje(viajeId, clienteId)
  const { viaje } = useViaje(viajeId)
  const pdf = usePdf(mostrar)

  const ped = data?.cobro?.pedidos.find((p) => p.id === pedidoId)
  const numero = ped?.numero_pedido ?? (data?.pedido?.id === pedidoId ? data.pedido.numero : "")
  // Réplica vieja sin detalle_pedidos: solo el pedido del viaje
  const detalle = data?.detalle_pedidos?.[pedidoId] ?? (data?.pedido?.id === pedidoId ? data.pedido.detalle : null)
  // Devolver: solo a un cliente de este viaje (no a uno agregado de afuera)
  const puedeDevolver = esEnCurso(viaje?.viaje.estado || data?.viaje_estado || "") && !!viaje?.paradas.some((p) => p.cliente_id === clienteId)

  return (
    <Hoja abierta={!!pedidoId} onCerrar={onCerrar} titulo={numero ? `Pedido #${numero}` : "Pedido"}>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 text-sm text-gray-500">{ped ? `${formatDateAR(ped.fecha)} · ${formatCurrency(ped.total)}` : ""}</p>
          <button onClick={() => void pdf.abrir(pdfPedido({ id: pedidoId, numero }))} disabled={pdf.ocupado} className="min-h-12 shrink-0 rounded-xl border-2 border-sky-300 bg-sky-50 px-4 text-base font-bold text-sky-800 active:scale-95 disabled:opacity-50">
            {pdf.ocupado ? "Bajando…" : "📄 Comprobantes"}
          </button>
        </div>
        <div className="-mx-4 border-y border-gray-100">
          {puedeDevolver && detalle?.length ? <p className="px-4 pt-2 text-right text-xs text-gray-400">← deslizá para devolver</p> : null}
          {detalle?.length ? (
            <RenglonesPedido detalle={detalle} viajeId={viajeId} clienteId={clienteId} puedeDevolver={puedeDevolver} />
          ) : (
            <p className="p-4 text-center text-sm text-gray-500">{detalle ? "El pedido no tiene renglones." : "El detalle de este pedido no está en el equipo: actualizá con señal."}</p>
          )}
        </div>
      </div>
    </Hoja>
  )
}
