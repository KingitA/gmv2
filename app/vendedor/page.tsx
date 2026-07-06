"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { formatCurrency } from "@/lib/utils"

interface PedidoResumen {
  id: string
  numero_pedido: string | null
  fecha: string
  estado: string
  total: number | null
  clientes?: { id: string; nombre: string } | null
}

interface MeData {
  usuario: { id: string; nombre: string; email: string }
  vendedores: { id: string; nombre: string }[]
  total_clientes: number
  ultimos_pedidos: PedidoResumen[]
}

const ESTADO_BADGE: Record<string, string> = {
  pendiente: "bg-yellow-100 text-yellow-700",
  confirmado: "bg-blue-100 text-blue-700",
  facturado: "bg-green-100 text-green-700",
  entregado: "bg-green-100 text-green-700",
  cancelado: "bg-red-100 text-red-700",
}

export default function VendedorHomePage() {
  const router = useRouter()
  const [data, setData] = useState<MeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/vendedor/me")
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
          <div className="w-12 h-12 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
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
            className="bg-emerald-600 text-white px-6 py-3 rounded-xl text-lg font-medium"
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
      <header className="bg-emerald-700 text-white px-5 py-4 flex items-center justify-between sticky top-0 z-10 shadow-md">
        <div>
          <p className="text-emerald-200 text-sm">GM ERP — Vendedores</p>
          <h1 className="text-xl font-bold">{data?.usuario.nombre || data?.usuario.email}</h1>
        </div>
        <button
          onClick={() => router.push("/vendedor/billetera")}
          className="bg-emerald-600 px-4 py-2 rounded-xl text-sm font-medium border border-emerald-500"
        >
          💰 Billetera
        </button>
      </header>

      <div className="p-4 space-y-6 max-w-2xl mx-auto">
        {/* Accesos principales */}
        <section className="grid grid-cols-2 gap-4">
          <button
            onClick={() => router.push("/vendedor/clientes")}
            className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 text-left active:scale-95 transition-transform"
          >
            <p className="text-3xl mb-2">👥</p>
            <p className="text-lg font-bold text-gray-900">Mis Clientes</p>
            <p className="text-gray-500 text-sm mt-1">{data?.total_clientes ?? 0} asignados</p>
          </button>
          <button
            onClick={() => router.push("/vendedor/pedido/nuevo")}
            className="bg-emerald-600 rounded-2xl shadow-sm p-5 text-left text-white active:scale-95 transition-transform"
          >
            <p className="text-3xl mb-2">🛒</p>
            <p className="text-lg font-bold">Nuevo Pedido</p>
            <p className="text-emerald-100 text-sm mt-1">Levantar pedido</p>
          </button>
        </section>

        {/* Últimos pedidos */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-gray-700">Últimos pedidos</h2>
            <button onClick={() => router.push("/vendedor/pedidos")} className="text-emerald-700 font-medium text-sm">
              Ver todos →
            </button>
          </div>
          {data?.ultimos_pedidos?.length ? (
            <div className="space-y-3">
              {data.ultimos_pedidos.map((p) => (
                <div
                  key={p.id}
                  className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 flex items-center justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-gray-900 truncate">
                      {p.clientes?.nombre || "Sin cliente"}
                    </p>
                    <p className="text-gray-500 text-sm">
                      {p.numero_pedido ? `#${p.numero_pedido} · ` : ""}
                      {new Date(p.fecha).toLocaleDateString("es-AR", {
                        day: "numeric",
                        month: "short",
                      })}
                    </p>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className="font-bold text-gray-900">{formatCurrency(p.total || 0)}</p>
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${
                        ESTADO_BADGE[p.estado] || "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {p.estado.toUpperCase()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 text-center">
              <p className="text-4xl mb-3">📋</p>
              <p className="text-gray-500 text-lg">Todavía no tenés pedidos.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
