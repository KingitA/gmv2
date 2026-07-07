"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

interface Zona {
  id: string
  nombre: string
  descripcion: string | null
  dias_visita: string | null
  cantidad_clientes: number
}

const hoy = () => new Date().toISOString().slice(0, 10)

export default function NuevoViajePage() {
  const router = useRouter()
  const [zonas, setZonas] = useState<Zona[]>([])
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [nombre, setNombre] = useState("")
  const [fechaInicio, setFechaInicio] = useState(hoy())
  const [fechaFin, setFechaFin] = useState("")
  const [creando, setCreando] = useState(false)

  useEffect(() => {
    fetch("/api/vendedor/zonas")
      .then((r) => r.json())
      .then((d) => setZonas(d.zonas || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const toggle = (id: string) =>
    setSel((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const clientesTotal = zonas.filter((z) => sel.has(z.id)).reduce((s, z) => s + z.cantidad_clientes, 0)

  const crear = async () => {
    if (!sel.size || !fechaInicio || creando) return
    setCreando(true)
    try {
      const res = await fetch("/api/vendedor/viajes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: nombre.trim() || undefined,
          fecha_inicio: fechaInicio,
          fecha_fin_estimada: fechaFin || undefined,
          zona_ids: [...sel],
        }),
      })
      const d = await res.json()
      if (d.error) {
        alert(d.error)
        return
      }
      router.replace(`/vendedor/viajes/${d.viaje_id}`)
    } catch {
      alert("Error de conexión al crear el viaje.")
    } finally {
      setCreando(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      <header className="bg-emerald-700 text-white px-5 py-4 sticky top-0 z-10 shadow-md flex items-center gap-3">
        <button onClick={() => router.push("/vendedor/viajes")} className="text-2xl leading-none px-1">←</button>
        <h1 className="text-xl font-bold">Nuevo viaje</h1>
      </header>

      <div className="p-4 space-y-5 max-w-2xl mx-auto">
        {/* Fechas */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 space-y-3">
          <div>
            <label className="text-gray-500 text-sm block mb-1">Nombre (opcional)</label>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Se genera solo con las zonas y la fecha"
              className="w-full rounded-xl border border-gray-300 px-4 py-3"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-gray-500 text-sm block mb-1">Inicio de pedidos</label>
              <input
                type="date"
                value={fechaInicio}
                onChange={(e) => setFechaInicio(e.target.value)}
                className="w-full rounded-xl border border-gray-300 px-3 py-3"
              />
            </div>
            <div>
              <label className="text-gray-500 text-sm block mb-1">Fin estimado</label>
              <input
                type="date"
                value={fechaFin}
                min={fechaInicio}
                onChange={(e) => setFechaFin(e.target.value)}
                className="w-full rounded-xl border border-gray-300 px-3 py-3"
              />
            </div>
          </div>
        </section>

        {/* Zonas */}
        <section>
          <h2 className="text-lg font-bold text-gray-700 mb-2">Zonas del viaje</h2>
          {loading ? (
            <div className="text-center py-10">
              <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          ) : (
            <div className="space-y-2">
              {zonas.map((z) => {
                const activo = sel.has(z.id)
                return (
                  <button
                    key={z.id}
                    onClick={() => toggle(z.id)}
                    className={`w-full bg-white rounded-xl border-2 p-3 text-left active:scale-[0.98] ${
                      activo ? "border-emerald-500" : "border-gray-200"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-bold text-gray-900">
                          {activo ? "☑" : "☐"} {z.nombre}
                        </p>
                        {z.descripcion && <p className="text-gray-500 text-sm truncate">{z.descripcion}</p>}
                      </div>
                      <span className="shrink-0 text-sm font-bold text-emerald-700">
                        {z.cantidad_clientes} clientes
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </section>
      </div>

      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 p-4">
        <div className="max-w-2xl mx-auto space-y-2">
          {sel.size > 0 && (
            <p className="text-center text-gray-500 text-sm">
              {sel.size} {sel.size === 1 ? "zona" : "zonas"} · {clientesTotal} clientes
            </p>
          )}
          <button
            onClick={crear}
            disabled={creando || !sel.size || !fechaInicio}
            className="w-full bg-emerald-600 disabled:bg-gray-300 text-white rounded-xl py-4 text-lg font-bold"
          >
            {creando ? "Creando..." : "Crear viaje"}
          </button>
        </div>
      </div>
    </div>
  )
}
