"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { formatCurrency } from "@/lib/utils"

interface Stats {
  ventas_por_mes: { mes: string; total: number; pedidos: number }[]
  top_clientes: { cliente_id: string; nombre: string; total: number; pedidos: number }[]
  comisiones: { pendientes: number; generadas_mes: number }
  cartera: { deuda_total: number; clientes_con_deuda: number }
}

const MES_LABEL = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

function labelMes(mes: string) {
  const [, m] = mes.split("-")
  return MES_LABEL[parseInt(m) - 1] || mes
}

export default function VendedorEstadisticasPage() {
  const router = useRouter()
  const [data, setData] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/vendedor/estadisticas")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error)
        else setData(d)
      })
      .catch(() => setError("Error al cargar estadísticas"))
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

  const mesActual = data.ventas_por_mes[data.ventas_por_mes.length - 1]
  const mesAnterior = data.ventas_por_mes[data.ventas_por_mes.length - 2]
  const maxMes = Math.max(...data.ventas_por_mes.map((m) => m.total), 1)
  const variacion =
    mesAnterior && mesAnterior.total > 0
      ? ((mesActual.total - mesAnterior.total) / mesAnterior.total) * 100
      : null

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-emerald-700 text-white px-5 py-3 sticky top-0 z-10 shadow-md flex items-center gap-3">
        <button onClick={() => router.push("/vendedor")} className="text-2xl leading-none px-1">←</button>
        <h1 className="text-xl font-bold">Mis Estadísticas</h1>
      </header>

      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        {/* Mes actual */}
        <section className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
            <p className="text-gray-500 text-sm">Ventas este mes</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(mesActual?.total || 0)}</p>
            {variacion !== null && (
              <p className={`text-sm font-medium ${variacion >= 0 ? "text-green-600" : "text-red-600"}`}>
                {variacion >= 0 ? "▲" : "▼"} {Math.abs(variacion).toFixed(0)}% vs mes anterior
              </p>
            )}
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
            <p className="text-gray-500 text-sm">Pedidos este mes</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{mesActual?.pedidos || 0}</p>
          </div>
          <button
            onClick={() => router.push("/vendedor/billetera?tab=comisiones")}
            className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 text-left active:scale-[0.98] transition-transform"
          >
            <p className="text-gray-500 text-sm">Comisiones del mes</p>
            <p className="text-xl font-bold text-emerald-700 mt-1">
              {formatCurrency(data.comisiones.generadas_mes)}
            </p>
            <p className="text-gray-400 text-xs">Pend. retiro: {formatCurrency(data.comisiones.pendientes)}</p>
            <p className="text-emerald-700 text-xs font-bold mt-1">Ver detalle →</p>
          </button>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
            <p className="text-gray-500 text-sm">Deuda de cartera</p>
            <p className="text-xl font-bold text-red-600 mt-1">{formatCurrency(data.cartera.deuda_total)}</p>
            <p className="text-gray-400 text-xs">{data.cartera.clientes_con_deuda} clientes con deuda</p>
          </div>
        </section>

        {/* Ventas últimos 6 meses */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
          <h2 className="text-lg font-bold text-gray-700 mb-3">Ventas últimos 6 meses</h2>
          <div className="space-y-2">
            {data.ventas_por_mes.map((m) => (
              <div key={m.mes} className="flex items-center gap-3">
                <span className="w-8 text-gray-500 text-sm font-medium shrink-0">{labelMes(m.mes)}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden">
                  <div
                    className="bg-emerald-500 h-full rounded-full"
                    style={{ width: `${Math.max(2, (m.total / maxMes) * 100)}%` }}
                  />
                </div>
                <span className="w-28 text-right text-sm font-bold text-gray-900 shrink-0">
                  {formatCurrency(m.total)}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Top clientes */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
          <h2 className="text-lg font-bold text-gray-700 mb-3">Top clientes (90 días)</h2>
          {data.top_clientes.length ? (
            <div className="space-y-2">
              {data.top_clientes.map((c, i) => (
                <button
                  key={c.cliente_id}
                  onClick={() => router.push(`/vendedor/clientes/${c.cliente_id}`)}
                  className="w-full flex items-center justify-between py-2 border-b border-gray-100 last:border-0 text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-gray-400 font-bold w-5 shrink-0">{i + 1}</span>
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">{c.nombre}</p>
                      <p className="text-gray-400 text-xs">{c.pedidos} pedidos</p>
                    </div>
                  </div>
                  <p className="font-bold text-gray-900 shrink-0 ml-2">{formatCurrency(c.total)}</p>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-4">Sin ventas en los últimos 90 días.</p>
          )}
        </section>
      </div>
    </div>
  )
}
