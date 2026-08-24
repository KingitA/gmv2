"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { formatCurrency } from "@/lib/utils"

interface ClienteItem {
  id: string
  nombre: string
  cuit: string | null
  direccion?: string | null
  localidad: string | null
  condicion_pago: string | null
  saldo_actual: number
  pagos_sin_rendir: number
}

const FILTROS = [
  { key: "todos", label: "Todos" },
  { key: "con_deuda", label: "Con deuda" },
  { key: "sin_rendir", label: "Sin rendir" },
] as const

export default function VendedorClientesPage() {
  const router = useRouter()
  const [clientes, setClientes] = useState<ClienteItem[]>([])
  const [localidades, setLocalidades] = useState<string[]>([])
  const [q, setQ] = useState("")
  const [filtro, setFiltro] = useState<string>("todos")
  const [localidad, setLocalidad] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cargar = (busqueda: string, f: string, loc: string) => {
    setLoading(true)
    const params = new URLSearchParams()
    if (busqueda) params.set("q", busqueda)
    if (f !== "todos") params.set("filtro", f)
    if (loc) params.set("localidad", loc)
    fetch(`/api/vendedor/clientes?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error)
        else {
          setClientes(d.clientes)
          setLocalidades(d.localidades || [])
          setError(null)
        }
      })
      .catch(() => setError("Error al cargar clientes"))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    cargar("", "todos", "")
  }, [])

  const onSearch = (value: string) => {
    setQ(value)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => cargar(value, filtro, localidad), 350)
  }

  const onFiltro = (f: string) => {
    setFiltro(f)
    cargar(q, f, localidad)
  }

  const onLocalidad = (loc: string) => {
    setLocalidad(loc)
    cargar(q, filtro, loc)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header + búsqueda sticky */}
      <header className="bg-emerald-700 text-white sticky top-0 z-10 shadow-md">
        <div className="px-5 py-3 flex items-center gap-3">
          <button onClick={() => router.push("/vendedor")} className="text-2xl leading-none px-1">
            ←
          </button>
          <h1 className="text-xl font-bold flex-1">Mis Clientes</h1>
          <span className="text-emerald-200 text-sm">{clientes.length}</span>
          <button
            onClick={() => router.push("/vendedor/clientes/nuevo")}
            className="bg-white text-emerald-700 rounded-xl px-3.5 py-2 text-sm font-bold active:scale-95 transition-transform"
          >
            + NUEVO
          </button>
        </div>
        <div className="px-4 pb-3 space-y-2">
          <input
            type="search"
            value={q}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Buscar por nombre o CUIT..."
            className="w-full rounded-xl px-4 py-3 text-gray-900 text-lg bg-white outline-none"
          />
          <div className="flex gap-2 overflow-x-auto pb-1">
            {FILTROS.map((f) => (
              <button
                key={f.key}
                onClick={() => onFiltro(f.key)}
                className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap ${
                  filtro === f.key ? "bg-white text-emerald-700" : "bg-emerald-600 text-emerald-100"
                }`}
              >
                {f.label}
              </button>
            ))}
            <select
              value={localidad}
              onChange={(e) => onLocalidad(e.target.value)}
              className={`px-3 py-2 rounded-full text-sm font-medium outline-none ${
                localidad ? "bg-white text-emerald-700" : "bg-emerald-600 text-emerald-100"
              }`}
            >
              <option value="">Localidad: todas</option>
              {localidades.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <div className="p-4 space-y-3 max-w-2xl mx-auto">
        {loading ? (
          <div className="text-center py-12">
            <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : error ? (
          <p className="text-red-500 text-center py-8">{error}</p>
        ) : clientes.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 text-center">
            <p className="text-4xl mb-3">🔍</p>
            <p className="text-gray-500 text-lg">No se encontraron clientes.</p>
          </div>
        ) : (
          clientes.map((c) => (
            <button
              key={c.id}
              onClick={() => router.push(`/vendedor/clientes/${c.id}`)}
              className="w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-4 text-left active:scale-[0.98] transition-transform"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-gray-900 truncate">{c.nombre}</p>
                  <p className="text-gray-500 text-sm truncate">
                    {[c.direccion, c.localidad, c.condicion_pago].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className={`font-bold ${c.saldo_actual > 0 ? "text-red-600" : "text-green-600"}`}>
                    {formatCurrency(c.saldo_actual)}
                  </p>
                  {c.pagos_sin_rendir > 0 && (
                    <span className="inline-block mt-1 bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full text-xs font-bold">
                      🟡 {c.pagos_sin_rendir} sin rendir
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
