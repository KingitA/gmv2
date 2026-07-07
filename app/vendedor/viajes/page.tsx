"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

interface ViajeItem {
  id: string
  nombre: string
  estado: string
  fecha_inicio: string | null
  fecha_fin_estimada: string | null
  zonas: { id: string; nombre: string }[]
}

const fechaCorta = (f: string | null) =>
  f ? new Date(f + "T00:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" }) : "—"

export default function VendedorViajesPage() {
  const router = useRouter()
  const [viajes, setViajes] = useState<ViajeItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/vendedor/viajes")
      .then((r) => r.json())
      .then((d) => setViajes(d.viajes || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const enCurso = viajes.filter((v) => v.estado === "en_curso")
  const cerrados = viajes.filter((v) => v.estado !== "en_curso")

  const Card = ({ v }: { v: ViajeItem }) => (
    <button
      onClick={() => router.push(`/vendedor/viajes/${v.id}`)}
      className="w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-4 text-left active:scale-[0.98]"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold text-gray-900 truncate">{v.nombre}</p>
          <p className="text-gray-500 text-sm mt-0.5">
            {fechaCorta(v.fecha_inicio)} → {fechaCorta(v.fecha_fin_estimada)}
          </p>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {v.zonas.map((z) => (
              <span key={z.id} className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full text-xs font-bold">
                {z.nombre}
              </span>
            ))}
          </div>
        </div>
        <span
          className={`shrink-0 px-2 py-1 rounded-full text-xs font-bold ${
            v.estado === "en_curso" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"
          }`}
        >
          {v.estado === "en_curso" ? "EN CURSO" : v.estado.toUpperCase()}
        </span>
      </div>
    </button>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-emerald-700 text-white sticky top-0 z-10 shadow-md">
        <div className="px-5 py-3 flex items-center gap-3">
          <button onClick={() => router.push("/vendedor")} className="text-2xl leading-none px-1">←</button>
          <h1 className="text-xl font-bold flex-1">Mis Viajes</h1>
          <button
            onClick={() => router.push("/vendedor/viajes/nuevo")}
            className="bg-emerald-600 px-4 py-2 rounded-xl text-sm font-medium border border-emerald-500"
          >
            + Nuevo
          </button>
        </div>
      </header>

      <div className="p-4 space-y-3 max-w-2xl mx-auto">
        {loading ? (
          <div className="text-center py-12">
            <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : viajes.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 text-center">
            <p className="text-4xl mb-3">🧭</p>
            <p className="text-gray-500 text-lg">Todavía no hay viajes.</p>
            <button
              onClick={() => router.push("/vendedor/viajes/nuevo")}
              className="mt-4 bg-emerald-600 text-white rounded-xl px-6 py-3 font-bold"
            >
              Crear el primero
            </button>
          </div>
        ) : (
          <>
            {enCurso.map((v) => (
              <Card key={v.id} v={v} />
            ))}
            {cerrados.length > 0 && (
              <>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400 px-1 pt-2">
                  Anteriores
                </p>
                {cerrados.map((v) => (
                  <Card key={v.id} v={v} />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
