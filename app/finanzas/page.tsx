"use client"

import { useState, useEffect, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend,
  PieChart, Pie, Cell,
} from "recharts"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ArrowLeft, Pencil, TrendingUp, PieChart as PieIcon } from "lucide-react"
import Link from "next/link"

// ─── Estructura de cajas ─────────────────────────────────────────────────────

type CajaKey =
  | "caja_chica" | "caja_grande"
  | "credicoop" | "nacion" | "provincia" | "mercadopago"
  | "acciones" | "fondos_comunes" | "cauciones" | "cedears"

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
  { key: "fondos_comunes", label: "Fondos Comunes", group: "bolsa",  color: "#34d399" },
  { key: "cauciones",      label: "Cauciones",      group: "bolsa",  color: "#059669" },
  { key: "cedears",        label: "CEDEARs",        group: "bolsa",  color: "#047857" },
]

const ALL_KEYS = CAJAS.map(c => c.key)

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

  // Update modal
  const [editCaja, setEditCaja] = useState<CajaDef | null>(null)
  const [editMonto, setEditMonto] = useState("")
  const [editFecha, setEditFecha] = useState(today())
  const [saving, setSaving] = useState(false)

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = async () => {
    setLoading(true)
    const { data } = await sb
      .from("finanzas_saldos")
      .select("id, caja_key, monto, fecha")
      .order("fecha", { ascending: true })
    setSaldos((data || []) as any)
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

  const latestOf = (key: CajaKey) => latestMap[key] ?? 0
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

  // ── Save saldo ────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!editCaja) return
    const monto = parseFloat(editMonto.replace(/\./g, "").replace(",", "."))
    if (isNaN(monto)) return
    setSaving(true)
    await sb.from("finanzas_saldos").insert({ caja_key: editCaja.key, monto, fecha: editFecha })
    await load()
    setSaving(false)
    setEditCaja(null)
    setEditMonto("")
    setEditFecha(today())
  }

  const openEdit = (c: CajaDef) => {
    setEditCaja(c)
    const current = latestOf(c.key)
    setEditMonto(current > 0 ? String(current) : "")
    setEditFecha(today())
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
        <button
          onClick={e => { e.stopPropagation(); openEdit(caja) }}
          className="absolute top-2.5 right-2.5 opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-slate-700"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
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
                No hay datos todavía. Hacé clic en el ícono ✏️ de una caja para ingresar el primer saldo.
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Update saldo modal ── */}
      <Dialog open={!!editCaja} onOpenChange={o => { if (!o) setEditCaja(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <div className="w-3 h-3 rounded-full" style={{ background: editCaja?.color }} />
              Actualizar saldo — {editCaja?.label}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div>
              <Label className="text-xs">Saldo actual</Label>
              <Input
                type="number"
                className="h-10 text-lg font-mono mt-1"
                placeholder="0"
                value={editMonto}
                onChange={e => setEditMonto(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <Label className="text-xs">Fecha del registro</Label>
              <Input
                type="date"
                className="h-9 text-sm mt-1"
                value={editFecha}
                onChange={e => setEditFecha(e.target.value)}
              />
            </div>
            {editMonto && !isNaN(parseFloat(editMonto)) && (
              <p className="text-xs text-slate-500 text-center">
                {fmt(parseFloat(editMonto.replace(/\./g, "").replace(",", ".")))}
              </p>
            )}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setEditCaja(null)}>Cancelar</Button>
              <Button
                className="flex-1"
                style={{ background: editCaja?.color }}
                onClick={handleSave}
                disabled={saving || !editMonto}
              >
                {saving ? "Guardando..." : "Guardar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
