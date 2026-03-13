"use client"

import { useState, useEffect } from "react"
import Link from "next/link"

interface Pedido {
  id: string
  numero_pedido: string
  estado: string
  fecha: string
  clientes: { nombre: string; razon_social?: string } | null
  pedidos_detalle: any[]
  sesion: any
  progreso: { total: number; completados: number }
}

export default function PrepararPedidosPage() {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    fetch("/api/deposito/pedidos")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setPedidos(data)
        else setError("Error al cargar pedidos")
      })
      .catch(() => setError("Error de conexión"))
      .finally(() => setLoading(false))
  }, [])

  const getEstadoBadge = (pedido: Pedido) => {
    const { total, completados } = pedido.progreso
    if (completados === 0) return { label: "Pendiente", cls: "bg-gray-700 text-gray-200" }
    if (completados === total) return { label: "Listo p/ facturar", cls: "bg-green-700 text-green-100" }
    return { label: `${completados}/${total} artículos`, cls: "bg-blue-700 text-blue-100" }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400 text-lg animate-pulse">Cargando pedidos...</div>
      </div>
    )
  }

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Pedidos para preparar</h2>
          <p className="text-gray-400 text-sm">{pedidos.length} pedido{pedidos.length !== 1 ? "s" : ""} pendiente{pedidos.length !== 1 ? "s" : ""}</p>
        </div>
        <button onClick={() => window.location.reload()} className="px-4 py-2 rounded-xl bg-gray-800 text-gray-300 text-sm active:bg-gray-700">
          ↻ Actualizar
        </button>
      </div>

      {error && (
        <div className="bg-red-900/50 border border-red-700 rounded-xl p-4 mb-4 text-red-300">{error}</div>
      )}

      {pedidos.length === 0 && !error && (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">✅</div>
          <div className="text-gray-400 text-lg">No hay pedidos pendientes</div>
          <div className="text-gray-500 text-sm mt-1">Todos los pedidos están preparados</div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {pedidos.map((pedido) => {
          const badge = getEstadoBadge(pedido)
          const pct = pedido.progreso.total > 0
            ? Math.round((pedido.progreso.completados / pedido.progreso.total) * 100)
            : 0
          const enProgreso = pedido.sesion && pedido.progreso.completados > 0

          return (
            <Link
              key={pedido.id}
              href={`/deposito/preparar-pedidos/${pedido.id}`}
              className="bg-gray-900 border border-gray-800 rounded-2xl p-4 active:bg-gray-800 block"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="text-white font-bold text-lg">{pedido.numero_pedido}</div>
                  <div className="text-gray-300 text-sm">
                    {pedido.clientes?.razon_social || pedido.clientes?.nombre || "Sin cliente"}
                  </div>
                </div>
                <span className={`text-xs font-semibold px-3 py-1 rounded-full ${badge.cls}`}>
                  {badge.label}
                </span>
              </div>

              <div className="flex items-center gap-3 text-sm text-gray-400 mb-3">
                <span>📦 {pedido.pedidos_detalle?.length || 0} artículos</span>
                <span>•</span>
                <span>📅 {new Date(pedido.fecha).toLocaleDateString("es-AR")}</span>
                {enProgreso && <span className="text-blue-400">• En progreso</span>}
              </div>

              {enProgreso && (
                <div>
                  <div className="w-full bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="text-xs text-gray-500 mt-1">{pct}% completado</div>
                </div>
              )}

              <div className="mt-3 text-right">
                <span className="text-blue-400 font-semibold text-sm">
                  {enProgreso ? "Continuar →" : "Empezar →"}
                </span>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
