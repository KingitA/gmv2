"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { formatCurrency } from "@/lib/utils"

interface PedidoItem {
  id: string
  numero_pedido: string | null
  fecha: string
  estado: string
  total: number | null
  clientes?: { id: string; nombre: string } | null
}

const ESTADOS = [
  { key: "", label: "Todos" },
  { key: "en_venta", label: "En venta" },
  { key: "pendiente", label: "Pendientes" },
  { key: "impreso", label: "Impresos" },
  { key: "en_preparacion", label: "En preparación" },
  { key: "en_viaje", label: "En viaje" },
] as const

const ESTADO_BADGE: Record<string, string> = {
  en_venta: "bg-amber-100 text-amber-700",
  pendiente: "bg-yellow-100 text-yellow-700",
  impreso: "bg-green-100 text-green-700",
  en_preparacion: "bg-blue-100 text-blue-700",
  en_viaje: "bg-purple-100 text-purple-700",
  facturado: "bg-emerald-100 text-emerald-700",
  entregado: "bg-emerald-100 text-emerald-700",
  cancelado: "bg-red-100 text-red-700",
}

const ESTADO_LABEL: Record<string, string> = {
  en_venta: "EN VENTA",
  pendiente: "PENDIENTE",
  impreso: "IMPRESO",
  en_preparacion: "EN PREPARACIÓN",
  en_viaje: "EN VIAJE",
}

export default function VendedorPedidosPage() {
  const router = useRouter()
  const [pedidos, setPedidos] = useState<PedidoItem[]>([])
  const [estado, setEstado] = useState("")
  const [loading, setLoading] = useState(true)

  const cargar = (e: string) => {
    setLoading(true)
    const params = new URLSearchParams()
    if (e) params.set("estado", e)
    fetch(`/api/vendedor/pedidos?${params}`)
      .then((r) => r.json())
      .then((d) => setPedidos(d.pedidos || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    cargar("")
  }, [])

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-emerald-700 text-white sticky top-0 z-10 shadow-md">
        <div className="px-5 py-3 flex items-center gap-3">
          <button onClick={() => router.push("/vendedor")} className="text-2xl leading-none px-1">←</button>
          <h1 className="text-xl font-bold flex-1">Mis Pedidos</h1>
          <button
            onClick={() => router.push("/vendedor/pedido/nuevo")}
            className="bg-emerald-600 px-4 py-2 rounded-xl text-sm font-medium border border-emerald-500"
          >
            + Nuevo
          </button>
        </div>
        <div className="px-4 pb-3 flex gap-2 overflow-x-auto">
          {ESTADOS.map((e) => (
            <button
              key={e.key}
              onClick={() => {
                setEstado(e.key)
                cargar(e.key)
              }}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap ${
                estado === e.key ? "bg-white text-emerald-700" : "bg-emerald-600 text-emerald-100"
              }`}
            >
              {e.label}
            </button>
          ))}
        </div>
      </header>

      <div className="p-4 space-y-3 max-w-2xl mx-auto">
        {loading ? (
          <div className="text-center py-12">
            <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : pedidos.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 text-center">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-gray-500 text-lg">No hay pedidos.</p>
          </div>
        ) : (
          pedidos.map((p) => (
            <button
              key={p.id}
              onClick={() =>
                p.estado === "en_venta" && p.clientes?.id
                  ? router.push(`/vendedor/pedido/nuevo?cliente=${p.clientes.id}&pedido=${p.id}`)
                  : router.push(`/vendedor/pedidos/${p.id}`)
              }
              className="w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-4 flex items-center justify-between text-left active:scale-[0.98]"
            >
              <div className="min-w-0">
                <p className="font-bold text-gray-900 truncate">{p.clientes?.nombre || "Sin cliente"}</p>
                <p className="text-gray-500 text-sm">
                  {p.numero_pedido ? `#${p.numero_pedido} · ` : ""}
                  {new Date(p.fecha + "T00:00:00").toLocaleDateString("es-AR", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                  {p.estado === "en_venta" ? " · tocá para seguir cargando" : ""}
                </p>
              </div>
              <div className="text-right shrink-0 ml-3">
                <p className="font-bold text-gray-900">{formatCurrency(p.total || 0)}</p>
                <span
                  className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${
                    ESTADO_BADGE[p.estado] || "bg-gray-100 text-gray-600"
                  }`}
                >
                  {ESTADO_LABEL[p.estado] || p.estado.toUpperCase()}
                </span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
