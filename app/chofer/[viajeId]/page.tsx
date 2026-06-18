"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { formatCurrency } from "@/lib/utils"

interface PedidoChofer {
  id: string
  numero: string
  fecha: string
  estado: string
  estado_entrega: "pendiente" | "cobrado" | "devolucion_registrada"
  cliente_id: string
  cliente_nombre: string
  direccion: string
  telefono: string
  localidad: string
  bultos: number
  total_pedido: number
  saldo_anterior: number
  total_a_cobrar: number
  cobrado: number
  devuelto: number
}

interface ViajeData {
  viaje: {
    id: string
    nombre: string
    fecha: string
    estado: string
    zona_nombre: string
    dinero_nafta: number
    gastos_peon: number
    gastos_hotel: number
  }
  pedidos: PedidoChofer[]
  resumen: {
    total_pedidos: number
    total_a_cobrar: number
    total_cobrado: number
    total_gastos: number
    efectivo_neto: number
    pendientes: number
    cobrados: number
  }
}

const READONLY_ESTADOS = ["completado", "en_rendicion"]

export default function ViajeDashboardPage() {
  const router = useRouter()
  const params = useParams()
  const viajeId = params.viajeId as string

  const [data, setData] = useState<ViajeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [finalizando, setFinalizando] = useState(false)
  const [showConfirmFinalizar, setShowConfirmFinalizar] = useState(false)

  useEffect(() => {
    fetch(`/api/chofer/viaje/${viajeId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.error) setData(d)
      })
      .finally(() => setLoading(false))
  }, [viajeId])

  const esReadOnly = READONLY_ESTADOS.includes(data?.viaje.estado || "")

  const handleFinalizar = async () => {
    setFinalizando(true)
    try {
      const res = await fetch(`/api/chofer/viaje/${viajeId}/finalizar`, { method: "POST" })
      const d = await res.json()
      if (d.success) {
        router.push("/chofer")
      }
    } finally {
      setFinalizando(false)
      setShowConfirmFinalizar(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-red-500 text-xl">No se encontró el viaje.</p>
      </div>
    )
  }

  const { viaje, pedidos, resumen } = data

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-blue-700 text-white px-5 py-4 sticky top-0 z-10 shadow-md">
        <button
          onClick={() => router.push("/chofer")}
          className="text-blue-200 text-sm mb-1 flex items-center gap-1"
        >
          ← Inicio
        </button>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold">{viaje.nombre}</h1>
            <p className="text-blue-200 text-sm">
              {new Date(viaje.fecha).toLocaleDateString("es-AR", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
              {viaje.zona_nombre ? ` — ${viaje.zona_nombre}` : ""}
            </p>
          </div>
          {esReadOnly && (
            <span className="bg-gray-500 text-white text-xs px-3 py-1 rounded-full font-bold">
              {viaje.estado === "en_rendicion" ? "EN RENDICIÓN" : "FINALIZADO"}
            </span>
          )}
        </div>
      </header>

      {/* Banner modo lectura */}
      {esReadOnly && (
        <div className="bg-amber-50 border-b border-amber-200 px-5 py-3 text-amber-800 text-sm text-center font-medium">
          Viaje finalizado — solo consulta
        </div>
      )}

      {/* Resumen estadísticas */}
      <div className="p-4 grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl p-3 text-center shadow-sm">
          <p className="text-2xl font-bold text-gray-800">{resumen.total_pedidos}</p>
          <p className="text-xs text-gray-500">Clientes</p>
        </div>
        <div className="bg-white rounded-xl p-3 text-center shadow-sm">
          <p className="text-2xl font-bold text-green-600">{resumen.cobrados}</p>
          <p className="text-xs text-gray-500">Cobrados</p>
        </div>
        <div className="bg-white rounded-xl p-3 text-center shadow-sm">
          <p className="text-2xl font-bold text-amber-600">{resumen.pendientes}</p>
          <p className="text-xs text-gray-500">Pendientes</p>
        </div>
      </div>

      {/* Resumen financiero */}
      <div className="mx-4 bg-blue-700 rounded-2xl p-4 text-white mb-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-blue-200">Total a cobrar</p>
            <p className="text-lg font-bold">{formatCurrency(resumen.total_a_cobrar)}</p>
          </div>
          <div>
            <p className="text-blue-200">Cobrado</p>
            <p className="text-lg font-bold text-green-300">{formatCurrency(resumen.total_cobrado)}</p>
          </div>
          <div>
            <p className="text-blue-200">Gastos</p>
            <p className="text-lg font-bold text-red-300">{formatCurrency(resumen.total_gastos)}</p>
          </div>
          <div>
            <p className="text-blue-200">Efectivo neto</p>
            <p className="text-lg font-bold text-yellow-200">{formatCurrency(resumen.efectivo_neto)}</p>
          </div>
        </div>
      </div>

      {/* Lista de clientes */}
      <div className="px-4 space-y-3 pb-32">
        {pedidos.map((pedido) => (
          <div
            key={pedido.id}
            onClick={() => router.push(`/chofer/${viajeId}/cliente/${pedido.cliente_id}`)}
            className="w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-4 text-left active:scale-[0.98] transition-transform cursor-pointer"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <EstadoBadge estado={pedido.estado_entrega} />
                  <p className="font-bold text-gray-900 truncate">{pedido.cliente_nombre}</p>
                </div>
                <p className="text-gray-500 text-sm mt-1 truncate">📍 {pedido.direccion}</p>
                {pedido.localidad && (
                  <p className="text-gray-400 text-xs">{pedido.localidad}</p>
                )}
              </div>
              <span className="text-gray-400 text-xl flex-shrink-0">›</span>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="bg-gray-50 rounded-lg py-2">
                <p className="text-xs text-gray-400">Bultos</p>
                <p className="font-bold text-gray-800">{pedido.bultos}</p>
              </div>
              <div className="bg-gray-50 rounded-lg py-2">
                <p className="text-xs text-gray-400">Pedido</p>
                <p className="font-bold text-gray-800 text-sm">{formatCurrency(pedido.total_pedido)}</p>
              </div>
              <div className={`rounded-lg py-2 ${pedido.saldo_anterior > 0 ? "bg-red-50" : "bg-gray-50"}`}>
                <p className="text-xs text-gray-400">Saldo prev.</p>
                <p className={`font-bold text-sm ${pedido.saldo_anterior > 0 ? "text-red-600" : "text-gray-400"}`}>
                  {pedido.saldo_anterior > 0 ? formatCurrency(pedido.saldo_anterior) : "—"}
                </p>
              </div>
            </div>

            <div className="mt-2 bg-blue-50 rounded-lg px-3 py-2 flex justify-between items-center">
              <span className="text-blue-700 text-sm font-medium">Total a cobrar:</span>
              <span className="text-blue-800 font-bold">{formatCurrency(pedido.total_a_cobrar)}</span>
            </div>

            {!esReadOnly && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); router.push(`/chofer/${viajeId}/cliente/${pedido.cliente_id}?accion=devolucion`) }}
                  className="py-2.5 rounded-xl bg-amber-100 text-amber-800 font-bold text-sm border border-amber-200 active:scale-95 transition-transform"
                >
                  ↩ Devolución
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); router.push(`/chofer/${viajeId}/cliente/${pedido.cliente_id}?accion=cobrar`) }}
                  className="py-2.5 rounded-xl bg-blue-600 text-white font-bold text-sm active:scale-95 transition-transform"
                >
                  💵 Cobrar
                </button>
              </div>
            )}
          </div>
        ))}

        {pedidos.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <p className="text-4xl mb-2">📦</p>
            <p>No hay pedidos en este viaje</p>
          </div>
        )}
      </div>

      {/* Botón finalizar viaje (solo si activo) */}
      {!esReadOnly && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-200 shadow-lg">
          <button
            onClick={() => setShowConfirmFinalizar(true)}
            className="w-full bg-orange-500 text-white py-4 rounded-2xl text-lg font-bold active:scale-95 transition-transform"
          >
            🏁 Rendir Viaje
          </button>
        </div>
      )}

      {/* Modal confirmar finalizar */}
      {showConfirmFinalizar && (
        <div className="fixed inset-0 bg-black/50 flex items-end z-50">
          <div className="bg-white rounded-t-3xl p-6 w-full space-y-4">
            <h3 className="text-xl font-bold text-center">¿Rendir el viaje?</h3>
            <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Total cobrado</span>
                <span className="font-bold">{formatCurrency(resumen.total_cobrado)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Gastos del viaje</span>
                <span className="font-bold text-red-600">−{formatCurrency(resumen.total_gastos)}</span>
              </div>
              <div className="border-t pt-2 flex justify-between font-bold">
                <span>Efectivo a entregar</span>
                <span className="text-green-700">{formatCurrency(resumen.efectivo_neto)}</span>
              </div>
            </div>
            <p className="text-gray-500 text-sm text-center">
              Los cobros quedarán pendientes hasta que el administrador los confirme.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setShowConfirmFinalizar(false)}
                className="py-4 rounded-2xl border-2 border-gray-300 font-bold text-gray-600 active:scale-95"
              >
                Cancelar
              </button>
              <button
                onClick={handleFinalizar}
                disabled={finalizando}
                className="py-4 rounded-2xl bg-orange-500 text-white font-bold active:scale-95 disabled:opacity-50"
              >
                {finalizando ? "Enviando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function EstadoBadge({ estado }: { estado: string }) {
  if (estado === "cobrado") {
    return <span className="w-3 h-3 rounded-full bg-green-500 flex-shrink-0" />
  }
  if (estado === "devolucion_registrada") {
    return <span className="w-3 h-3 rounded-full bg-amber-500 flex-shrink-0" />
  }
  return <span className="w-3 h-3 rounded-full bg-gray-300 flex-shrink-0" />
}
