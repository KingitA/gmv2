"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { formatCurrency } from "@/lib/utils"

interface ClienteViaje {
  id: string
  nombre: string
  localidad: string | null
  telefono: string | null
  saldo_actual: number
  estado_viaje: "pendiente" | "pedido_levantado" | "no_va"
  pedido: { id: string; numero_pedido: string | null; total: number | null; estado: string } | null
}

interface ViajeDetalle {
  id: string
  nombre: string
  estado: string
  fecha_inicio: string | null
  fecha_fin_estimada: string | null
  zonas: { id: string; nombre: string }[]
}

const fechaCorta = (f: string | null) =>
  f ? new Date(f + "T00:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" }) : "—"

export default function ViajeDetallePage() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()
  const [viaje, setViaje] = useState<ViajeDetalle | null>(null)
  const [clientes, setClientes] = useState<ClienteViaje[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`/api/vendedor/viajes/${id}`)
      const d = await r.json()
      if (d.error) throw new Error(d.error)
      setViaje(d.viaje)
      setClientes(d.clientes || [])
      setError(null)
    } catch (e: any) {
      setError(e?.message || "No se pudo cargar el viaje")
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    cargar()
  }, [cargar])

  const marcarNoVa = async (c: ClienteViaje, noVa: boolean) => {
    // Optimista: mover de sección al instante
    setClientes((prev) =>
      prev.map((x) =>
        x.id === c.id
          ? { ...x, estado_viaje: noVa ? "no_va" : x.pedido ? "pedido_levantado" : "pendiente" }
          : x
      )
    )
    try {
      const res = await fetch(`/api/vendedor/viajes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "cliente_no_va", cliente_id: c.id, no_va: noVa }),
      })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
    } catch {
      cargar()
    }
  }

  const cerrarViaje = async () => {
    if (!viaje) return
    const abierto = viaje.estado === "en_curso"
    if (abierto && !confirm("¿Marcar el viaje como completado?")) return
    try {
      const res = await fetch(`/api/vendedor/viajes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "estado", estado: abierto ? "completado" : "en_curso" }),
      })
      const d = await res.json()
      if (d.error) alert(d.error)
      else cargar()
    } catch {
      alert("Error de conexión.")
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !viaje) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <p className="text-red-500 text-xl">{error || "Viaje no encontrado"}</p>
          <button
            onClick={() => router.push("/vendedor/viajes")}
            className="bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold"
          >
            Volver a viajes
          </button>
        </div>
      </div>
    )
  }

  const levantados = clientes.filter((c) => c.estado_viaje === "pedido_levantado")
  const pendientes = clientes.filter((c) => c.estado_viaje === "pendiente")
  const noVan = clientes.filter((c) => c.estado_viaje === "no_va")
  const enJuego = levantados.length + pendientes.length
  const progreso = enJuego ? Math.round((levantados.length / enJuego) * 100) : 0

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <header className="bg-emerald-700 text-white sticky top-0 z-10 shadow-md">
        <div className="px-5 py-3 flex items-center gap-3">
          <button onClick={() => router.push("/vendedor/viajes")} className="text-2xl leading-none px-1">←</button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold truncate">{viaje.nombre}</h1>
            <p className="text-emerald-200 text-xs truncate">
              {fechaCorta(viaje.fecha_inicio)} → {fechaCorta(viaje.fecha_fin_estimada)} ·{" "}
              {viaje.zonas.map((z) => z.nombre).join(" + ")}
            </p>
          </div>
          <button
            onClick={cerrarViaje}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold ${
              viaje.estado === "en_curso" ? "bg-emerald-600 border border-emerald-500" : "bg-gray-500"
            }`}
          >
            {viaje.estado === "en_curso" ? "Completar ✓" : "Reabrir"}
          </button>
        </div>
        {/* Progreso */}
        <div className="px-5 pb-3">
          <div className="flex justify-between text-xs text-emerald-200 mb-1">
            <span>
              {levantados.length} de {enJuego} pedidos levantados
            </span>
            <span>{progreso}%</span>
          </div>
          <div className="h-2 bg-emerald-900/40 rounded-full overflow-hidden">
            <div className="h-full bg-white rounded-full transition-all" style={{ width: `${progreso}%` }} />
          </div>
        </div>
      </header>

      <div className="p-4 space-y-5 max-w-2xl mx-auto">
        {/* Pedidos levantados */}
        <section>
          <h2 className="text-lg font-bold text-gray-700 mb-2">✅ Con pedido ({levantados.length})</h2>
          {levantados.length ? (
            <div className="space-y-2">
              {levantados.map((c) => (
                <div key={c.id} className="bg-white rounded-xl border border-emerald-200 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <button
                      onClick={() => c.pedido && router.push(`/vendedor/pedidos/${c.pedido.id}`)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="font-bold text-gray-900 truncate">{c.nombre}</p>
                      <p className="text-gray-500 text-sm">
                        {c.pedido?.numero_pedido ? `#${c.pedido.numero_pedido} · ` : ""}
                        {formatCurrency(c.pedido?.total || 0)}
                        {c.pedido?.estado === "en_venta" ? " · EN VENTA" : ""}
                      </p>
                    </button>
                    <div className="flex gap-1.5 shrink-0">
                      <AccionMini icono="👤" onClick={() => router.push(`/vendedor/clientes/${c.id}`)} />
                      <AccionMini icono="💵" onClick={() => router.push(`/vendedor/clientes/${c.id}/cobrar`)} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-4 text-center text-gray-500 text-sm">
              Todavía no levantaste pedidos en este viaje.
            </div>
          )}
        </section>

        {/* Pendientes */}
        <section>
          <h2 className="text-lg font-bold text-gray-700 mb-2">🕐 Sin pedido ({pendientes.length})</h2>
          <div className="space-y-2">
            {pendientes.map((c) => (
              <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-gray-900 truncate">{c.nombre}</p>
                    <p className="text-gray-500 text-sm">
                      {c.localidad || "—"}
                      {c.saldo_actual > 0 ? (
                        <span className="text-red-600 font-bold"> · debe {formatCurrency(c.saldo_actual)}</span>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      onClick={() => router.push(`/vendedor/pedido/nuevo?cliente=${c.id}`)}
                      className="bg-emerald-600 text-white rounded-lg px-3 py-2 text-sm font-bold active:scale-95"
                    >
                      🛒 Pedido
                    </button>
                    <AccionMini icono="👤" onClick={() => router.push(`/vendedor/clientes/${c.id}`)} />
                    <AccionMini icono="💵" onClick={() => router.push(`/vendedor/clientes/${c.id}/cobrar`)} />
                    <AccionMini icono="🚫" title="No va en este viaje" onClick={() => marcarNoVa(c, true)} />
                  </div>
                </div>
              </div>
            ))}
            {!pendientes.length && (
              <div className="bg-white rounded-xl border border-gray-200 p-4 text-center text-gray-500 text-sm">
                No quedan clientes pendientes. 🎉
              </div>
            )}
          </div>
        </section>

        {/* No van */}
        {noVan.length > 0 && (
          <section>
            <h2 className="text-sm font-bold text-gray-400 mb-2">🚫 No van en este viaje ({noVan.length})</h2>
            <div className="space-y-2">
              {noVan.map((c) => (
                <div
                  key={c.id}
                  className="bg-gray-100 rounded-xl border border-gray-200 p-3 flex items-center justify-between gap-3 opacity-70"
                >
                  <p className="font-medium text-gray-600 truncate flex-1">{c.nombre}</p>
                  <button
                    onClick={() => marcarNoVa(c, false)}
                    className="text-emerald-700 text-sm font-bold shrink-0"
                  >
                    Reponer
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function AccionMini({ icono, onClick, title }: { icono: string; onClick: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-lg active:scale-95"
    >
      {icono}
    </button>
  )
}
