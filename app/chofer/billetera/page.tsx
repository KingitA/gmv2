"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useBackTrap } from "@/lib/vendedor/use-back-trap"
import { formatCurrency } from "@/lib/utils"
import { GastoSheet } from "@/components/chofer/gasto-sheet"

// Billetera del chofer: efectivo en mano (cobros sin rendir + plata a cuenta
// del viaje − gastos) y cheques en mano. Cada cobro muestra cliente y método.

interface Cobro { id: string; fecha: string; cliente: string; viaje: string; monto: number; metodos: string[]; estado: "en_mano" | "en_rendicion" | "rendido" }
interface Gasto { id: string; viaje: string; categoria: string; monto: number; estado: string; observaciones: string | null; created_at: string }
interface Fondo { id: string; viaje: string; monto: number; created_at: string }
interface BilleteraData {
  efectivo: number
  desglose: { cobros_efectivo: number; fondo_viaje: number; gastos: number; cheques_monto: number; transferencias: number; en_rendicion: number }
  cheques_cantidad: number
  saldo_cuenta_corriente: number
  cobros: Cobro[]
  gastos: Gasto[]
  fondos: Fondo[]
}

const ESTADO_COBRO: Record<string, { label: string; cls: string }> = {
  en_mano: { label: "EN MANO", cls: "bg-green-100 text-green-700" },
  en_rendicion: { label: "RENDIDO · ESPERANDO OFICINA", cls: "bg-amber-100 text-amber-700" },
  rendido: { label: "CONFIRMADO", cls: "bg-gray-100 text-gray-500" },
}

const fecha = (v: string) => new Date(v).toLocaleDateString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

export default function BilleteraPage() {
  const router = useRouter()
  const [data, setData] = useState<BilleteraData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<"cobros" | "gastos">("cobros")
  const [gastoAbierto, setGastoAbierto] = useState(false)
  const [viajeActivo, setViajeActivo] = useState<string | null>(null)

  const cargar = () => {
    fetch("/api/chofer/billetera")
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d) })
      .finally(() => setLoading(false))
  }
  useEffect(() => {
    cargar()
    fetch("/api/chofer/me").then((r) => r.json()).then((d) => setViajeActivo(d?.viaje_activo?.id || null)).catch(() => {})
  }, [])

  useBackTrap(() => {
    if (gastoAbierto) { setGastoAbierto(false); return true }
    return false
  })

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    )
  }
  if (!data) return <div className="p-6 text-red-500">No se pudo cargar la billetera.</div>

  const cobrosEnMano = data.cobros.filter((c) => c.estado === "en_mano")
  const otros = data.cobros.filter((c) => c.estado !== "en_mano")

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 bg-blue-700 px-5 py-4 text-white shadow-md">
        <button onClick={() => router.push("/chofer")} className="mb-1 text-sm text-blue-200">← Inicio</button>
        <h1 className="text-xl font-bold">Mi billetera</h1>
      </header>

      <div className="space-y-4 p-4 pb-36">
        <div className="rounded-2xl bg-blue-700 p-5 text-white">
          <p className="text-sm text-blue-200">Efectivo en mano</p>
          <p className="text-4xl font-bold">{formatCurrency(data.efectivo)}</p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div><p className="text-blue-200">Cobros</p><p className="font-bold">{formatCurrency(data.desglose.cobros_efectivo)}</p></div>
            <div><p className="text-blue-200">A cuenta viaje</p><p className="font-bold">{formatCurrency(data.desglose.fondo_viaje)}</p></div>
            <div><p className="text-blue-200">Gastos</p><p className="font-bold text-red-200">−{formatCurrency(data.desglose.gastos)}</p></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 border-t border-blue-500 pt-3 text-sm">
            <span className="rounded-full bg-blue-600 px-3 py-1">🧾 {data.cheques_cantidad} {data.cheques_cantidad === 1 ? "cheque" : "cheques"} en mano · {formatCurrency(data.desglose.cheques_monto)}</span>
            {data.desglose.en_rendicion > 0 && <span className="rounded-full bg-amber-500/80 px-3 py-1">📦 {formatCurrency(data.desglose.en_rendicion)} camino a oficina</span>}
          </div>
          {Math.abs(data.saldo_cuenta_corriente) > 0.01 && (
            <p className={`mt-2 text-sm ${data.saldo_cuenta_corriente < 0 ? "text-red-200" : "text-green-200"}`}>
              {data.saldo_cuenta_corriente < 0 ? `Debés ${formatCurrency(-data.saldo_cuenta_corriente)} de rendiciones anteriores` : `Tenés ${formatCurrency(data.saldo_cuenta_corriente)} a favor de rendiciones anteriores`}
            </p>
          )}
        </div>

        <div className="flex gap-2">
          <button onClick={() => setTab("cobros")} className={`flex-1 rounded-xl py-2 text-sm font-bold ${tab === "cobros" ? "bg-blue-600 text-white" : "border border-gray-200 bg-white text-gray-600"}`}>Cobros</button>
          <button onClick={() => setTab("gastos")} className={`flex-1 rounded-xl py-2 text-sm font-bold ${tab === "gastos" ? "bg-blue-600 text-white" : "border border-gray-200 bg-white text-gray-600"}`}>Gastos y plata recibida</button>
        </div>

        {tab === "cobros" ? (
          <div className="space-y-2">
            {data.cobros.length === 0 && <p className="py-8 text-center text-gray-400">Sin cobros todavía.</p>}
            {[...cobrosEnMano, ...otros].map((c) => {
              const est = ESTADO_COBRO[c.estado]
              return (
                <div key={c.id} className={`rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm ${c.estado === "rendido" ? "opacity-60" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-gray-800">{c.cliente}</p>
                      <p className="text-xs text-gray-500">{c.metodos.join(" + ") || "Efectivo"}{c.viaje ? ` · ${c.viaje}` : ""}</p>
                      <p className="text-xs text-gray-400">{fecha(c.fecha)}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-lg font-bold text-green-600">{formatCurrency(c.monto)}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${est.cls}`}>{est.label}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="space-y-2">
            {data.fondos.map((f) => (
              <div key={f.id} className="flex items-center justify-between rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
                <div><p className="text-sm font-bold text-gray-800">A cuenta viaje {f.viaje}</p><p className="text-xs text-gray-400">{fecha(f.created_at)}</p></div>
                <p className="text-lg font-bold text-blue-600">+{formatCurrency(f.monto)}</p>
              </div>
            ))}
            {data.gastos.map((g) => (
              <div key={g.id} className="flex items-center justify-between rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
                <div className="min-w-0">
                  <p className="text-sm font-bold capitalize text-gray-800">{g.categoria}{g.observaciones ? <span className="font-normal text-gray-500"> · {g.observaciones}</span> : null}</p>
                  <p className="text-xs text-gray-400">{g.viaje} · {fecha(g.created_at)} · {g.estado === "aprobado" ? "aprobado" : "a revisar en oficina"}</p>
                </div>
                <p className="text-lg font-bold text-red-500">−{formatCurrency(g.monto)}</p>
              </div>
            ))}
            {data.fondos.length === 0 && data.gastos.length === 0 && <p className="py-8 text-center text-gray-400">Sin gastos ni plata recibida.</p>}
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 border-t border-gray-200 bg-white p-4 shadow-lg">
        <button onClick={() => setGastoAbierto(true)} className="w-full rounded-2xl bg-red-500 py-4 text-lg font-bold text-white active:scale-95 transition-transform">
          💸 Cargar un gasto
        </button>
      </div>

      {gastoAbierto && <GastoSheet viajeId={viajeActivo} onClose={() => setGastoAbierto(false)} onGuardado={cargar} />}
    </div>
  )
}
