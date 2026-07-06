"use client"

import { useState, useEffect, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend,
  PieChart, Pie, Cell,
} from "recharts"
import { ArrowLeft, TrendingUp, PieChart as PieIcon } from "lucide-react"
import Link from "next/link"

// ─── Estructura de cajas ─────────────────────────────────────────────────────

type CajaKey =
  | "caja_chica" | "caja_grande"
  | "credicoop" | "nacion" | "provincia" | "mercadopago"
  | "acciones" | "fondos_comunes" | "cauciones" | "cedears" | "obligaciones"

type GroupKey = "bancos" | "bolsa"

interface CajaDef {
  key: CajaKey
  label: string
  group: GroupKey | null
  color: string
}

const GROUPS: Record<GroupKey, { label: string; color: string }> = {
  bancos: { label: "Bancos",  color: "#6366f1" },
  bolsa:  { label: "Bolsa",   color: "#10b981" },
}

const CAJAS: CajaDef[] = [
  { key: "caja_chica",     label: "Caja Chica",     group: null,     color: "#f59e0b" },
  { key: "caja_grande",    label: "Caja Grande",    group: null,     color: "#ef4444" },
  { key: "credicoop",      label: "Credicoop",      group: "bancos", color: "#6366f1" },
  { key: "nacion",         label: "Nación",         group: "bancos", color: "#818cf8" },
  { key: "provincia",      label: "Provincia",      group: "bancos", color: "#a5b4fc" },
  { key: "mercadopago",    label: "Mercado Pago",   group: "bancos", color: "#4338ca" },
  { key: "acciones",       label: "Acciones",       group: "bolsa",  color: "#10b981" },
  { key: "fondos_comunes", label: "FCI",            group: "bolsa",  color: "#34d399" },
  { key: "cauciones",      label: "Cauciones",      group: "bolsa",  color: "#059669" },
  { key: "cedears",        label: "CEDEARs",        group: "bolsa",  color: "#047857" },
  { key: "obligaciones",   label: "Obl. Negoc.",    group: "bolsa",  color: "#065f46" },
]

const ALL_KEYS = CAJAS.map(c => c.key)

// Mapeo caja_key legacy → nombre de cuenta en el sistema de cajas (Fase B).
// El valor VIGENTE se lee de saldos_financieros (derivado del kardex);
// finanzas_saldos queda solo como serie histórica para los gráficos.
const LIVE_NOMBRE: Partial<Record<CajaKey, string>> = {
  caja_chica: "Caja Chica",
  caja_grande: "Caja Grande",
  credicoop: "Credicoop",
  nacion: "Nación",
  provincia: "Provincia",
  mercadopago: "MercadoPago",
  acciones: "Bolsa - Acciones",
  fondos_comunes: "Bolsa - FCI",
  cedears: "Bolsa - CEDEARs",
  obligaciones: "Bolsa - Obligaciones Negociables",
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 })

const fmtShort = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

const today = () => new Date().toISOString().slice(0, 10)

// ─── Component ───────────────────────────────────────────────────────────────

export default function FinanzasPage() {
  const sb = createClient()

  // All saldo records from DB
  const [saldos, setSaldos] = useState<Array<{ id: string; caja_key: string; monto: number; fecha: string }>>([])
  const [loading, setLoading] = useState(true)

  // Which cajas are selected for charts (default: all)
  const [selected, setSelected] = useState<Set<CajaKey>>(new Set(ALL_KEYS))

  // Saldos vigentes del sistema de cajas (kardex → saldos_financieros)
  const [liveMap, setLiveMap] = useState<Record<string, number>>({})

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = async () => {
    setLoading(true)
    const [{ data }, liveRes] = await Promise.all([
      sb.from("finanzas_saldos").select("id, caja_key, monto, fecha").order("fecha", { ascending: true }),
      fetch("/api/finanzas/cajas").then(r => r.json()).catch(() => ({ cuentas: [] })),
    ])
    setSaldos((data || []) as any)
    const live: Record<string, number> = {}
    for (const c of liveRes.cuentas || []) {
      live[c.nombre] = Number(c.saldos?.BLANCO ?? 0) + Number(c.saldos?.NEGRO ?? 0)
    }
    setLiveMap(live)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // ── Derived data ─────────────────────────────────────────────────────────

  // Latest balance per caja_key
  const latestMap = useMemo(() => {
    const m: Record<string, number> = {}
    for (const s of saldos) {
      m[s.caja_key] = s.monto   // sorted asc so last write wins
    }
    return m
  }, [saldos])

  // Saldo vigente: sistema de cajas (kardex) si la cuenta existe; si no,
  // último snapshot histórico (ej. cauciones, aún sin cuenta mapeada).
  const latestOf = (key: CajaKey) => {
    const nombre = LIVE_NOMBRE[key]
    if (nombre && nombre in liveMap) return liveMap[nombre]
    return latestMap[key] ?? 0
  }
  const groupTotal = (g: GroupKey) =>
    CAJAS.filter(c => c.group === g).reduce((s, c) => s + latestOf(c.key), 0)
  const grandTotal = CAJAS.reduce((s, c) => s + latestOf(c.key), 0)

  // Selected subset
  const selectedList = CAJAS.filter(c => selected.has(c.key))
  const selectedTotal = selectedList.reduce((s, c) => s + latestOf(c.key), 0)

  // ── Line chart data ───────────────────────────────────────────────────────
  // Build a sorted list of unique dates present in selected cajas
  const lineData = useMemo(() => {
    const relevantKeys = [...selected]
    const dateSet = new Set<string>()
    for (const s of saldos) {
      if (relevantKeys.includes(s.caja_key as CajaKey)) dateSet.add(s.fecha)
    }
    const dates = [...dateSet].sort()

    // For each date, carry-forward the last known value per caja
    const running: Record<string, number> = {}
    return dates.map(date => {
      const row: Record<string, any> = { date }
      for (const s of saldos.filter(x => x.fecha === date && relevantKeys.includes(x.caja_key as CajaKey))) {
        running[s.caja_key] = s.monto
      }
      for (const key of relevantKeys) {
        row[key] = running[key] ?? null
      }
      return row
    })
  }, [saldos, selected])

  // ── Pie chart data ────────────────────────────────────────────────────────
  const pieData = useMemo(() =>
    selectedList
      .map(c => ({ name: c.label, value: latestOf(c.key), color: c.color }))
      .filter(d => d.value > 0),
    [selectedList, latestMap]
  )

  // ── Selection handlers ────────────────────────────────────────────────────
  const toggleCaja = (key: CajaKey) => {
    setSelected(prev => {
      const n = new Set(prev)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    })
  }

  const toggleGroup = (g: GroupKey) => {
    const keys = CAJAS.filter(c => c.group === g).map(c => c.key)
    const allOn = keys.every(k => selected.has(k))
    setSelected(prev => {
      const n = new Set(prev)
      keys.forEach(k => allOn ? n.delete(k) : n.add(k))
      return n
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const CajaCard = ({ caja }: { caja: CajaDef }) => {
    const val  = latestOf(caja.key)
    const isSel = selected.has(caja.key)
    return (
      <div
        onClick={() => toggleCaja(caja.key)}
        className={`relative rounded-2xl border-2 p-4 cursor-pointer transition-all select-none group ${
          isSel
            ? "shadow-lg scale-[1.02]"
            : "border-slate-200 bg-white opacity-60 hover:opacity-80"
        }`}
        style={isSel ? { borderColor: caja.color, background: `${caja.color}10` } : {}}
      >
        <div className="flex items-center gap-2 mb-2">
          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: caja.color }} />
          <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide truncate">{caja.label}</span>
        </div>
        <div className="text-xl font-bold text-slate-800 leading-tight" style={isSel ? { color: caja.color } : {}}>
          {loading ? "—" : fmtShort(val)}
        </div>
        <div className="text-xs text-slate-400 mt-0.5">{loading ? "" : fmt(val)}</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Header ── */}
      <div className="bg-white border-b px-6 py-4 flex items-center gap-4 shadow-sm sticky top-0 z-10">
        <Link href="/">
          <button className="text-slate-400 hover:text-slate-700 transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </button>
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-slate-800">Finanzas</h1>
          <p className="text-xs text-slate-400">Patrimonio total: <span className="font-semibold text-slate-700">{fmt(grandTotal)}</span></p>
        </div>
        <Link href="/finanzas/cajas">
          <button className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 border border-indigo-200 rounded-lg px-3 py-1.5 transition-colors">
            Operar cajas →
          </button>
        </Link>
        <div className="text-right">
          <div className="text-xs text-slate-400">Seleccionado</div>
          <div className="text-base font-bold text-indigo-600">{fmt(selectedTotal)}</div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-8">

        {/* ── Standalone cajas ── */}
        <div className="grid grid-cols-2 gap-4">
          {CAJAS.filter(c => !c.group).map(c => <CajaCard key={c.key} caja={c} />)}
        </div>

        {/* ── Groups ── */}
        {(["bancos", "bolsa"] as GroupKey[]).map(g => {
          const gDef = GROUPS[g]
          const gCajas = CAJAS.filter(c => c.group === g)
          const gTotal = groupTotal(g)
          const allSel = gCajas.every(c => selected.has(c.key))
          return (
            <div key={g}>
              <div
                className="flex items-center justify-between mb-3 cursor-pointer select-none"
                onClick={() => toggleGroup(g)}
              >
                <div className="flex items-center gap-2">
                  <div className={`px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wide transition-all ${
                    allSel ? "text-white" : "text-slate-500 bg-slate-100"
                  }`} style={allSel ? { background: gDef.color } : {}}>
                    {gDef.label}
                  </div>
                  <span className="text-sm font-semibold text-slate-600">{fmt(gTotal)}</span>
                </div>
                <span className="text-xs text-slate-400">{allSel ? "Deseleccionar todo" : "Seleccionar todo"}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {gCajas.map(c => <CajaCard key={c.key} caja={c} />)}
              </div>
            </div>
          )
        })}

        {/* ── Charts ── */}
        {selected.size > 0 && !loading && (
          <div className="space-y-6">

            {/* Line chart */}
            {lineData.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <TrendingUp className="h-4 w-4 text-indigo-500" />
                  <h2 className="text-sm font-bold text-slate-700">Evolución de saldos</h2>
                </div>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={lineData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      tickFormatter={d => {
                        const [y, m, day] = d.split("-")
                        return `${day}/${m}/${y.slice(2)}`
                      }}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={fmtShort}
                      width={60}
                    />
                    <Tooltip
                      formatter={(val: number, name: string) => {
                        const caja = CAJAS.find(c => c.key === name)
                        return [fmt(val), caja?.label || name]
                      }}
                      labelFormatter={d => {
                        const [y, m, day] = d.split("-")
                        return `${day}/${m}/${y}`
                      }}
                    />
                    <Legend
                      formatter={name => CAJAS.find(c => c.key === name)?.label || name}
                      wrapperStyle={{ fontSize: 11 }}
                    />
                    {selectedList.map(c => (
                      <Line
                        key={c.key}
                        type="monotone"
                        dataKey={c.key}
                        stroke={c.color}
                        strokeWidth={2}
                        dot={{ r: 4, fill: c.color }}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Pie chart */}
            {pieData.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <PieIcon className="h-4 w-4 text-indigo-500" />
                  <h2 className="text-sm font-bold text-slate-700">Distribución actual</h2>
                </div>
                <div className="flex flex-col sm:flex-row items-center gap-6">
                  <ResponsiveContainer width={260} height={260}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={65}
                        outerRadius={110}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {pieData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(val: number) => fmt(val)} />
                    </PieChart>
                  </ResponsiveContainer>

                  {/* Legend */}
                  <div className="flex-1 space-y-2">
                    {pieData
                      .slice()
                      .sort((a, b) => b.value - a.value)
                      .map(d => {
                        const pct = selectedTotal > 0 ? (d.value / selectedTotal * 100).toFixed(1) : "0"
                        return (
                          <div key={d.name} className="flex items-center gap-3">
                            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: d.color }} />
                            <span className="text-xs text-slate-600 flex-1 truncate">{d.name}</span>
                            <span className="text-xs font-mono font-semibold text-slate-700">{fmtShort(d.value)}</span>
                            <span className="text-xs text-slate-400 w-12 text-right">{pct}%</span>
                          </div>
                        )
                      })}
                    <div className="border-t pt-2 mt-1 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-600">Total</span>
                      <span className="text-xs font-bold text-slate-800">{fmt(selectedTotal)}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {lineData.length === 0 && pieData.length === 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-400 text-sm shadow-sm">
                Sin serie histórica todavía. Los saldos vigentes se operan desde &quot;Operar cajas&quot;.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
