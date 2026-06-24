"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { formatCurrency } from "@/lib/utils"

interface Movimiento {
  id: string
  tipo: string
  medio: string | null
  monto: number
  concepto: string | null
  referencia_id: string | null
  referencia_tipo: string | null
  fecha: string
}

interface BilleteraData {
  saldo: number
  desglose: {
    cobros: number
    fondos_recibidos: number
    gastos: number
  }
  movimientos: Movimiento[]
}

const CATEGORIAS_GASTO = [
  { key: "nafta", label: "Nafta", emoji: "⛽" },
  { key: "hotel", label: "Hotel", emoji: "🏨" },
  { key: "peon", label: "Peón", emoji: "👤" },
  { key: "cubierta", label: "Cubierta", emoji: "🔧" },
  { key: "peaje", label: "Peaje", emoji: "🛣️" },
  { key: "comida", label: "Comida", emoji: "🍽️" },
  { key: "otro", label: "Otro", emoji: "📝" },
]

export default function BilleteraPage() {
  const router = useRouter()
  const [data, setData] = useState<BilleteraData | null>(null)
  const [loading, setLoading] = useState(true)
  const [showGastoSheet, setShowGastoSheet] = useState(false)

  // Estado del formulario de gasto
  const [categoria, setCategoria] = useState("nafta")
  const [monto, setMonto] = useState("")
  const [observaciones, setObservaciones] = useState("")
  const [guardando, setGuardando] = useState(false)

  const cargarDatos = () => {
    setLoading(true)
    fetch("/api/chofer/billetera")
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d) })
      .finally(() => setLoading(false))
  }

  useEffect(() => { cargarDatos() }, [])

  const guardarGasto = async () => {
    if (!monto || Number(monto) <= 0) return
    setGuardando(true)
    try {
      const res = await fetch("/api/chofer/billetera/gasto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monto: Number(monto), categoria, observaciones }),
      })
      const d = await res.json()
      if (d.success) {
        setShowGastoSheet(false)
        setMonto("")
        setObservaciones("")
        setCategoria("nafta")
        cargarDatos()
      }
    } finally {
      setGuardando(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const tipoLabel: Record<string, string> = {
    cobro_cliente: "Cobro",
    credito: "Fondo recibido",
    debito: "Gasto",
    retiro_comision: "Retiro",
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-700 text-white px-5 py-4 sticky top-0 z-10 shadow-md">
        <button onClick={() => router.push("/chofer")} className="text-blue-200 text-sm mb-1">
          ← Inicio
        </button>
        <h1 className="text-xl font-bold">Mi Billetera</h1>
      </header>

      <div className="p-4 space-y-4 pb-36">
        {/* Saldo principal */}
        <div className="bg-blue-700 rounded-2xl p-6 text-white text-center">
          <p className="text-blue-200 mb-1">Saldo actual</p>
          <p className="text-5xl font-bold">{formatCurrency(data?.saldo || 0)}</p>
        </div>

        {/* Desglose */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-2xl p-4 text-center shadow-sm">
            <p className="text-green-600 font-bold text-lg">{formatCurrency(data?.desglose.cobros || 0)}</p>
            <p className="text-xs text-gray-500 mt-1">Cobros</p>
          </div>
          <div className="bg-white rounded-2xl p-4 text-center shadow-sm">
            <p className="text-blue-600 font-bold text-lg">{formatCurrency(data?.desglose.fondos_recibidos || 0)}</p>
            <p className="text-xs text-gray-500 mt-1">Fondos</p>
          </div>
          <div className="bg-white rounded-2xl p-4 text-center shadow-sm">
            <p className="text-red-500 font-bold text-lg">{formatCurrency(data?.desglose.gastos || 0)}</p>
            <p className="text-xs text-gray-500 mt-1">Gastos</p>
          </div>
        </div>

        {/* Movimientos */}
        <section>
          <h2 className="font-bold text-gray-700 mb-3">Movimientos</h2>
          {(!data?.movimientos || data.movimientos.length === 0) ? (
            <div className="text-center py-8 text-gray-400">
              <p className="text-3xl mb-2">📋</p>
              <p>Sin movimientos registrados</p>
            </div>
          ) : (
            <div className="space-y-2">
              {data.movimientos.map((m) => (
                <div key={m.id} className="bg-white rounded-xl px-4 py-3 flex items-center justify-between shadow-sm border border-gray-100">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-800 text-sm truncate">
                      {m.concepto || tipoLabel[m.tipo] || m.tipo}
                    </p>
                    <p className="text-xs text-gray-400">
                      {new Date(m.fecha).toLocaleDateString("es-AR", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <p className={`font-bold text-lg ml-3 flex-shrink-0 ${Number(m.monto) >= 0 ? "text-green-600" : "text-red-500"}`}>
                    {Number(m.monto) >= 0 ? "+" : ""}{formatCurrency(Number(m.monto))}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Botón registrar gasto */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-200 shadow-lg">
        <button
          onClick={() => setShowGastoSheet(true)}
          className="w-full py-4 rounded-2xl bg-red-500 text-white font-bold text-lg active:scale-95 transition-transform"
        >
          💸 Registrar Gasto
        </button>
      </div>

      {/* Sheet: Registrar gasto */}
      {showGastoSheet && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end">
          <div className="bg-white rounded-t-3xl w-full">
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <h2 className="text-xl font-bold">Registrar Gasto</h2>
              <button onClick={() => setShowGastoSheet(false)} className="text-gray-400 text-2xl">×</button>
            </div>
            <div className="p-5 space-y-5">
              {/* Categoría */}
              <div>
                <label className="text-sm font-medium text-gray-600 mb-3 block">Categoría</label>
                <div className="grid grid-cols-3 gap-2">
                  {CATEGORIAS_GASTO.map((cat) => (
                    <button
                      key={cat.key}
                      onClick={() => setCategoria(cat.key)}
                      className={`flex flex-col items-center justify-center min-h-[68px] py-3 rounded-xl border-2 transition-colors ${
                        categoria === cat.key ? "bg-red-50 border-red-500 text-red-700" : "border-gray-200 text-gray-500"
                      }`}
                    >
                      <span className="text-2xl">{cat.emoji}</span>
                      <span className="text-xs mt-1 font-medium">{cat.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Monto */}
              <div>
                <label className="text-sm font-medium text-gray-600 mb-2 block">Monto</label>
                <input
                  type="number"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  placeholder="0.00"
                  inputMode="decimal"
                  className="w-full border-2 border-gray-200 rounded-xl px-4 py-4 text-3xl font-bold text-center focus:border-red-500 focus:outline-none"
                />
              </div>

              {/* Observaciones */}
              <div>
                <label className="text-sm font-medium text-gray-600 mb-2 block">Observación (opcional)</label>
                <input
                  type="text"
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  placeholder="ej: Carga en YPF ruta 8..."
                  className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-lg focus:border-red-500 focus:outline-none"
                />
              </div>

              <button
                onClick={guardarGasto}
                disabled={guardando || !monto || Number(monto) <= 0}
                className="w-full py-5 bg-red-500 text-white rounded-2xl text-xl font-bold active:scale-95 disabled:opacity-50"
              >
                {guardando ? "Guardando..." : `Registrar ${monto ? formatCurrency(Number(monto)) : "Gasto"}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
