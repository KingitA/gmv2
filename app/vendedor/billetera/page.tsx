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
  fecha: string
}

interface ComisionPend {
  id: string
  monto: number
  segmento: string | null
  porcentaje: number | null
  created_at: string
  articulos?: { descripcion: string } | null
}

interface BilleteraData {
  balance: number
  desglose: { cobros: number; retiros: number; debitos: number; creditos: number }
  comisiones_pendientes: ComisionPend[]
  total_pendiente_comisiones: number
  historial: Movimiento[]
}

const TIPO_LABEL: Record<string, { label: string; icon: string; color: string }> = {
  cobro_cliente: { label: "Cobro cliente", icon: "💵", color: "text-green-600" },
  retiro_comision: { label: "Retiro comisión", icon: "🏦", color: "text-red-600" },
  debito: { label: "Débito", icon: "➖", color: "text-red-600" },
  credito: { label: "Crédito", icon: "➕", color: "text-green-600" },
}

const SEGMENTO_LABEL: Record<string, string> = {
  limpieza_bazar: "Limpieza/Bazar",
  perf0: "Perfumería 0",
  perf_plus: "Perfumería +",
}

export default function VendedorBilleteraPage() {
  const router = useRouter()
  const [data, setData] = useState<BilleteraData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<"movimientos" | "comisiones">("movimientos")

  useEffect(() => {
    fetch("/api/vendedor/billetera")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error)
        else setData(d)
      })
      .catch(() => setError("Error al cargar la billetera"))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-12 h-12 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center min-h-screen p-8 text-center">
        <p className="text-red-500 text-xl">{error || "Sin datos"}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-emerald-700 text-white px-5 py-3 sticky top-0 z-10 shadow-md flex items-center gap-3">
        <button onClick={() => router.push("/vendedor")} className="text-2xl leading-none px-1">←</button>
        <h1 className="text-xl font-bold">Mi Billetera</h1>
      </header>

      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        {/* Saldo */}
        <section className="bg-emerald-700 text-white rounded-2xl shadow-md p-6 text-center">
          <p className="text-emerald-200 text-sm">Plata en la calle</p>
          <p className="text-4xl font-bold mt-1">{formatCurrency(data.balance)}</p>
          <div className="grid grid-cols-2 gap-2 mt-4 text-sm">
            <div className="bg-emerald-600/60 rounded-xl px-3 py-2">
              <p className="text-emerald-200">Cobros</p>
              <p className="font-bold">{formatCurrency(data.desglose.cobros)}</p>
            </div>
            <div className="bg-emerald-600/60 rounded-xl px-3 py-2">
              <p className="text-emerald-200">Comisiones pend.</p>
              <p className="font-bold">{formatCurrency(data.total_pendiente_comisiones)}</p>
            </div>
          </div>
          <p className="text-emerald-200 text-xs mt-3">
            La rendición se declara acá y la confirma oficina (doble firma).
          </p>
        </section>

        {/* Tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => setTab("movimientos")}
            className={`flex-1 py-3 rounded-xl font-bold text-sm ${
              tab === "movimientos" ? "bg-emerald-600 text-white" : "bg-white text-gray-600 border border-gray-200"
            }`}
          >
            Movimientos
          </button>
          <button
            onClick={() => setTab("comisiones")}
            className={`flex-1 py-3 rounded-xl font-bold text-sm ${
              tab === "comisiones" ? "bg-emerald-600 text-white" : "bg-white text-gray-600 border border-gray-200"
            }`}
          >
            Comisiones ({data.comisiones_pendientes.length})
          </button>
        </div>

        {tab === "movimientos" ? (
          data.historial.length ? (
            <div className="space-y-2">
              {data.historial.map((m) => {
                const t = TIPO_LABEL[m.tipo] || { label: m.tipo, icon: "•", color: "text-gray-600" }
                return (
                  <div
                    key={m.id}
                    className="bg-white rounded-xl border border-gray-200 p-3 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xl">{t.icon}</span>
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 text-sm truncate">{m.concepto || t.label}</p>
                        <p className="text-gray-400 text-xs">
                          {new Date(m.fecha).toLocaleDateString("es-AR")} · {t.label}
                          {m.medio ? ` · ${m.medio}` : ""}
                        </p>
                      </div>
                    </div>
                    <p className={`font-bold shrink-0 ml-2 ${Number(m.monto) >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatCurrency(Number(m.monto))}
                    </p>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center text-gray-500">
              Sin movimientos todavía.
            </div>
          )
        ) : data.comisiones_pendientes.length ? (
          <div className="space-y-2">
            {data.comisiones_pendientes.map((cm) => (
              <div key={cm.id} className="bg-white rounded-xl border border-gray-200 p-3 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 text-sm truncate">
                    {cm.articulos?.descripcion || "Comisión"}
                  </p>
                  <p className="text-gray-400 text-xs">
                    {new Date(cm.created_at).toLocaleDateString("es-AR")}
                    {cm.segmento ? ` · ${SEGMENTO_LABEL[cm.segmento] || cm.segmento}` : ""}
                    {cm.porcentaje ? ` · ${cm.porcentaje}%` : ""}
                  </p>
                </div>
                <p className="font-bold text-emerald-700 shrink-0 ml-2">{formatCurrency(Number(cm.monto))}</p>
              </div>
            ))}
            <p className="text-gray-400 text-xs text-center pt-1">
              El retiro de comisiones se coordina con administración.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center text-gray-500">
            Sin comisiones pendientes.
          </div>
        )}
      </div>
    </div>
  )
}
