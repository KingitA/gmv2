"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { formatCurrency } from "@/lib/utils"

// Panel PAGO — acceso rápido desde el inicio para cobrar: buscás el cliente,
// ves cuánto debe, y entrás directo a la pantalla de cobro (pedidos +
// comprobantes + métodos de pago).

interface ClienteRow {
  id: string
  nombre: string
  localidad: string | null
  saldo_actual: number
}

export default function VendedorPagoPage() {
  const router = useRouter()
  const [q, setQ] = useState("")
  const [soloDeuda, setSoloDeuda] = useState(true)
  const [clientes, setClientes] = useState<ClienteRow[]>([])
  const [cargando, setCargando] = useState(true)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const buscar = (texto: string, conDeuda: boolean) => {
    setCargando(true)
    const params = new URLSearchParams()
    if (texto.trim()) params.set("q", texto.trim())
    if (conDeuda) params.set("filtro", "con_deuda")
    fetch(`/api/vendedor/clientes?${params}`)
      .then((r) => r.json())
      .then((d) => setClientes(d.clientes || []))
      .catch(() => setClientes([]))
      .finally(() => setCargando(false))
  }

  useEffect(() => {
    buscar("", true)
  }, [])

  const onBuscar = (texto: string) => {
    setQ(texto)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => buscar(texto, soloDeuda), 350)
  }

  const toggleDeuda = () => {
    const next = !soloDeuda
    setSoloDeuda(next)
    buscar(q, next)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-emerald-700 text-white sticky top-0 z-10 shadow-md">
        <div className="px-5 py-3 flex items-center gap-3">
          <button onClick={() => router.push("/vendedor")} className="text-2xl leading-none px-1">←</button>
          <div>
            <h1 className="text-xl font-bold">💵 Pago</h1>
            <p className="text-emerald-200 text-xs">Buscá el cliente y cobrale</p>
          </div>
        </div>
        <div className="px-4 pb-3 space-y-2">
          <input
            type="search"
            value={q}
            onChange={(e) => onBuscar(e.target.value)}
            placeholder="Buscar cliente..."
            autoFocus
            className="w-full rounded-xl px-4 py-3 text-gray-900 text-lg bg-white outline-none"
          />
          <button
            onClick={toggleDeuda}
            className={`px-3.5 py-1.5 rounded-full text-xs font-bold border ${
              soloDeuda
                ? "bg-emerald-900/60 text-white border-emerald-500"
                : "bg-white/10 text-emerald-100 border-emerald-500/50"
            }`}
          >
            {soloDeuda ? "☑" : "☐"} Solo con deuda
          </button>
        </div>
      </header>

      <div className="p-4 space-y-2 max-w-2xl mx-auto">
        {cargando ? (
          <div className="text-center py-10">
            <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : clientes.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center text-gray-500">
            {q ? `Sin resultados para “${q}”.` : "No hay clientes con deuda. 🎉"}
          </div>
        ) : (
          clientes.map((c) => (
            <button
              key={c.id}
              onClick={() => router.push(`/vendedor/clientes/${c.id}/cobrar`)}
              className="w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-4 text-left flex items-center justify-between gap-3 active:scale-[0.98] transition-transform"
            >
              <div className="min-w-0">
                <p className="font-bold text-gray-900 truncate">{c.nombre}</p>
                <p className="text-gray-500 text-sm truncate">{c.localidad || "—"}</p>
              </div>
              <div className="text-right shrink-0">
                {c.saldo_actual > 0 ? (
                  <>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-red-400">Debe</p>
                    <p className="font-bold text-red-600">{formatCurrency(c.saldo_actual)}</p>
                  </>
                ) : (
                  <p className="text-gray-400 text-sm font-medium">Al día</p>
                )}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
