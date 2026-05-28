"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { formatCurrency } from "@/lib/utils"

interface ViajeResumen {
  id: string
  nombre: string
  fecha: string
  estado: string
  zonas?: { nombre: string }
}

interface MeData {
  usuario: { id: string; nombre: string; email: string }
  viaje_activo: ViajeResumen | null
  historial: ViajeResumen[]
}

export default function ChoferHomePage() {
  const router = useRouter()
  const [data, setData] = useState<MeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/chofer/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error)
        else setData(d)
      })
      .catch(() => setError("Error al cargar datos"))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-gray-500 text-lg">Cargando...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-4 p-8">
          <p className="text-red-500 text-xl">{error}</p>
          <button
            onClick={() => router.push("/auth/login")}
            className="bg-blue-600 text-white px-6 py-3 rounded-xl text-lg font-medium"
          >
            Iniciar sesión
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-blue-700 text-white px-5 py-4 flex items-center justify-between sticky top-0 z-10 shadow-md">
        <div>
          <p className="text-blue-200 text-sm">GM ERP — Choferes</p>
          <h1 className="text-xl font-bold">{data?.usuario.nombre || data?.usuario.email}</h1>
        </div>
        <button
          onClick={() => router.push("/chofer/billetera")}
          className="bg-blue-600 px-4 py-2 rounded-xl text-sm font-medium border border-blue-500"
        >
          💰 Billetera
        </button>
      </header>

      <div className="p-4 space-y-6 max-w-2xl mx-auto">
        {/* Viaje activo */}
        <section>
          <h2 className="text-lg font-bold text-gray-700 mb-3">Viaje Activo</h2>
          {data?.viaje_activo ? (
            <button
              onClick={() => router.push(`/chofer/${data.viaje_activo!.id}`)}
              className="w-full bg-white rounded-2xl shadow-sm border-2 border-blue-500 p-5 text-left active:scale-95 transition-transform"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xl font-bold text-gray-900">{data.viaje_activo.nombre}</p>
                  <p className="text-gray-500 mt-1">
                    {new Date(data.viaje_activo.fecha).toLocaleDateString("es-AR", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })}
                  </p>
                  {(data.viaje_activo as any).zonas?.nombre && (
                    <p className="text-blue-600 font-medium mt-1">
                      📍 {(data.viaje_activo as any).zonas.nombre}
                    </p>
                  )}
                </div>
                <span className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-sm font-bold">
                  EN CURSO
                </span>
              </div>
              <div className="mt-4 bg-blue-50 rounded-xl px-4 py-3 text-blue-700 font-medium text-center">
                Tocar para gestionar el viaje →
              </div>
            </button>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 text-center">
              <p className="text-4xl mb-3">🚛</p>
              <p className="text-gray-500 text-lg">No tenés un viaje asignado hoy.</p>
              <p className="text-gray-400 text-sm mt-1">Consultá con administración.</p>
            </div>
          )}
        </section>

        {/* Historial de viajes */}
        {data?.historial && data.historial.length > 0 && (
          <section>
            <h2 className="text-lg font-bold text-gray-700 mb-3">Viajes Anteriores</h2>
            <div className="space-y-3">
              {data.historial.map((viaje) => (
                <button
                  key={viaje.id}
                  onClick={() => router.push(`/chofer/${viaje.id}`)}
                  className="w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-4 text-left active:scale-95 transition-transform"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-gray-800">{viaje.nombre}</p>
                      <p className="text-gray-400 text-sm mt-0.5">
                        {new Date(viaje.fecha).toLocaleDateString("es-AR", {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-bold ${
                          viaje.estado === "completado"
                            ? "bg-gray-100 text-gray-500"
                            : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {viaje.estado === "completado" ? "FINALIZADO" : "PENDIENTE RENDICIÓN"}
                      </span>
                      <span className="text-gray-400">›</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
