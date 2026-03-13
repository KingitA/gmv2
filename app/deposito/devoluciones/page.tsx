"use client"

import { useState, useEffect } from "react"

interface DetalleDevolucion {
  id: string
  cantidad: number
  motivo?: string
  es_vendible: boolean
  articulos: { id: string; sku: string; descripcion: string; ean13?: string }
}

interface Devolucion {
  id: string
  numero_devolucion?: string
  estado: string
  observaciones?: string
  created_at: string
  clientes: { nombre: string; razon_social?: string } | null
  devoluciones_detalle: DetalleDevolucion[]
}

type Step = "lista" | "confirmar"

export default function DevolucionesPage() {
  const [devoluciones, setDevoluciones] = useState<Devolucion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  const [devSeleccionada, setDevSeleccionada] = useState<Devolucion | null>(null)
  const [step, setStep] = useState<Step>("lista")

  // Estado local de confirmación por item
  const [confirmados, setConfirmados] = useState<Record<string, { es_vendible: boolean; cantidad: number }>>({})

  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    cargarDevoluciones()
  }, [])

  const cargarDevoluciones = () => {
    setLoading(true)
    fetch("/api/deposito/devoluciones")
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setDevoluciones(data); else setError("Error al cargar") })
      .catch(() => setError("Error de conexión"))
      .finally(() => setLoading(false))
  }

  const abrirDevolucion = (dev: Devolucion) => {
    setDevSeleccionada(dev)
    // Init confirmados con los valores previos de la devolucion
    const init: Record<string, { es_vendible: boolean; cantidad: number }> = {}
    dev.devoluciones_detalle.forEach(d => {
      init[d.id] = { es_vendible: d.es_vendible, cantidad: d.cantidad }
    })
    setConfirmados(init)
    setStep("confirmar")
  }

  const toggleVendible = (detalleId: string) => {
    setConfirmados(prev => ({
      ...prev,
      [detalleId]: { ...prev[detalleId], es_vendible: !prev[detalleId]?.es_vendible }
    }))
  }

  const confirmarDevolucion = async () => {
    if (!devSeleccionada) return
    setGuardando(true)
    try {
      const items_confirmados = devSeleccionada.devoluciones_detalle.map(d => ({
        detalle_id: d.id,
        articulo_id: d.articulos.id,
        cantidad_recibida: confirmados[d.id]?.cantidad || d.cantidad,
        es_vendible: confirmados[d.id]?.es_vendible ?? d.es_vendible,
      }))

      const r = await fetch("/api/deposito/devoluciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ devolucion_id: devSeleccionada.id, items_confirmados }),
      })
      const data = await r.json()
      if (data.ok) {
        setSuccess("Devolución confirmada — ERP generará la nota de crédito")
        setStep("lista")
        setDevSeleccionada(null)
        setTimeout(() => { setSuccess(""); cargarDevoluciones() }, 3000)
      } else {
        setError(data.error || "Error al confirmar")
      }
    } catch { setError("Error de conexión") }
    finally { setGuardando(false) }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="text-gray-400 animate-pulse text-lg">Cargando devoluciones...</div></div>

  // ─── CONFIRMAR DEVOLUCIÓN ───
  if (step === "confirmar" && devSeleccionada) {
    return (
      <div className="flex flex-col h-[calc(100vh-64px)]">
        <div className="p-4 bg-gray-900 border-b border-gray-800">
          <div className="text-white font-bold text-lg">{devSeleccionada.numero_devolucion || "Devolución"}</div>
          <div className="text-purple-400 text-sm">{devSeleccionada.clientes?.razon_social || devSeleccionada.clientes?.nombre}</div>
          {devSeleccionada.observaciones && (
            <div className="text-gray-400 text-sm mt-1 italic">"{devSeleccionada.observaciones}"</div>
          )}
        </div>

        <div className="px-4 py-3 bg-purple-900/20 border-b border-purple-800/30">
          <div className="text-purple-300 text-sm">
            ⚠️ Confirmá el estado de cada producto: <strong>¿es vendible o no?</strong>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-3 py-3 flex flex-col gap-3">
          {devSeleccionada.devoluciones_detalle.map(det => {
            const conf = confirmados[det.id]
            const esVendible = conf?.es_vendible ?? det.es_vendible

            return (
              <div key={det.id} className={`rounded-2xl border p-4 transition-all ${
                esVendible ? "border-green-700/50 bg-green-900/20" : "border-red-700/50 bg-red-900/20"
              }`}>
                <div className="flex items-start gap-3 mb-3">
                  <span className="text-2xl">{esVendible ? "✅" : "🚫"}</span>
                  <div className="flex-1">
                    <div className="text-white font-semibold text-sm leading-tight">{det.articulos.descripcion}</div>
                    <div className="text-gray-400 text-xs font-mono mt-0.5">{det.articulos.sku}</div>
                    {det.motivo && <div className="text-gray-500 text-xs mt-1 italic">Motivo: {det.motivo}</div>}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-white font-bold">{det.cantidad}</div>
                    <div className="text-gray-500 text-xs">unidades</div>
                  </div>
                </div>

                {/* Toggle vendible/no vendible */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => !esVendible && toggleVendible(det.id)}
                    className={`py-2.5 rounded-xl text-sm font-bold transition-all ${
                      esVendible ? "bg-green-600 text-white" : "bg-gray-700 text-gray-400"
                    }`}
                  >
                    ✓ Vendible
                  </button>
                  <button
                    onClick={() => esVendible && toggleVendible(det.id)}
                    className={`py-2.5 rounded-xl text-sm font-bold transition-all ${
                      !esVendible ? "bg-red-700 text-white" : "bg-gray-700 text-gray-400"
                    }`}
                  >
                    ✗ No vendible
                  </button>
                </div>

                {!esVendible && (
                  <div className="mt-2 text-xs text-red-300 text-center">
                    Mercadería rota, vencida o dañada — no vuelve a stock
                  </div>
                )}
                {esVendible && (
                  <div className="mt-2 text-xs text-green-300 text-center">
                    Mercadería en buen estado — se restituye al stock
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {error && <div className="mx-4 bg-red-900/50 border border-red-700 rounded-xl p-3 text-red-300 text-sm text-center">{error}</div>}

        <div className="p-4 bg-gray-900 border-t border-gray-800 flex gap-3">
          <button onClick={() => { setStep("lista"); setDevSeleccionada(null) }}
            className="flex-1 bg-gray-800 text-gray-300 font-semibold py-3 rounded-xl active:bg-gray-700">
            ← Volver
          </button>
          <button onClick={confirmarDevolucion} disabled={guardando}
            className="flex-1 bg-purple-600 text-white font-bold py-3 rounded-xl active:bg-purple-700 disabled:opacity-50">
            {guardando ? "Confirmando..." : "✅ Confirmar recepción"}
          </button>
        </div>
      </div>
    )
  }

  // ─── LISTA ───
  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Devoluciones</h2>
          <p className="text-gray-400 text-sm">{devoluciones.length} devolución{devoluciones.length !== 1 ? "es" : ""} pendiente{devoluciones.length !== 1 ? "s" : ""}</p>
        </div>
        <button onClick={cargarDevoluciones} className="px-4 py-2 rounded-xl bg-gray-800 text-gray-300 text-sm">↻</button>
      </div>

      {error && <div className="bg-red-900/50 border border-red-700 rounded-xl p-4 mb-4 text-red-300">{error}</div>}
      {success && <div className="bg-green-900/50 border border-green-700 rounded-xl p-4 mb-4 text-green-300">{success}</div>}

      {devoluciones.length === 0 && !error && (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">↩️</div>
          <div className="text-gray-400 text-lg">No hay devoluciones pendientes</div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {devoluciones.map(dev => {
          const items = dev.devoluciones_detalle || []
          const vendibles = items.filter(i => i.es_vendible).length
          const noVendibles = items.filter(i => !i.es_vendible).length

          return (
            <button key={dev.id} onClick={() => abrirDevolucion(dev)}
              className="bg-gray-900 border border-gray-800 rounded-2xl p-4 text-left w-full active:bg-gray-800">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="text-white font-bold">{dev.numero_devolucion || `DEV-${dev.id.slice(0, 6)}`}</div>
                  <div className="text-purple-400 text-sm">{dev.clientes?.razon_social || dev.clientes?.nombre || "Sin cliente"}</div>
                </div>
                <span className="text-xs font-semibold px-3 py-1 rounded-full bg-yellow-700 text-yellow-100">
                  Pendiente
                </span>
              </div>

              <div className="flex gap-4 text-sm text-gray-400 mb-2">
                <span>📦 {items.length} artículo{items.length !== 1 ? "s" : ""}</span>
                {vendibles > 0 && <span className="text-green-400">✓ {vendibles} vendible{vendibles !== 1 ? "s" : ""}</span>}
                {noVendibles > 0 && <span className="text-red-400">✗ {noVendibles} no vendible{noVendibles !== 1 ? "s" : ""}</span>}
              </div>

              {dev.observaciones && (
                <div className="text-gray-500 text-xs italic truncate">"{dev.observaciones}"</div>
              )}

              <div className="text-right mt-2">
                <span className="text-purple-400 font-semibold text-sm">Confirmar recepción →</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
