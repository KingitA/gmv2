"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { formatCurrency } from "@/lib/utils"

// Rendición del viajante — contrato docs/CONTRATO-API-VIAJANTES.md
// El viajante DECLARA (POST /api/viajante/rendir); la confirma oficina
// desde el ERP (segunda firma). Historial: GET /api/viajante/rendiciones.

interface PagoPendiente {
  id: string
  monto: number
  fecha_pago: string
  cliente_nombre: string
  metodo_resumen: string
}

interface Rendicion {
  id: string
  fecha: string
  estado: string
  efectivo_declarado: number
  diferencia: number
  cantidad_pagos: number
  confirmado_at: string | null
}

export default function VendedorRendicionesPage() {
  const router = useRouter()
  const [pagos, setPagos] = useState<PagoPendiente[]>([])
  const [totales, setTotales] = useState({ total: 0, total_efectivo: 0, total_otros: 0 })
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())
  const [efectivoDeclarado, setEfectivoDeclarado] = useState<number>(0)
  const [obs, setObs] = useState("")
  const [historial, setHistorial] = useState<Rendicion[]>([])
  const [historialDisponible, setHistorialDisponible] = useState(true)
  const [loading, setLoading] = useState(true)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    fetch("/api/vendedor/pagos-pendientes")
      .then((r) => r.json())
      .then((d) => {
        if (!d.error) {
          setPagos(d.pagos || [])
          setTotales({ total: d.total, total_efectivo: d.total_efectivo, total_otros: d.total_otros })
          setSeleccionados(new Set((d.pagos || []).map((p: PagoPendiente) => p.id)))
          setEfectivoDeclarado(d.total_efectivo || 0)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))

    fetch("/api/viajante/rendiciones")
      .then((r) => {
        if (r.status === 404) {
          setHistorialDisponible(false)
          return null
        }
        return r.json()
      })
      .then((d) => d && !d.error && setHistorial(d.rendiciones || []))
      .catch(() => setHistorialDisponible(false))
  }, [])

  const toggle = (id: string) => {
    setSeleccionados((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const totalSeleccionado = pagos.filter((p) => seleccionados.has(p.id)).reduce((s, p) => s + p.monto, 0)

  const rendir = async () => {
    if (!seleccionados.size || enviando) return
    if (!confirm(`¿Declarar rendición de ${seleccionados.size} pagos por ${formatCurrency(totalSeleccionado)}? Después la confirma oficina.`)) return
    setEnviando(true)
    try {
      const res = await fetch("/api/viajante/rendir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pago_ids: [...seleccionados],
          efectivo_declarado: efectivoDeclarado,
          observaciones: obs || null,
        }),
      })
      if (res.status === 404) {
        alert("El módulo de rendiciones todavía no está habilitado en el servidor (Fase C/E pendiente). La rendición NO se registró.")
        return
      }
      const d = await res.json()
      if (!res.ok || d.error) {
        alert(d.error || "Error al declarar la rendición.")
        return
      }
      alert(`✅ Rendición declarada (${d.estado}). Diferencia de efectivo: ${formatCurrency(d.diferencia || 0)}. Falta la confirmación de oficina.`)
      router.push("/vendedor/billetera")
    } catch {
      alert("Error de conexión al declarar la rendición.")
    } finally {
      setEnviando(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-12 h-12 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-32">
      <header className="bg-emerald-700 text-white px-5 py-4 sticky top-0 z-10 shadow-md flex items-center gap-3">
        <button onClick={() => router.push("/vendedor/billetera")} className="text-2xl leading-none px-1">←</button>
        <div>
          <h1 className="text-lg font-bold">📤 Rendir cobranzas</h1>
          <p className="text-emerald-200 text-sm">Declarás vos, confirma oficina</p>
        </div>
      </header>

      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        {/* Pagos sin rendir */}
        <section>
          <h2 className="text-lg font-bold text-gray-700 mb-2">
            Pagos sin rendir ({pagos.length})
          </h2>
          {pagos.length ? (
            <div className="space-y-2">
              {pagos.map((p) => (
                <button
                  key={p.id}
                  onClick={() => toggle(p.id)}
                  className={`w-full bg-white rounded-xl border-2 p-3 flex items-center justify-between text-left ${
                    seleccionados.has(p.id) ? "border-emerald-500" : "border-gray-200"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="font-bold text-gray-900 truncate">
                      {seleccionados.has(p.id) ? "☑" : "☐"} {p.cliente_nombre}
                    </p>
                    <p className="text-gray-500 text-sm">
                      {new Date(p.fecha_pago + "T00:00:00").toLocaleDateString("es-AR")} · {p.metodo_resumen}
                    </p>
                  </div>
                  <p className="font-bold text-gray-900 shrink-0 ml-2">{formatCurrency(p.monto)}</p>
                </button>
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center text-gray-500">
              🟢 No tenés pagos pendientes de rendición.
            </div>
          )}
        </section>

        {pagos.length > 0 && (
          <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <div className="flex justify-between text-sm text-gray-500">
              <span>Efectivo estimado: {formatCurrency(totales.total_efectivo)}</span>
              <span>Cheques/transf.: {formatCurrency(totales.total_otros)}</span>
            </div>
            <div>
              <label className="text-gray-700 font-bold block mb-1">💵 Efectivo contado (declarado)</label>
              <input
                type="number"
                inputMode="decimal"
                value={efectivoDeclarado || ""}
                onChange={(e) => setEfectivoDeclarado(Math.max(0, parseFloat(e.target.value) || 0))}
                className="w-full rounded-lg border border-gray-300 px-3 py-3 text-right font-bold text-lg"
              />
            </div>
            <div>
              <label className="text-gray-500 text-sm block mb-1">Observaciones</label>
              <textarea
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
                placeholder="Opcional..."
              />
            </div>
          </section>
        )}

        {/* Historial */}
        <section>
          <h2 className="text-lg font-bold text-gray-700 mb-2">Rendiciones anteriores</h2>
          {!historialDisponible ? (
            <div className="bg-white rounded-xl border border-gray-200 p-4 text-center text-gray-400 text-sm">
              El historial estará disponible cuando se active el módulo de rendiciones.
            </div>
          ) : historial.length ? (
            <div className="space-y-2">
              {historial.map((r) => (
                <div key={r.id} className="bg-white rounded-xl border border-gray-200 p-3 flex items-center justify-between">
                  <div>
                    <p className="font-bold text-gray-900">
                      {new Date(r.fecha).toLocaleDateString("es-AR")} · {r.cantidad_pagos} pagos
                    </p>
                    <p className="text-gray-500 text-sm">
                      Efectivo {formatCurrency(r.efectivo_declarado)}
                      {r.diferencia ? ` · dif. ${formatCurrency(r.diferencia)}` : ""}
                    </p>
                  </div>
                  <span
                    className={`px-2 py-1 rounded-full text-xs font-bold ${
                      r.estado === "confirmada" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
                    }`}
                  >
                    {r.estado === "confirmada" ? "🟢 Confirmada" : "🟡 Abierta"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-4 text-center text-gray-500 text-sm">
              Sin rendiciones registradas.
            </div>
          )}
        </section>
      </div>

      {pagos.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 p-4">
          <div className="max-w-2xl mx-auto space-y-1">
            <div className="flex justify-between text-lg">
              <span className="text-gray-500">{seleccionados.size} pagos seleccionados</span>
              <span className="font-bold text-gray-900">{formatCurrency(totalSeleccionado)}</span>
            </div>
            <button
              onClick={rendir}
              disabled={enviando || !seleccionados.size}
              className="w-full bg-emerald-600 disabled:bg-gray-300 text-white rounded-xl py-4 text-lg font-bold"
            >
              {enviando ? "Declarando..." : "Declarar rendición"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
