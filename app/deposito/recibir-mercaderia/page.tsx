"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"

interface OrdenCompra {
  id: string
  numero_orden: string
  estado: string
  fecha_orden: string
  observaciones?: string
  proveedores: { nombre: string } | null
  ordenes_compra_detalle: any[]
  recepcion: any
}

export default function RecibirMercaderiaPage() {
  const [ordenes, setOrdenes] = useState<OrdenCompra[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [iniciando, setIniciando] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    fetch("/api/deposito/recepciones")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setOrdenes(data); else setError("Error al cargar") })
      .catch(() => setError("Error de conexión"))
      .finally(() => setLoading(false))
  }, [])

  const iniciarRecepcion = async (orden: OrdenCompra) => {
    setIniciando(orden.id)
    try {
      const r = await fetch("/api/deposito/recepciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orden_compra_id: orden.id }),
      })
      const data = await r.json()
      if (data.error) { setError(data.error); return }
      router.push(`/deposito/recibir-mercaderia/${orden.id}`)
    } catch { setError("Error de conexión") }
    finally { setIniciando(null) }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="text-gray-400 animate-pulse text-lg">Cargando órdenes...</div></div>

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Recibir Mercadería</h2>
          <p className="text-gray-400 text-sm">{ordenes.length} orden{ordenes.length !== 1 ? "es" : ""} pendiente{ordenes.length !== 1 ? "s" : ""}</p>
        </div>
        <button onClick={() => window.location.reload()} className="px-4 py-2 rounded-xl bg-gray-800 text-gray-300 text-sm">↻</button>
      </div>

      {error && <div className="bg-red-900/50 border border-red-700 rounded-xl p-4 mb-4 text-red-300">{error}</div>}

      {ordenes.length === 0 && !error && (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">🚚</div>
          <div className="text-gray-400 text-lg">No hay órdenes pendientes</div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {ordenes.map((orden) => {
          const enProgreso = orden.recepcion && orden.recepcion.estado === "en_proceso"
          const items = orden.recepcion?.recepciones_items || []
          const recibidos = items.filter((i: any) => i.estado_linea === "ok" || i.estado_linea === "diferencia_cantidad").length
          const totalItems = orden.ordenes_compra_detalle?.length || 0

          return (
            <div key={orden.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="text-white font-bold text-lg">{orden.numero_orden}</div>
                  <div className="text-emerald-400 text-sm font-semibold">
                    🏭 {orden.proveedores?.nombre || "Sin proveedor"}
                  </div>
                </div>
                <span className={`text-xs font-semibold px-3 py-1 rounded-full ${enProgreso ? "bg-blue-700 text-blue-100" : "bg-gray-700 text-gray-200"}`}>
                  {enProgreso ? "En progreso" : "Pendiente"}
                </span>
              </div>

              <div className="flex gap-3 text-sm text-gray-400 mb-3">
                <span>📦 {totalItems} artículos</span>
                <span>•</span>
                <span>📅 {new Date(orden.fecha_orden).toLocaleDateString("es-AR")}</span>
              </div>

              {enProgreso && (
                <div className="mb-3">
                  <div className="w-full bg-gray-700 rounded-full h-2">
                    <div className="bg-emerald-500 h-2 rounded-full" style={{ width: `${(recibidos / Math.max(totalItems, 1)) * 100}%` }} />
                  </div>
                  <div className="text-xs text-gray-500 mt-1">{recibidos}/{totalItems} artículos recibidos</div>
                </div>
              )}

              <button
                onClick={() => iniciarRecepcion(orden)}
                disabled={iniciando === orden.id}
                className="w-full bg-emerald-600 active:bg-emerald-700 text-white font-bold py-3 rounded-xl text-sm disabled:opacity-50"
              >
                {iniciando === orden.id ? "Cargando..." : enProgreso ? "Continuar recepción →" : "Iniciar recepción →"}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
