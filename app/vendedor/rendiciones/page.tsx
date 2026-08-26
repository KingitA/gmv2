"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { formatCurrency } from "@/lib/utils"

// Rendiciones del viajante — vos declarás (POST /api/viajante/rendir) y la
// plata pasa a "en viaje a oficina" (billetera en 0); oficina confirma cuando
// recibe el dinero (segunda firma, rendicion_confirmar).

interface PagoPendiente {
  id: string
  monto: number
  monto_efectivo?: number
  fecha_pago: string
  cliente_nombre: string
  metodo_resumen: string
}

interface PagoRendicion {
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
  efectivo_registrado: number
  diferencia: number
  observaciones: string | null
  cantidad_pagos: number
  total: number
  confirmado_at: string | null
  pagos: PagoRendicion[]
}

export default function VendedorRendicionesPage() {
  const router = useRouter()
  const [pagos, setPagos] = useState<PagoPendiente[]>([])
  const [totales, setTotales] = useState({ total: 0, total_efectivo: 0, total_otros: 0 })
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())
  const [efectivoDeclarado, setEfectivoDeclarado] = useState<number>(0)
  const [obs, setObs] = useState("")
  const [historial, setHistorial] = useState<Rendicion[]>([])
  const [abierta, setAbierta] = useState<string | null>(null) // rendición expandida
  const [loading, setLoading] = useState(true)
  const [enviando, setEnviando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const [pend, hist] = await Promise.all([
        fetch("/api/vendedor/pagos-pendientes").then((r) => r.json()),
        fetch("/api/viajante/rendiciones").then((r) => r.json()),
      ])
      if (!pend.error) {
        setPagos(pend.pagos || [])
        setTotales({ total: pend.total, total_efectivo: pend.total_efectivo, total_otros: pend.total_otros })
        setSeleccionados(new Set((pend.pagos || []).map((p: PagoPendiente) => p.id)))
        setEfectivoDeclarado(pend.total_efectivo || 0)
      }
      if (!hist.error) setHistorial(hist.rendiciones || [])
    } catch {
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

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
    const efectivoSel = pagos.filter((p) => seleccionados.has(p.id)).reduce((s, p) => s + (p.monto_efectivo ?? 0), 0)
    const difDeclarado = Math.round((efectivoDeclarado - efectivoSel) * 100) / 100
    if (
      !confirm(
        `¿Rendir ${seleccionados.size} cobro${seleccionados.size === 1 ? "" : "s"} por ${formatCurrency(totalSeleccionado)}?\n\n` +
          `Efectivo que declarás llevar: ${formatCurrency(efectivoDeclarado)}` +
          (difDeclarado !== 0
            ? `\n⚠ Según los cobros deberías llevar ${formatCurrency(efectivoSel)} en efectivo (${difDeclarado > 0 ? "sobran" : "faltan"} ${formatCurrency(Math.abs(difDeclarado))}). Oficina lo va a ver al controlar.`
            : "") +
          `\n\nOficina recibe el aviso de que el dinero está en viaje y tu billetera queda en 0. Los pagos se confirman cuando oficina recibe la plata.`
      )
    )
      return
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
      const d = await res.json()
      if (!res.ok || d.error) {
        alert(d.error || "Error al rendir.")
        return
      }
      alert(
        `✅ Rendición enviada: ${seleccionados.size} cobro${seleccionados.size === 1 ? "" : "s"} por ${formatCurrency(totalSeleccionado)}, efectivo declarado ${formatCurrency(Number(d.efectivo_declarado ?? efectivoDeclarado))}. La plata figura "en viaje a oficina" hasta que la confirmen.`
      )
      setObs("")
      setLoading(true)
      await cargar()
    } catch {
      alert("Error de conexión al rendir.")
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
    <div className="min-h-screen bg-gray-50 pb-10">
      <header className="bg-emerald-700 text-white px-5 py-4 sticky top-0 z-10 shadow-md flex items-center gap-3">
        <button onClick={() => router.push("/vendedor/billetera")} className="text-2xl leading-none px-1">←</button>
        <div>
          <h1 className="text-lg font-bold">🧾 Rendiciones</h1>
          <p className="text-emerald-200 text-sm">Vos rendís, oficina confirma al recibir</p>
        </div>
      </header>

      <div className="p-4 space-y-5 max-w-2xl mx-auto">
        {/* ── Dinero para rendir ── */}
        <section>
          <h2 className="text-lg font-bold text-gray-700 mb-2">Dinero para rendir ({pagos.length})</h2>
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

              <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
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
                <button
                  onClick={rendir}
                  disabled={enviando || !seleccionados.size}
                  className="w-full bg-emerald-600 disabled:bg-gray-300 text-white rounded-xl py-4 text-lg font-bold"
                >
                  {enviando
                    ? "Enviando..."
                    : `📤 RENDIR DINERO EN CUENTA · ${formatCurrency(totalSeleccionado)}`}
                </button>
                <p className="text-gray-400 text-xs text-center">
                  Oficina recibe el aviso de que el dinero está en viaje y tu billetera queda en 0.
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center text-gray-500">
              🟢 No tenés dinero pendiente de rendir.
              <p className="text-gray-400 text-sm mt-2">
                Cada cobro que registres en la calle aparece acá para rendirlo.
              </p>
            </div>
          )}
        </section>

        {/* ── Historial de rendiciones ── */}
        <section>
          <h2 className="text-lg font-bold text-gray-700 mb-2">Rendiciones anteriores</h2>
          {historial.length ? (
            <div className="space-y-2">
              {historial.map((r) => {
                const expandida = abierta === r.id
                return (
                  <div key={r.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <button
                      onClick={() => setAbierta(expandida ? null : r.id)}
                      className="w-full p-3 flex items-center justify-between text-left"
                    >
                      <div className="min-w-0">
                        <p className="font-bold text-gray-900">
                          {new Date(r.fecha).toLocaleDateString("es-AR")} · {r.cantidad_pagos}{" "}
                          {r.cantidad_pagos === 1 ? "pago" : "pagos"} · {formatCurrency(r.total)}
                        </p>
                        <p className="text-gray-500 text-sm">
                          Efectivo declarado {formatCurrency(r.efectivo_declarado)}
                          {r.diferencia ? ` · dif. ${formatCurrency(r.diferencia)}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-bold ${
                            r.estado === "confirmada"
                              ? "bg-green-100 text-green-700"
                              : "bg-yellow-100 text-yellow-700"
                          }`}
                        >
                          {r.estado === "confirmada" ? "🟢 Confirmada" : "🟡 En viaje"}
                        </span>
                        <span className="text-gray-400">{expandida ? "▴" : "▾"}</span>
                      </div>
                    </button>

                    {expandida && (
                      <div className="border-t border-gray-100 p-3 space-y-2 bg-gray-50">
                        {r.pagos.map((p) => (
                          <div key={p.id} className="flex items-center justify-between text-sm">
                            <div className="min-w-0">
                              <p className="font-medium text-gray-800 truncate">{p.cliente_nombre}</p>
                              <p className="text-gray-400 text-xs">
                                {new Date(p.fecha_pago + "T00:00:00").toLocaleDateString("es-AR")} ·{" "}
                                {p.metodo_resumen}
                              </p>
                            </div>
                            <p className="font-bold text-gray-800 shrink-0 ml-2">{formatCurrency(p.monto)}</p>
                          </div>
                        ))}
                        <div className="border-t border-gray-200 pt-2 text-xs text-gray-500 space-y-0.5">
                          <p>
                            Efectivo: declarado {formatCurrency(r.efectivo_declarado)} · registrado{" "}
                            {formatCurrency(r.efectivo_registrado)}
                          </p>
                          {r.observaciones && <p>Obs: {r.observaciones}</p>}
                          {r.confirmado_at && (
                            <p>
                              Confirmada por oficina el{" "}
                              {new Date(r.confirmado_at).toLocaleString("es-AR", {
                                day: "numeric",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-4 text-center text-gray-500 text-sm">
              Sin rendiciones registradas.
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
