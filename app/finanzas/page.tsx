"use client"

import { useState, useEffect, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend,
} from "recharts"
import { ArrowLeft, Pencil, FileSpreadsheet, TrendingUp, ChevronDown, ChevronRight } from "lucide-react"
import Link from "next/link"
import { CalendarioPagos } from "@/components/finanzas/calendario-pagos"
import { AjustarSaldoDialog, type CuentaAjustable } from "@/components/finanzas/ajustar-saldo-dialog"
import { ActualizarSaldosDialog } from "@/components/finanzas/actualizar-saldos-dialog"
import { ImportChequesDialog } from "@/components/finanzas/import-cheques-dialog"
import { ChequesEmitidosPanel, type ChequeEmitido } from "@/components/finanzas/cheques-emitidos-panel"
import { VencimientoEditDialog, type VencimientoEditable } from "@/components/finanzas/vencimiento-edit-dialog"
import { FechaInput } from "@/components/finanzas/fecha-input"
import { todayArgentina } from "@/lib/utils"

// ─── Estructura de cajas ─────────────────────────────────────────────────────

type CajaKey =
  | "caja_chica" | "caja_grande"
  | "credicoop" | "nacion" | "provincia" | "mercadopago"
  | "acciones" | "fondos_comunes" | "cauciones" | "cedears" | "obligaciones"

type GroupKey = "efectivo" | "bancos" | "bolsa"

interface CajaDef {
  key: CajaKey
  label: string
  group: GroupKey
  color: string
}

const CAJAS: CajaDef[] = [
  { key: "caja_chica",     label: "Caja Chica",     group: "efectivo", color: "#f59e0b" },
  { key: "caja_grande",    label: "Caja Grande",    group: "efectivo", color: "#ef4444" },
  { key: "credicoop",      label: "Credicoop",      group: "bancos",   color: "#6366f1" },
  { key: "nacion",         label: "Nación",         group: "bancos",   color: "#818cf8" },
  { key: "provincia",      label: "Provincia",      group: "bancos",   color: "#a5b4fc" },
  { key: "mercadopago",    label: "Mercado Pago",   group: "bancos",   color: "#4338ca" },
  { key: "fondos_comunes", label: "FCI",            group: "bolsa",    color: "#10b981" },
  { key: "cauciones",      label: "Cauciones",      group: "bolsa",    color: "#059669" },
  { key: "acciones",       label: "Acciones",       group: "bolsa",    color: "#34d399" },
  { key: "cedears",        label: "CEDEARs",        group: "bolsa",    color: "#047857" },
  { key: "obligaciones",   label: "Obl. Negoc.",    group: "bolsa",    color: "#065f46" },
]

const ALL_KEYS = CAJAS.map(c => c.key)

// Mapeo caja_key legacy → nombre de cuenta en el sistema de cajas (kardex).
const LIVE_NOMBRE: Partial<Record<CajaKey, string>> = {
  caja_chica: "Caja Chica",
  caja_grande: "Caja Grande",
  credicoop: "Credicoop",
  nacion: "Nación",
  provincia: "Provincia",
  mercadopago: "MercadoPago",
  acciones: "Bolsa - Acciones",
  fondos_comunes: "Bolsa - FCI",
  cauciones: "Bolsa - Cauciones",
  cedears: "Bolsa - CEDEARs",
  obligaciones: "Bolsa - Obligaciones Negociables",
}

type Cartera = "BLANCO" | "NEGRO" | "ECHEQ"
const CARTERA_DEF: Record<Cartera, { label: string; dot: string }> = {
  BLANCO: { label: "Blanco", dot: "#e2e8f0" },
  NEGRO: { label: "Negro", dot: "#1f2937" },
  ECHEQ: { label: "Echeq", dot: "#8b5cf6" },
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 2 })
const fmtShort = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}
const today = () => todayArgentina()
const addDias = (iso: string, dias: number) => {
  const d = new Date(iso + "T00:00:00")
  d.setDate(d.getDate() + dias)
  return d.toISOString().slice(0, 10)
}
const fmtDiaCorto = (iso: string) => {
  const d = new Date(iso + "T12:00:00Z")
  const dia = d.toLocaleDateString("es-AR", { weekday: "short", timeZone: "UTC" }).replace(".", "").toUpperCase()
  return `${dia} ${String(d.getUTCDate()).padStart(2, "0")}`
}
const fmtFechaAR = (iso: string) => {
  const [y, m, d] = iso.split("-")
  return `${d}-${m}-${y}`
}
const NUM: React.CSSProperties = { fontFamily: "Bahnschrift, 'Segoe UI Variable Display', 'Segoe UI', sans-serif", fontVariantNumeric: "tabular-nums" }

const MEDIO_BADGE: Record<string, { label: string; cls: string }> = {
  transferencia: { label: "TRANSFERENCIA", cls: "bg-sky-100 text-sky-800" },
  cheque: { label: "CHEQUE", cls: "bg-amber-100 text-amber-800" },
  efectivo: { label: "EFECTIVO", cls: "bg-emerald-100 text-emerald-800" },
  debito: { label: "DÉBITO ECHEQ", cls: "bg-slate-100 text-slate-600" },
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function FinanzasPage() {
  const sb = createClient()

  const [loading, setLoading] = useState(true)
  const [saldos, setSaldos] = useState<Array<{ caja_key: string; monto: number; fecha: string }>>([])
  const [liveMap, setLiveMap] = useState<Record<string, number>>({})
  const [cuentas, setCuentas] = useState<(CuentaAjustable & { updated_at?: string | null })[]>([])
  const [cheques, setCheques] = useState<Array<{ id: string; numero: string; monto: number; fecha_vencimiento: string; color: string; es_echeq: boolean }>>([])
  const [depositados, setDepositados] = useState<Array<{ monto: number }>>([])
  const [vencs, setVencs] = useState<any[]>([])
  const [emitidos, setEmitidos] = useState<ChequeEmitido[]>([])
  const [evolucion, setEvolucion] = useState<{ serie: any[]; cuentas: string[] }>({ serie: [], cuentas: [] })

  // Selección
  const [selected, setSelected] = useState<Set<CajaKey>>(new Set(ALL_KEYS.filter(k => CAJAS.find(c => c.key === k)!.group !== "bolsa")))
  const [carterasSel, setCarterasSel] = useState<Set<Cartera>>(new Set(["BLANCO", "NEGRO", "ECHEQ"]))

  // Matriz
  const [dispoDias, setDispoDias] = useState<7 | 15 | 30 | 0>(15)
  const [dispoFecha, setDispoFecha] = useState(addDias(today(), 15))

  // Pagos
  const [horizonte, setHorizonte] = useState<30 | 60 | 90 | 0>(30)
  const [mesesAbiertos, setMesesAbiertos] = useState<Set<string>>(new Set())
  const [vencEdit, setVencEdit] = useState<VencimientoEditable | null>(null)

  // Secciones plegables / diálogos
  const [showCalendario, setShowCalendario] = useState(false)
  const [showEvolucion, setShowEvolucion] = useState(false)
  const [cuentaEdit, setCuentaEdit] = useState<CuentaAjustable | null>(null)
  const [saldosDiaOpen, setSaldosDiaOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importCartera, setImportCartera] = useState<"AUTO" | Cartera>("AUTO")
  const [calKey, setCalKey] = useState(0)

  const load = async () => {
    setLoading(true)
    const [{ data }, liveRes, chequesRes, depRes, vencsRes, emitidosRes, evoRes] = await Promise.all([
      sb.from("finanzas_saldos").select("caja_key, monto, fecha").order("fecha", { ascending: true }),
      fetch("/api/finanzas/cajas").then(r => r.json()).catch(() => ({ cuentas: [] })),
      fetch("/api/cheques?estado=EN_CARTERA&tipo=TERCERO").then(r => r.json()).catch(() => ({ cheques: [] })),
      fetch("/api/cheques?estado=DEPOSITADO&tipo=TERCERO").then(r => r.json()).catch(() => ({ cheques: [] })),
      fetch("/api/vencimientos?estado=pendiente").then(r => r.json()).catch(() => []),
      fetch("/api/cheques?estado=ENTREGADO_A_PROVEEDOR&tipo=PROPIO").then(r => r.json()).catch(() => ({ cheques: [] })),
      fetch("/api/finanzas/evolucion").then(r => r.json()).catch(() => ({ serie: [], cuentas: [] })),
    ])
    setSaldos((data || []) as any)
    const live: Record<string, number> = {}
    for (const c of liveRes.cuentas || []) {
      live[c.nombre] = Number(c.saldos?.BLANCO ?? 0) + Number(c.saldos?.NEGRO ?? 0)
    }
    setLiveMap(live)
    setCuentas((liveRes.cuentas || []).filter((c: any) => c.cuenta_tipo !== "BILLETERA"))
    setCheques(chequesRes.cheques || [])
    setDepositados(depRes.cheques || [])
    setVencs(Array.isArray(vencsRes) ? vencsRes : [])
    setEmitidos(emitidosRes.cheques || [])
    setEvolucion(evoRes.serie ? evoRes : { serie: [], cuentas: [] })
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const reloadAll = () => { load(); setCalKey(k => k + 1) }

  // ── Saldos por cuenta ──────────────────────────────────────────────────────
  const latestMap = useMemo(() => {
    const m: Record<string, number> = {}
    for (const s of saldos) m[s.caja_key] = s.monto
    return m
  }, [saldos])

  const latestOf = (key: CajaKey) => {
    const nombre = LIVE_NOMBRE[key]
    if (nombre && nombre in liveMap) return liveMap[nombre]
    return latestMap[key] ?? 0
  }
  const cuentaLive = (key: CajaKey): (CuentaAjustable & { updated_at?: string | null }) | null => {
    const nombre = LIVE_NOMBRE[key]
    if (!nombre) return null
    return cuentas.find(c => c.nombre === nombre) ?? null
  }

  const sumGroup = (g: GroupKey, soloSeleccionadas = false) =>
    CAJAS.filter(c => c.group === g && (!soloSeleccionadas || selected.has(c.key)))
      .reduce((s, c) => s + latestOf(c.key), 0)

  const efectivoSel = sumGroup("efectivo", true)
  const bancosSel = sumGroup("bancos", true)
  const bolsaTotal = sumGroup("bolsa")
  const grandTotal = CAJAS.reduce((s, c) => s + latestOf(c.key), 0)

  // ── Cheques por cartera ────────────────────────────────────────────────────
  const carteraDe = (c: { color: string; es_echeq: boolean }): Cartera =>
    c.es_echeq ? "ECHEQ" : c.color === "NEGRO" ? "NEGRO" : "BLANCO"
  const carteras = useMemo(() => {
    const m: Record<Cartera, { total: number; count: number }> = {
      BLANCO: { total: 0, count: 0 }, NEGRO: { total: 0, count: 0 }, ECHEQ: { total: 0, count: 0 },
    }
    for (const c of cheques) {
      const k = carteraDe(c)
      m[k].total += Number(c.monto)
      m[k].count++
    }
    return m
  }, [cheques])
  const chequesSel = useMemo(() => cheques.filter(c => carterasSel.has(carteraDe(c))), [cheques, carterasSel])
  const chequesSelTotal = chequesSel.reduce((s, c) => s + Number(c.monto), 0)
  const cobrablesHoy = chequesSel.filter(c => c.fecha_vencimiento <= today()).reduce((s, c) => s + Number(c.monto), 0)

  // ── Emitidos (propios) comprometidos ──────────────────────────────────────
  const emitidosHasta = (fecha: string) =>
    emitidos
      .filter(c => c.fecha_vencimiento <= fecha && addDias(c.fecha_vencimiento, 30) >= today())
      .reduce((s, c) => s + Number(c.monto), 0)

  // ── Matriz de liquidez ─────────────────────────────────────────────────────
  const setDias = (d: 7 | 15 | 30) => { setDispoDias(d); setDispoFecha(addDias(today(), d)) }
  const vencsHasta = vencs.filter(v => v.fecha_vencimiento <= dispoFecha)
  const salePorForma = (formas: string[]) =>
    vencsHasta.filter(v => formas.includes(v.forma_pago || "transferencia")).reduce((s, v) => s + Number(v.monto), 0)

  const saleEfectivo = salePorForma(["efectivo"])
  const saleBancos = salePorForma(["transferencia"]) + emitidosHasta(dispoFecha)
  const saleCheques = salePorForma(["cheque"])
  const entraBancos = depositados.reduce((s, c) => s + Number(c.monto), 0)
  const cobrablesHasta = chequesSel.filter(c => c.fecha_vencimiento <= dispoFecha).reduce((s, c) => s + Number(c.monto), 0)

  const quedaEfectivo = efectivoSel - saleEfectivo
  const quedaBancos = bancosSel + entraBancos - saleBancos
  const quedaCheques = chequesSelTotal - saleCheques

  const sale30 = vencs.filter(v => v.fecha_vencimiento <= addDias(today(), 30)).reduce((s, v) => s + Number(v.monto), 0)
    + emitidosHasta(addDias(today(), 30))

  const proxEfectivo = vencsHasta.filter(v => (v.forma_pago || "") === "efectivo").sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento))[0]

  // ── Lista de pagos ─────────────────────────────────────────────────────────
  const hoy = today()
  const finSemana = useMemo(() => {
    const d = new Date(hoy + "T00:00:00")
    const dow = d.getDay() === 0 ? 7 : d.getDay()
    return addDias(hoy, 7 - dow)
  }, [hoy])
  const finProxSemana = addDias(finSemana, 7)
  const limiteHorizonte = horizonte === 0 ? "9999-12-31" : addDias(hoy, horizonte)

  type ItemPago = { tipo: "venc" | "emitido"; fecha: string; venc?: any; emitido?: ChequeEmitido }
  const items: ItemPago[] = useMemo(() => {
    const arr: ItemPago[] = [
      ...vencs.map(v => ({ tipo: "venc" as const, fecha: v.fecha_vencimiento, venc: v })),
      ...emitidos
        .filter(c => addDias(c.fecha_vencimiento, 30) >= hoy)
        .map(c => ({ tipo: "emitido" as const, fecha: c.fecha_vencimiento, emitido: c })),
    ]
    return arr.filter(i => i.fecha <= limiteHorizonte).sort((a, b) => a.fecha.localeCompare(b.fecha))
  }, [vencs, emitidos, limiteHorizonte, hoy])

  const grupos = useMemo(() => {
    const semana: ItemPago[] = []
    const proxima: ItemPago[] = []
    const porMes = new Map<string, ItemPago[]>()
    for (const i of items) {
      if (i.fecha <= finSemana) semana.push(i)
      else if (i.fecha <= finProxSemana) proxima.push(i)
      else {
        const mes = i.fecha.slice(0, 7)
        if (!porMes.has(mes)) porMes.set(mes, [])
        porMes.get(mes)!.push(i)
      }
    }
    return { semana, proxima, meses: [...porMes.entries()].sort() }
  }, [items, finSemana, finProxSemana])

  const nombreMes = (ym: string) => {
    const [y, m] = ym.split("-")
    const nombres = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
    return `${nombres[parseInt(m) - 1]} ${y}`
  }
  const montoDe = (i: ItemPago) => Number(i.tipo === "venc" ? i.venc.monto : i.emitido!.monto)

  // ── Evolución (kardex) ────────────────────────────────────────────────────
  const colorDeCuenta = (nombre: string) => {
    const key = (Object.entries(LIVE_NOMBRE) as [CajaKey, string][]).find(([, n]) => n === nombre)?.[0]
    return CAJAS.find(c => c.key === key)?.color ?? "#94a3b8"
  }

  const ultimaAct = useMemo(() => {
    const fechas = cuentas.map(c => c.updated_at).filter(Boolean).sort() as string[]
    if (!fechas.length) return null
    const d = new Date(fechas[fechas.length - 1])
    const dia = d.toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" })
    const hora = d.toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit" })
    return dia === hoy ? `hoy ${hora}` : `${fmtFechaAR(dia)} ${hora}`
  }, [cuentas, hoy])

  // ── Sub-componentes ────────────────────────────────────────────────────────

  const Ficha = ({ caja }: { caja: CajaDef }) => {
    const val = latestOf(caja.key)
    const isSel = selected.has(caja.key)
    const editable = cuentaLive(caja.key)
    return (
      <button
        onClick={() => setSelected(prev => { const n = new Set(prev); n.has(caja.key) ? n.delete(caja.key) : n.add(caja.key); return n })}
        className={`inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm shadow-sm transition-all ${
          isSel ? "border-indigo-500 ring-1 ring-indigo-500" : "border-slate-200 opacity-70 hover:opacity-100"
        }`}
      >
        <span className={`flex h-4 w-4 items-center justify-center rounded border-2 text-[10px] ${isSel ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300"}`}>
          {isSel ? "✓" : ""}
        </span>
        <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: caja.color }} />
        <span className="text-slate-600">{caja.label}</span>
        <span className="font-semibold text-slate-800" style={NUM}>{loading ? "—" : fmt(val)}</span>
        {editable && (
          <span
            role="button"
            title="Actualizar saldo"
            onClick={(e) => { e.stopPropagation(); setCuentaEdit(editable) }}
            className="text-slate-300 hover:text-slate-600"
          >
            <Pencil className="h-3 w-3" />
          </span>
        )}
      </button>
    )
  }

  const PagoRow = ({ item }: { item: ItemPago }) => {
    if (item.tipo === "emitido") {
      const c = item.emitido!
      return (
        <div className="flex items-center gap-3 px-2 py-2.5 text-[15px] border-t border-slate-100 first:border-t-0">
          <span className="w-14 shrink-0 text-xs font-semibold text-slate-400">{fmtDiaCorto(item.fecha)}</span>
          <span className="flex-1 font-medium text-slate-700">
            Cheque propio #{c.numero}
            <span className="ml-2 text-xs text-slate-400 font-normal">pueden debitarlo desde este día</span>
          </span>
          <span className={`rounded-md px-2 py-0.5 text-[10.5px] font-bold tracking-wide ${MEDIO_BADGE.debito.cls}`}>{MEDIO_BADGE.debito.label}</span>
          <span className="font-semibold text-slate-800" style={NUM}>{fmt(Number(c.monto))}</span>
          <span className="w-3" />
        </div>
      )
    }
    const v = item.venc
    const medio = MEDIO_BADGE[v.forma_pago || "transferencia"] ?? MEDIO_BADGE.transferencia
    return (
      <div
        onClick={() => setVencEdit(v)}
        className="flex items-center gap-3 px-2 py-2.5 text-[15px] border-t border-slate-100 first:border-t-0 cursor-pointer rounded-lg hover:bg-indigo-50/60"
        title="Tocá para editar este pago"
      >
        <span className="w-14 shrink-0 text-xs font-semibold text-slate-400">{fmtDiaCorto(item.fecha)}</span>
        <span className="flex-1 font-medium text-slate-700 truncate">
          {v.proveedores?.nombre || v.concepto || "Pago"}
          {v.modalidad === "entrega" && <span className="ml-2 text-xs text-slate-400 font-normal">lo retiran por caja</span>}
          {v.descuentos_aplicados === false && <span className="ml-2 text-xs font-bold text-red-600">⚠ sin descuentos aplicados</span>}
        </span>
        <span className={`rounded-md px-2 py-0.5 text-[10.5px] font-bold tracking-wide ${medio.cls}`}>{medio.label}</span>
        <span className="font-semibold text-slate-800" style={NUM}>{fmt(Number(v.monto))}</span>
        <ChevronRight className="h-4 w-4 text-slate-300" />
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">

      {/* ── Header ── */}
      <div className="bg-white border-b px-6 py-3 shadow-sm sticky top-0 z-10">
        <div className="flex items-center gap-4 flex-wrap">
          <Link href="/">
            <button className="text-slate-400 hover:text-slate-700 transition-colors"><ArrowLeft className="h-5 w-5" /></button>
          </Link>
          <h1 className="text-lg font-bold text-slate-800 tracking-wide" style={{ fontFamily: "Bahnschrift, 'Segoe UI', sans-serif" }}>FINANZAS</h1>
          <div className="flex items-center gap-2 flex-wrap">
            {[
              { href: "/finanzas/tablero", label: "Tablero" },
              { href: "/finanzas/cierres", label: "Cierre de caja" },
              { href: "/finanzas/cajas", label: "Operar cajas" },
              { href: "/finanzas/pendiente-rendir", label: "Rendiciones" },
              { href: "/finanzas/conciliacion", label: "Conciliación" },
              { href: "/finanzas/cheques", label: "Cheques" },
              { href: "/finanzas/egresos", label: "Egresos" },
            ].map((l) => (
              <Link key={l.href} href={l.href}>
                <button className="text-xs font-semibold text-slate-600 hover:text-indigo-700 border border-slate-200 hover:border-indigo-300 bg-white rounded-full px-3.5 py-1.5 transition-colors shadow-sm">
                  {l.label}
                </button>
              </Link>
            ))}
          </div>
          <div className="ml-auto text-right">
            <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">Patrimonio total</div>
            <div className="text-base font-bold text-slate-800" style={NUM}>{fmt(grandTotal + chequesSelTotal)}</div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-5 space-y-5">

        {/* ── Modo manual ── */}
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 flex-wrap">
          <span>✍️</span>
          <span>
            <b>Saldos cargados a mano</b>
            {ultimaAct ? <> — última actualización: {ultimaAct}.</> : "."} Cuando conectemos las APIs bancarias esto se actualiza solo.
          </span>
          <button
            onClick={() => setSaldosDiaOpen(true)}
            className="ml-auto rounded-lg bg-amber-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-amber-700 transition-colors"
          >
            Actualizar saldos de hoy
          </button>
        </div>

        {/* ── HOY: 4 números ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-2xl bg-slate-800 p-4 shadow">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">Disponible ya · efectivo y bancos</div>
            <div className="text-[26px] font-semibold text-white leading-tight mt-0.5" style={NUM}>{loading ? "—" : fmt(efectivoSel + bancosSel)}</div>
            <div className="text-xs text-slate-400 mt-0.5" style={NUM}>Efectivo {fmt(efectivoSel)} · Bancos {fmt(bancosSel)}</div>
          </div>
          <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">Cheques en cartera · por cobrar</div>
            <div className="text-[26px] font-semibold text-slate-800 leading-tight mt-0.5" style={NUM}>{loading ? "—" : fmt(chequesSelTotal)}</div>
            <div className="text-xs text-slate-400 mt-0.5" style={NUM}>{chequesSel.length} cheques · {fmt(cobrablesHoy)} ya cobrables</div>
          </div>
          <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">Sale en los próximos 30 días</div>
            <div className="text-[26px] font-semibold text-red-700 leading-tight mt-0.5" style={NUM}>{loading ? "—" : fmt(sale30)}</div>
            <div className="text-xs text-slate-400 mt-0.5">{vencs.filter(v => v.fecha_vencimiento <= addDias(hoy, 30)).length} pagos pendientes</div>
          </div>
          <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">En la bolsa · rescate en 24-48 h</div>
            <div className="text-[26px] font-semibold text-slate-800 leading-tight mt-0.5" style={NUM}>{loading ? "—" : fmt(bolsaTotal)}</div>
            <div className="text-xs text-slate-400 mt-0.5" style={NUM}>FCI {fmtShort(latestOf("fondos_comunes"))} · Cauciones {fmtShort(latestOf("cauciones"))}</div>
          </div>
        </div>

        {/* ── MATRIZ DE LIQUIDEZ ── */}
        <div className="rounded-2xl border-2 border-indigo-500/70 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <h2 className="text-[16px] font-bold text-slate-800">¿Llego a pagar todo hasta el…?</h2>
            {([7, 15, 30] as const).map(d => (
              <button key={d} onClick={() => setDias(d)}
                className={`rounded-full px-3.5 py-1 text-xs font-semibold border transition-colors ${
                  dispoDias === d ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-500 border-slate-200 hover:border-indigo-300"
                }`}>{d} días</button>
            ))}
            <FechaInput
              value={dispoFecha}
              onChange={(iso) => { if (iso) { setDispoFecha(iso); setDispoDias(0) } }}
              containerClassName="w-[130px]"
              className={`rounded-full px-3 py-1 text-xs border ${dispoDias === 0 ? "border-indigo-600" : "border-slate-200"}`}
            />
            <span className="ml-auto text-xs text-slate-400">hasta el <b className="text-slate-700">{fmtFechaAR(dispoFecha)}</b></span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[15px] min-w-[640px]">
              <thead>
                <tr>
                  <th className="text-left py-1.5 px-3"></th>
                  {["EFECTIVO", "BANCOS", "CHEQUES"].map(h => (
                    <th key={h} className="text-right py-1.5 px-3 text-[13px] font-bold text-slate-700 tracking-wide" style={{ fontFamily: "Bahnschrift, 'Segoe UI', sans-serif" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-slate-100">
                  <td className="py-2 px-3 text-[13px] font-semibold text-slate-400">Tengo hoy</td>
                  <td className="py-2 px-3 text-right" style={NUM}>{fmt(efectivoSel)}</td>
                  <td className="py-2 px-3 text-right" style={NUM}>{fmt(bancosSel)}</td>
                  <td className="py-2 px-3 text-right" style={NUM}>{fmt(chequesSelTotal)}</td>
                </tr>
                <tr className="border-t border-slate-100">
                  <td className="py-2 px-3 text-[13px] font-semibold text-slate-400">Entra hasta esa fecha</td>
                  <td className="py-2 px-3 text-right text-slate-400 text-sm">nada previsto</td>
                  <td className="py-2 px-3 text-right text-emerald-700" style={NUM}>{entraBancos > 0 ? <>▲ {fmt(entraBancos)} <span className="text-[11px] text-slate-400">cheques depositados</span></> : <span className="text-slate-400 text-sm">nada previsto</span>}</td>
                  <td className="py-2 px-3 text-right text-emerald-700" style={NUM}>▲ {fmt(cobrablesHasta)} <span className="text-[11px] text-slate-400">se hacen cobrables</span></td>
                </tr>
                <tr className="border-t border-slate-100">
                  <td className="py-2 px-3 text-[13px] font-semibold text-slate-400">Sale hasta esa fecha</td>
                  <td className="py-2 px-3 text-right text-red-700" style={NUM}>▼ {fmt(saleEfectivo)}</td>
                  <td className="py-2 px-3 text-right text-red-700" style={NUM}>▼ {fmt(saleBancos)}</td>
                  <td className="py-2 px-3 text-right text-red-700" style={NUM}>▼ {fmt(saleCheques)} <span className="text-[11px] text-slate-400">comprometidos</span></td>
                </tr>
                <tr className="border-t-2 border-slate-200">
                  <td className="py-2.5 px-3 text-sm font-bold text-slate-800">Me queda</td>
                  {[quedaEfectivo, quedaBancos, quedaCheques].map((q, i) => (
                    <td key={i} className="py-2.5 px-3 text-right">
                      <span className={`text-lg font-bold ${q < 0 ? "text-red-700" : "text-emerald-700"}`} style={NUM}>{fmt(q)}</span>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="flex gap-2.5 mt-3 flex-wrap">
            {quedaEfectivo < 0 ? (
              <div className="flex-1 min-w-[230px] rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13.5px] text-red-900">
                <b className="block text-[11px] uppercase tracking-wide">Efectivo · atención</b>
                Faltan {fmt(-quedaEfectivo)}{proxEfectivo ? ` para "${proxEfectivo.proveedores?.nombre || proxEfectivo.concepto}" (${fmtFechaAR(proxEfectivo.fecha_vencimiento)})` : ""}. Retirá del banco o esperá una rendición.
              </div>
            ) : (
              <div className="flex-1 min-w-[230px] rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[13.5px] text-emerald-900">
                <b className="block text-[11px] uppercase tracking-wide">Efectivo · cubierto</b>
                {saleEfectivo > 0 ? `Quedan ${fmt(quedaEfectivo)} después de los pagos por caja.` : "No hay pagos en efectivo en la ventana."}
              </div>
            )}
            {quedaBancos < 0 ? (
              <div className="flex-1 min-w-[230px] rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13.5px] text-red-900">
                <b className="block text-[11px] uppercase tracking-wide">Bancos · atención</b>
                Faltan {fmt(-quedaBancos)}. Depositá cheques cobrables ({fmt(cobrablesHoy)} disponibles) o rescatá del FCI.
              </div>
            ) : (
              <div className="flex-1 min-w-[230px] rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[13.5px] text-emerald-900">
                <b className="block text-[11px] uppercase tracking-wide">Bancos · cubierto</b>
                Quedan {fmt(quedaBancos)} después de transferencias, VEP y débitos de cheques propios.
              </div>
            )}
            {quedaCheques < 0 ? (
              <div className="flex-1 min-w-[230px] rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13.5px] text-red-900">
                <b className="block text-[11px] uppercase tracking-wide">Cheques · atención</b>
                Comprometiste {fmt(-quedaCheques)} más de lo que hay en cartera.
              </div>
            ) : (
              <div className="flex-1 min-w-[230px] rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[13.5px] text-emerald-900">
                <b className="block text-[11px] uppercase tracking-wide">Cheques · cubierto</b>
                {saleCheques > 0 ? `Los comprometidos con proveedores están apartados.` : "No hay pagos con cheque en la ventana."}
              </div>
            )}
          </div>
        </div>

        {/* ── FICHAS ── */}
        <div>
          <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-400 mb-2">
            Cuentas — tocá para incluir o excluir del cálculo · el lápiz actualiza el saldo
          </div>
          <div className="flex flex-wrap gap-2">
            {CAJAS.filter(c => c.group !== "bolsa").map(c => <Ficha key={c.key} caja={c} />)}
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {CAJAS.filter(c => c.group === "bolsa").map(c => <Ficha key={c.key} caja={c} />)}
          </div>
          <div className="flex items-center gap-3 mt-4 mb-2 flex-wrap">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">Cheques en cartera — también se tocan</span>
            <button
              onClick={() => { setImportCartera("AUTO"); setImportOpen(true) }}
              className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700 hover:bg-amber-100 transition-colors"
            >
              <FileSpreadsheet className="h-3 w-3" /> Importar Excel único (detecta E / - / /)
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(CARTERA_DEF) as Cartera[]).map(k => {
              const isSel = carterasSel.has(k)
              return (
                <span key={k} className={`inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm shadow-sm transition-all ${isSel ? "border-indigo-500 ring-1 ring-indigo-500" : "border-slate-200 opacity-70"}`}>
                  <button
                    onClick={() => setCarterasSel(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })}
                    className="inline-flex items-center gap-2"
                  >
                    <span className={`flex h-4 w-4 items-center justify-center rounded border-2 text-[10px] ${isSel ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300"}`}>{isSel ? "✓" : ""}</span>
                    <span className="h-2.5 w-2.5 rounded-sm shrink-0 border border-slate-300" style={{ background: CARTERA_DEF[k].dot }} />
                    <span className="text-slate-600">{CARTERA_DEF[k].label}</span>
                    <span className="font-semibold text-slate-800" style={NUM}>{fmt(carteras[k].total)}</span>
                    <span className="text-[11px] text-slate-400">{carteras[k].count} cheques</span>
                  </button>
                  <span
                    role="button"
                    title={`Importar Excel de cartera ${CARTERA_DEF[k].label}`}
                    onClick={() => { setImportCartera(k); setImportOpen(true) }}
                    className="text-amber-500 hover:text-amber-700 cursor-pointer"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                  </span>
                </span>
              )
            })}
          </div>
          <div className="mt-3">
            <ChequesEmitidosPanel emitidos={emitidos} loading={loading} onChanged={reloadAll} />
          </div>
        </div>

        {/* ── LO QUE HAY QUE PAGAR ── */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h2 className="text-[16px] font-bold text-slate-800">Lo que hay que pagar</h2>
            {([30, 60, 90] as const).map(h => (
              <button key={h} onClick={() => setHorizonte(h)}
                className={`rounded-full px-3.5 py-1 text-xs font-semibold border transition-colors ${
                  horizonte === h ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-500 border-slate-200 hover:border-indigo-300"
                }`}>{h} días</button>
            ))}
            <button onClick={() => setHorizonte(0)}
              className={`rounded-full px-3.5 py-1 text-xs font-semibold border transition-colors ${
                horizonte === 0 ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-500 border-slate-200 hover:border-indigo-300"
              }`}>Todo</button>
            <button onClick={() => setShowCalendario(s => !s)} className="ml-auto text-[13px] font-semibold text-indigo-600 hover:text-indigo-800">
              {showCalendario ? "Cerrar calendario" : "Abrir calendario completo →"}
            </button>
          </div>
          <p className="text-xs text-slate-400 mb-2">Tocá un pago para editarlo (monto, fecha, forma de pago, eliminar).</p>

          {loading ? (
            <div className="py-10 text-center text-slate-400 text-sm">Cargando…</div>
          ) : !items.length ? (
            <div className="py-10 text-center text-slate-400 text-sm">No hay pagos pendientes en este horizonte. 🎉</div>
          ) : (
            <>
              {grupos.semana.length > 0 && (
                <>
                  <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-400 mt-3 mb-1">Esta semana</div>
                  {grupos.semana.map((i, x) => <PagoRow key={x} item={i} />)}
                </>
              )}
              {grupos.proxima.length > 0 && (
                <>
                  <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-400 mt-4 mb-1">Semana que viene</div>
                  {grupos.proxima.map((i, x) => <PagoRow key={x} item={i} />)}
                </>
              )}
              {grupos.meses.map(([mes, lista]) => {
                const abierto = mesesAbiertos.has(mes)
                const total = lista.reduce((s, i) => s + montoDe(i), 0)
                return (
                  <div key={mes} className="mt-3">
                    <button
                      onClick={() => setMesesAbiertos(prev => { const n = new Set(prev); n.has(mes) ? n.delete(mes) : n.add(mes); return n })}
                      className="flex w-full items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-[13.5px] text-slate-500 hover:border-indigo-300 hover:text-indigo-700 transition-colors"
                    >
                      {abierto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <span className="capitalize font-semibold">{nombreMes(mes)}</span>
                      <span>· {lista.length} pago{lista.length > 1 ? "s" : ""} por</span>
                      <span className="font-semibold text-slate-700" style={NUM}>{fmt(total)}</span>
                    </button>
                    {abierto && <div className="mt-1">{lista.map((i, x) => <PagoRow key={x} item={i} />)}</div>}
                  </div>
                )
              })}
            </>
          )}
        </div>

        {/* ── Calendario completo (plegado) ── */}
        {showCalendario && (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <CalendarioPagos key={calKey} showCheques onDataChanged={load} />
          </div>
        )}

        {/* ── Evolución (kardex, plegada) ── */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <button onClick={() => setShowEvolucion(s => !s)} className="flex w-full items-center gap-2 px-5 py-3.5 text-left">
            <TrendingUp className="h-4 w-4 text-indigo-500" />
            <span className="text-sm font-bold text-slate-700">Evolución de saldos</span>
            <span className="text-xs text-slate-400">dato vivo del kardex — desde julio 2026</span>
            {showEvolucion ? <ChevronDown className="ml-auto h-4 w-4 text-slate-400" /> : <ChevronRight className="ml-auto h-4 w-4 text-slate-400" />}
          </button>
          {showEvolucion && (
            <div className="px-5 pb-5">
              {!evolucion.serie.length ? (
                <p className="py-6 text-center text-sm text-slate-400">Todavía no hay serie del kardex.</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={evolucion.serie} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                    <XAxis dataKey="fecha" tick={{ fontSize: 11 }} tickFormatter={d => fmtFechaAR(d).slice(0, 5)} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtShort} width={60} />
                    <Tooltip formatter={(val: number, name: string) => [fmt(val), name]} labelFormatter={d => fmtFechaAR(String(d))} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {evolucion.cuentas.map(nombre => (
                      <Line key={nombre} type="stepAfter" dataKey={nombre} stroke={colorDeCuenta(nombre)} strokeWidth={2} dot={false} connectNulls />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Diálogos ── */}
      <AjustarSaldoDialog
        cuenta={cuentaEdit}
        open={!!cuentaEdit}
        onOpenChange={(o) => { if (!o) setCuentaEdit(null) }}
        onSaved={reloadAll}
      />
      <ActualizarSaldosDialog
        cuentas={cuentas}
        open={saldosDiaOpen}
        onOpenChange={setSaldosDiaOpen}
        onSaved={reloadAll}
      />
      <ImportChequesDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        carteraInicial={importCartera}
        onImported={reloadAll}
      />
      <VencimientoEditDialog
        venc={vencEdit}
        open={!!vencEdit}
        onOpenChange={(o) => { if (!o) setVencEdit(null) }}
        onSaved={reloadAll}
      />
    </div>
  )
}
