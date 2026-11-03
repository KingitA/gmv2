import { useRef, useState, type ReactNode } from "react"
import { useNavigate } from "react-router"
import type { DetallePedido } from "../datasets"
import { agregarAlBorrador } from "../datos/borrador-devolucion"
import { formatCurrency } from "../ui"

// Renglones de un pedido con "deslizá para devolver". Los usan la ficha del cliente (pedido del
// viaje) y el detalle de un pedido abierto desde el cobro (03/11/2026: también los de antes).

export function RenglonesPedido({ detalle, viajeId, clienteId, puedeDevolver }: { detalle: DetallePedido[]; viajeId: string; clienteId: string; puedeDevolver: boolean }) {
  const navigate = useNavigate()
  const devolver = (item: DetallePedido) => {
    agregarAlBorrador(viajeId, clienteId, {
      articulo_id: item.articulo_id,
      sku: item.articulos?.sku ?? null,
      descripcion: item.articulos?.descripcion || "Artículo",
      // Del pedido: por defecto vuelve TODO lo facturado (se corrige si es parcial)
      cantidad: item.cantidad,
      precio_venta_original: item.precio_final,
      motivo: "otro",
      condicion: "vendible",
      origen: "pedido",
    })
    navigate(`/viajes/${viajeId}/clientes/${clienteId}/devolucion`)
  }
  return (
    <div className="divide-y divide-gray-100">
      {detalle.map((item) => (
        <SwipeableItem key={item.id} onDevolver={() => devolver(item)} disabled={!puedeDevolver}>
          <div className="flex items-center justify-between px-4 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-gray-800">{item.articulos?.descripcion || "Artículo"}</p>
              <p className="text-xs text-gray-400">{item.articulos?.sku}</p>
            </div>
            <div className="ml-3 shrink-0 text-right">
              <p className="text-xs text-gray-500">{item.cantidad} × {formatCurrency(item.precio_final)}</p>
              <p className="font-bold text-gray-800">{formatCurrency(item.subtotal)}</p>
            </div>
          </div>
        </SwipeableItem>
      ))}
    </div>
  )
}

// ─── SwipeableItem (= web): deslizá a la izquierda para revelar "Devolver" ────

function SwipeableItem({ children, onDevolver, disabled }: { children: ReactNode; onDevolver: () => void; disabled?: boolean }) {
  const [offset, setOffset] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const startX = useRef(0)
  const THRESHOLD = 70
  const BUTTON_W = 90

  const handleTouchStart = (e: React.TouchEvent) => {
    if (disabled) return
    startX.current = e.touches[0]!.clientX
  }
  const handleTouchMove = (e: React.TouchEvent) => {
    if (disabled) return
    const dx = e.touches[0]!.clientX - startX.current
    if (dx < 0) setOffset(Math.max(dx, -BUTTON_W))
  }
  const handleTouchEnd = () => {
    if (disabled) return
    if (offset < -THRESHOLD) { setOffset(-BUTTON_W); setRevealed(true) } else { setOffset(0); setRevealed(false) }
  }
  return (
    <div className="relative overflow-hidden">
      <div className="absolute bottom-0 right-0 top-0 flex items-center justify-center bg-amber-500" style={{ width: BUTTON_W }}>
        <button onClick={() => { setOffset(0); setRevealed(false); onDevolver() }} className="flex h-full w-full flex-col items-center justify-center text-white">
          <span className="text-xl">↩</span>
          <span className="text-xs font-bold">Devolver</span>
        </button>
      </div>
      <div
        className="relative bg-white"
        style={{ transform: `translateX(${offset}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={() => { if (revealed) { setOffset(0); setRevealed(false) } }}
      >
        {children}
      </div>
    </div>
  )
}
