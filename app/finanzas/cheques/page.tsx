"use client"

import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChevronDown, FileSpreadsheet, PenLine, Plus, RefreshCw, Search, SlidersHorizontal, X } from "lucide-react"
import { toast } from "sonner"
import { InputMonto } from "@/components/ui/input-monto"
import { DateInputAR } from "@/components/ui/date-input-ar"
import { CargaProgreso, MENSAJES } from "@/components/ui/carga-progreso"
import { ImportChequesDialog } from "@/components/finanzas/import-cheques-dialog"
import { ChequesEmitidosDialog } from "@/components/finanzas/cheques-emitidos-dialog"
import { ChequeManualDialog } from "@/components/finanzas/cheque-manual-dialog"
import { useUrlParams } from "@/lib/hooks/use-url-state"
import { fecha, fechaISO, hoyISO, moneda, sumarDiasISO } from "@/lib/formato"
import { cn } from "@/lib/utils"

// ─── Tipos y catálogos ───────────────────────────────────────────────────────

interface Cheque {
  id: string
  tipo: "TERCERO" | "PROPIO" | string
  estado: string
  banco: string
  numero: string
  fecha_emision?: string | null
  fecha_vencimiento: string
  monto: number
  color: string
  es_echeq?: boolean
  observaciones?: string | null
  fecha_deposito?: string | null
  fecha_rechazo?: string | null
  motivo_rechazo?: string | null
  fecha_debito?: string | null
  cliente_nombre?: string | null
  cuenta_deposito_nombre?: string | null
  proveedor_nombre?: string | null
}

type Cartera = "BLANCO" | "NEGRO" | "ECHEQ"
type TipoAccion = "depositar" | "acreditar" | "rechazar" | "debitar"
type Accion = { tipo: TipoAccion; cheque: Cheque } | null

const ESTADOS: { v: string; label: string; cls: string }[] = [
  { v: "EN_CARTERA", label: "En cartera", cls: "bg-azul-50 text-azul-700" },
  { v: "EN_VERIFICACION", label: "En verificación", cls: "bg-ambar-50 text-ambar-700" },
  { v: "DEPOSITADO", label: "Depositado", cls: "bg-cian-50 text-cian-700" },
  { v: "ENTREGADO_A_PROVEEDOR", label: "Pasado a proveedor", cls: "bg-neutro-100 text-neutro-700" },
  { v: "COBRADO", label: "Cobrado", cls: "bg-exito-50 text-exito-700" },
  { v: "RECHAZADO", label: "Rechazado", cls: "bg-error-50 text-error-700" },
  { v: "ANULADO", label: "Anulado / eliminado", cls: "bg-neutro-100 text-neutro-500" },
]
const ESTADO_INFO = Object.fromEntries(ESTADOS.map((e) => [e.v, e]))
const ESTADOS_DEFAULT = "EN_CARTERA,EN_VERIFICACION,DEPOSITADO"

const CARTERAS: { v: Cartera; label: string; cls: string }[] = [
  { v: "BLANCO", label: "Blanco", cls: "border-neutro-300 bg-white text-neutro-700" },
  { v: "NEGRO", label: "Negro", cls: "border-neutro-800 bg-neutro-800 text-white" },
  { v: "ECHEQ", label: "Echeq", cls: "border-azul-200 bg-azul-50 text-azul-700" },
]

const ORDENES: { v: string; label: string }[] = [
  { v: "venc_asc", label: "Vencimiento ↑ (más próximo)" },
  { v: "venc_desc", label: "Vencimiento ↓ (más lejano)" },
  { v: "monto_desc", label: "Monto ↓ (mayor primero)" },
  { v: "monto_asc", label: "Monto ↑ (menor primero)" },
]

/** Valores por defecto de la URL: si el filtro está en su default no aparece en la URL. */
const DEFAULTS: Record<string, string> = { tipo: "todos", estado: ESTADOS_DEFAULT, orden: "venc_asc" }

const FILTROS_EXTRA = ["emi_d", "emi_h", "ven_d", "ven_h", "dep_d", "dep_h", "monto_d", "monto_h"] as const

const carteraDe = (c: Cheque): Cartera | "PENDIENTE" =>
  c.es_echeq ? "ECHEQ" : c.color === "NEGRO" ? "NEGRO" : c.color === "BLANCO" ? "BLANCO" : "PENDIENTE"

const normalizar = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")

/** "Origen: Venta de pallets · obs" → "Venta de pallets · obs" (cheques cargados a mano). */
const origenManual = (obs: string | null | undefined) => {
  if (!obs) return null
  return obs.startsWith("Origen: ") ? obs.slice(8) : null
}

const enRango = (v: string | null | undefined, desde: string, hasta: string) => {
  if (!desde && !hasta) return true
  const d = v ? fechaISO(v) : ""
  if (!d) return false
  if (desde && d < desde) return false
  if (hasta && d > hasta) return false
  return true
}

// ─── Buckets del resumen ────────────────────────────────────────────────────

type BucketId = "aldia" | "d7" | "d30" | "d60" | "mas60" | "total"

function rangosBuckets(hoy: string): Record<BucketId, { label: string; desde: string; hasta: string; ayuda: string }> {
  return {
    aldia: { label: "Al día", desde: "", hasta: hoy, ayuda: "Vencidos o vencen hoy: se pueden cobrar ya" },
    d7: { label: "1–7 días", desde: sumarDiasISO(hoy, 1), hasta: sumarDiasISO(hoy, 7), ayuda: "Vencen en los próximos 7 días" },
    d30: { label: "8–30 días", desde: sumarDiasISO(hoy, 8), hasta: sumarDiasISO(hoy, 30), ayuda: "Vencen entre 8 y 30 días" },
    d60: { label: "31–60 días", desde: sumarDiasISO(hoy, 31), hasta: sumarDiasISO(hoy, 60), ayuda: "Vencen entre 31 y 60 días" },
    mas60: { label: "+60 días", desde: sumarDiasISO(hoy, 61), hasta: "", ayuda: "Vencen en más de 60 días" },
    total: { label: "Total", desde: "", hasta: "", ayuda: "Toda la cartera" },
  }
}

const bucketDe = (venc: string, hoy: string): Exclude<BucketId, "total"> => {
  const v = (venc || "").slice(0, 10)
  if (v <= hoy) return "aldia"
  if (v <= sumarDiasISO(hoy, 7)) return "d7"
  if (v <= sumarDiasISO(hoy, 30)) return "d30"
  if (v <= sumarDiasISO(hoy, 60)) return "d60"
  return "mas60"
}

// ─── Página ──────────────────────────────────────────────────────────────────

export default function ChequesPage() {
  return (
    <Suspense fallback={<CargaProgreso titulo="Abriendo Cheques" mensajes={MENSAJES.finanzas} />}>
      <ChequesContenido />
    </Suspense>
  )
}

function ChequesContenido() {
  const url = useUrlParams()
  const [cheques, setCheques] = useState<Cheque[]>([])
  const [cuentas, setCuentas] = useState<{ id: string; nombre: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [accion, setAccion] = useState<Accion>(null)
  const [cuentaBanco, setCuentaBanco] = useState("")
  const [gastos, setGastos] = useState<number | null>(null)
  const [motivo, setMotivo] = useState("")
  const [fechaDebito, setFechaDebito] = useState("")
  const [manualOpen, setManualOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [emitidoOpen, setEmitidoOpen] = useState(false)
  const [limite, setLimite] = useState(300)

  const hoy = hoyISO()

  // ─── Filtros (en la URL) ───
  const q = url.get("q")
  const tipo = url.get("tipo", DEFAULTS.tipo)
  const estadoParam = url.get("estado", DEFAULTS.estado)
  const estados = useMemo(
    () => (estadoParam === "TODOS" ? [] : estadoParam.split(",").filter(Boolean)),
    [estadoParam]
  )
  const carteraParam = url.get("cartera")
  const carteras = useMemo(() => carteraParam.split(",").filter(Boolean) as Cartera[], [carteraParam])
  const banco = url.get("banco")
  const orden = url.get("orden", DEFAULTS.orden)
  const emiD = url.get("emi_d"), emiH = url.get("emi_h")
  const venD = url.get("ven_d"), venH = url.get("ven_h")
  const depD = url.get("dep_d"), depH = url.get("dep_h")
  const montoD = url.get("monto_d"), montoH = url.get("monto_h")
  const hayExtras = !!(emiD || emiH || venD || venH || depD || depH || montoD || montoH)
  const [masFiltros, setMasFiltros] = useState(hayExtras)
  useEffect(() => { if (hayExtras) setMasFiltros(true) }, [hayExtras])

  const setF = useCallback(
    (cambios: Record<string, string | null | undefined>) => {
      url.set(cambios, "replace", DEFAULTS)
      setLimite(300)
    },
    [url]
  )

  const hayFiltros =
    !!q || tipo !== DEFAULTS.tipo || estadoParam !== DEFAULTS.estado || carteras.length > 0 || !!banco || hayExtras

  const limpiar = () =>
    setF({
      q: null, tipo: null, estado: null, cartera: null, banco: null,
      ...Object.fromEntries(FILTROS_EXTRA.map((k) => [k, null])),
    })

  // ─── Datos ───
  const loadCheques = useCallback(async () => {
    setLoading(true)
    try {
      const [chRes, ctRes] = await Promise.all([fetch("/api/cheques"), fetch("/api/finanzas/cajas")])
      const chData = await chRes.json()
      if (!chRes.ok) throw new Error(chData.error)
      setCheques(chData.cheques || [])
      const ctData = await ctRes.json().catch(() => ({}))
      setCuentas(
        (ctData.cuentas || [])
          .filter((c: any) => c.cuenta_tipo === "BANCO")
          .map((c: any) => ({ id: c.cuenta_id, nombre: c.nombre }))
      )
    } catch (e: any) {
      toast.error(e.message || "No se pudieron cargar los cheques")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadCheques() }, [loadCheques])

  // ─── Acciones ───
  const abrirAccion = (t: TipoAccion, cheque: Cheque) => {
    setAccion({ tipo: t, cheque })
    setCuentaBanco("")
    setGastos(null)
    setMotivo("")
    setFechaDebito(hoy)
  }

  // #34: el color se cambia a mano tocándolo (solo cheques de tercero en cartera)
  const cambiarColor = async (cheque: Cheque) => {
    const nuevo = cheque.color === "NEGRO" ? "BLANCO" : "NEGRO"
    if (!confirm(`¿Pasar el cheque ${cheque.numero} a ${nuevo}?`)) return
    try {
      const res = await fetch(`/api/cheques/${cheque.id}/color`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ color: nuevo }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "No se pudo cambiar el color")
      toast.success(`Cheque ${cheque.numero} en ${nuevo}`)
      loadCheques()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const ejecutarAccion = async () => {
    if (!accion) return
    const { tipo: t, cheque } = accion
    if (t === "depositar" && !cuentaBanco) {
      toast.error("Seleccioná la cuenta bancaria")
      return
    }
    setSaving(true)
    try {
      const g = gastos ?? 0
      const body =
        t === "depositar" ? { cuenta_banco_id: cuentaBanco, gastos: g }
        : t === "acreditar" ? { gastos: g }
        : t === "debitar" ? { fecha_debito: fechaDebito || hoy }
        : { motivo_rechazo: motivo || "Cheque rechazado", gastos: g }
      const res = await fetch(`/api/cheques/${cheque.id}/${t}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "No se pudo completar la acción")
      toast.success(
        t === "depositar" ? "Cheque depositado"
        : t === "acreditar" ? `Acreditado ${moneda(data.neto_acreditado ?? cheque.monto)}`
        : t === "debitar" ? "Débito conciliado"
        : "Cheque rechazado",
        data.mensaje ? { description: data.mensaje } : undefined
      )
      setAccion(null)
      loadCheques()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ─── Resumen de cartera (terceros EN_CARTERA) ───
  const rangos = useMemo(() => rangosBuckets(hoy), [hoy])
  const resumen = useMemo(() => {
    type Celda = { monto: number; n: number }
    const vacio = (): Record<BucketId, Celda> => ({
      aldia: { monto: 0, n: 0 }, d7: { monto: 0, n: 0 }, d30: { monto: 0, n: 0 },
      d60: { monto: 0, n: 0 }, mas60: { monto: 0, n: 0 }, total: { monto: 0, n: 0 },
    })
    const filas: Record<Cartera | "TOTAL", Record<BucketId, Celda>> = {
      BLANCO: vacio(), NEGRO: vacio(), ECHEQ: vacio(), TOTAL: vacio(),
    }
    for (const c of cheques) {
      if (c.tipo !== "TERCERO" || c.estado !== "EN_CARTERA") continue
      const cart = carteraDe(c)
      const b = bucketDe(c.fecha_vencimiento, hoy)
      const m = Number(c.monto) || 0
      const destinos: (Cartera | "TOTAL")[] = cart === "PENDIENTE" ? ["TOTAL"] : [cart, "TOTAL"]
      for (const d of destinos) {
        filas[d][b].monto += m
        filas[d][b].n++
        filas[d].total.monto += m
        filas[d].total.n++
      }
    }
    const suma = (pred: (c: Cheque) => boolean) => {
      const l = cheques.filter(pred)
      return { n: l.length, monto: l.reduce((s, c) => s + (Number(c.monto) || 0), 0) }
    }
    return {
      filas,
      verificacion: suma((c) => c.estado === "EN_VERIFICACION"),
      depositados: suma((c) => c.estado === "DEPOSITADO"),
      propios: suma((c) => c.tipo === "PROPIO" && c.estado === "ENTREGADO_A_PROVEEDOR"),
    }
  }, [cheques, hoy])

  const aplicarCelda = (cart: Cartera | "TOTAL", b: BucketId) => {
    const r = rangos[b]
    setF({
      tipo: "terceros",
      estado: "EN_CARTERA",
      cartera: cart === "TOTAL" ? null : cart,
      ven_d: r.desde || null,
      ven_h: r.hasta || null,
    })
  }

  // ─── Listado filtrado ───
  const bancos = useMemo(
    () => [...new Set(cheques.map((c) => (c.banco || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")),
    [cheques]
  )

  const filtrados = useMemo(() => {
    const qn = normalizar(q).trim()
    const mDesde = montoD ? Number(montoD) : null
    const mHasta = montoH ? Number(montoH) : null
    const lista = cheques.filter((c) => {
      if (tipo === "propios" && c.tipo !== "PROPIO") return false
      if (tipo === "terceros" && c.tipo !== "TERCERO") return false
      if (estados.length && !estados.includes(c.estado)) return false
      if (carteras.length && !carteras.includes(carteraDe(c) as Cartera)) return false
      if (banco && (c.banco || "").trim() !== banco) return false
      if (!enRango(c.fecha_emision, emiD, emiH)) return false
      if (!enRango(c.fecha_vencimiento, venD, venH)) return false
      if (!enRango(c.fecha_deposito, depD, depH)) return false
      const m = Number(c.monto) || 0
      if (mDesde != null && Number.isFinite(mDesde) && m < mDesde) return false
      if (mHasta != null && Number.isFinite(mHasta) && m > mHasta) return false
      if (qn) {
        const texto = normalizar(
          [c.numero, c.banco, c.cliente_nombre, c.proveedor_nombre, c.observaciones].filter(Boolean).join(" ")
        )
        if (!qn.split(/\s+/).every((p) => texto.includes(p))) return false
      }
      return true
    })
    const venc = (c: Cheque) => (c.fecha_vencimiento || "").slice(0, 10)
    lista.sort((a, b) => {
      switch (orden) {
        case "venc_desc": return venc(b).localeCompare(venc(a))
        case "monto_desc": return (Number(b.monto) || 0) - (Number(a.monto) || 0)
        case "monto_asc": return (Number(a.monto) || 0) - (Number(b.monto) || 0)
        default: return venc(a).localeCompare(venc(b))
      }
    })
    return lista
  }, [cheques, q, tipo, estados, carteras, banco, orden, emiD, emiH, venD, venH, depD, depH, montoD, montoH])

  const totalFiltrado = useMemo(() => filtrados.reduce((s, c) => s + (Number(c.monto) || 0), 0), [filtrados])

  // ─── Atajos de vencimiento ───
  const finDeMes = () => {
    const [y, m] = hoy.split("-").map(Number)
    const sig = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`
    return sumarDiasISO(sig, -1)
  }
  const atajos = [
    { label: "Cobrables ya", desde: "", hasta: hoy },
    { label: "Esta semana", desde: hoy, hasta: sumarDiasISO(hoy, 7) },
    { label: "Este mes", desde: `${hoy.slice(0, 8)}01`, hasta: finDeMes() },
  ]

  const toggleEstado = (v: string) => {
    const set = new Set(estados)
    if (set.has(v)) set.delete(v)
    else set.add(v)
    const lista = ESTADOS.map((e) => e.v).filter((e) => set.has(e))
    setF({ estado: lista.length === 0 || lista.length === ESTADOS.length ? "TODOS" : lista.join(",") })
  }

  const toggleCartera = (v: Cartera) => {
    const set = new Set(carteras)
    if (set.has(v)) set.delete(v)
    else set.add(v)
    setF({ cartera: CARTERAS.map((c) => c.v).filter((c) => set.has(c)).join(",") || null })
  }

  const etiquetaEstados =
    estados.length === 0 ? "Todos"
    : estadoParam === DEFAULTS.estado ? "Activos"
    : estados.length === 1 ? ESTADO_INFO[estados[0]]?.label ?? estados[0]
    : `${estados.length} estados`

  const visibles = filtrados.slice(0, limite)

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-4 sm:px-6">
      {/* ─── Encabezado ─── */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-azul-900">Cheques</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setManualOpen(true)}>
            <Plus className="h-4 w-4" /> Cargar cheque
          </Button>
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <FileSpreadsheet className="h-4 w-4" /> Importar Excel
          </Button>
          <Button variant="outline" onClick={() => setEmitidoOpen(true)}>
            <PenLine className="h-4 w-4" /> Cheque propio emitido
          </Button>
          <Button variant="outline" size="icon" onClick={loadCheques} disabled={loading} title="Actualizar">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* ─── Resumen de cartera ─── */}
      <div className="mb-3 rounded-2xl border border-neutro-200 bg-white px-3 py-2">
        {loading && cheques.length === 0 ? (
          <CargaProgreso compacto mensajes={MENSAJES.finanzas} className="mx-auto max-w-sm py-4" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="px-2 py-1.5 text-left text-[13px] font-semibold normal-case text-neutro-600">En cartera</th>
                  {(Object.keys(rangos) as BucketId[]).map((b) => (
                    <th
                      key={b}
                      title={rangos[b].ayuda}
                      className={cn(
                        "px-2 py-1.5 text-right text-[13px] font-semibold normal-case text-neutro-600",
                        b === "total" && "border-l border-neutro-200"
                      )}
                    >
                      {rangos[b].label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(["BLANCO", "NEGRO", "ECHEQ", "TOTAL"] as const).map((cart) => {
                  const esTotal = cart === "TOTAL"
                  return (
                    <tr key={cart} className={cn(esTotal && "bg-neutro-50")}>
                      <td className={cn("px-2 py-0.5 font-semibold normal-case text-azul-900", esTotal && "border-t border-neutro-200")}>
                        {esTotal ? "Total" : <CarteraBadge cartera={cart} />}
                      </td>
                      {(Object.keys(rangos) as BucketId[]).map((b) => {
                        const celda = resumen.filas[cart][b]
                        return (
                          <td
                            key={b}
                            className={cn(
                              "px-1 py-0.5 text-right",
                              esTotal && "border-t border-neutro-200",
                              b === "total" && "border-l border-neutro-200"
                            )}
                          >
                            <button
                              type="button"
                              disabled={celda.n === 0}
                              onClick={() => aplicarCelda(cart, b)}
                              title={`${celda.n} cheque${celda.n === 1 ? "" : "s"} · ${rangos[b].ayuda}`}
                              className={cn(
                                "w-full rounded-lg px-2 py-0.5 text-right tabular-nums transition-colors",
                                celda.n === 0 ? "cursor-default text-neutro-300" : "hover:bg-azul-50",
                                (esTotal || b === "total") && celda.n > 0 && "font-bold text-azul-900",
                                b === "aldia" && celda.n > 0 && !esTotal && "text-exito-700"
                              )}
                            >
                              {celda.n === 0 ? "—" : moneda(celda.monto, 0)}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {(resumen.verificacion.n > 0 || resumen.depositados.n > 0 || resumen.propios.n > 0) && (
          <div className="mt-1 flex flex-wrap gap-1.5 border-t border-neutro-100 pt-1.5 text-xs">
            {resumen.verificacion.n > 0 && (
              <button type="button" title="Cheques de cobros sin confirmar: no cuentan como cartera"
                className="rounded-full border border-neutro-200 px-2.5 py-0.5 text-neutro-600 hover:bg-neutro-50"
                onClick={() => setF({ estado: "EN_VERIFICACION", tipo: null, cartera: null, ven_d: null, ven_h: null })}>
                En verificación <b className="text-neutro-800">{moneda(resumen.verificacion.monto, 0)}</b>
              </button>
            )}
            {resumen.depositados.n > 0 && (
              <button type="button" title="Depositados que todavía no se acreditaron"
                className="rounded-full border border-neutro-200 px-2.5 py-0.5 text-neutro-600 hover:bg-neutro-50"
                onClick={() => setF({ estado: "DEPOSITADO", tipo: null, cartera: null, ven_d: null, ven_h: null })}>
                Depositados <b className="text-neutro-800">{moneda(resumen.depositados.monto, 0)}</b>
              </button>
            )}
            {resumen.propios.n > 0 && (
              <button type="button" title="Cheques propios entregados que todavía no se debitaron"
                className="rounded-full border border-neutro-200 px-2.5 py-0.5 text-neutro-600 hover:bg-neutro-50"
                onClick={() => setF({ estado: "ENTREGADO_A_PROVEEDOR", tipo: "propios", cartera: null, ven_d: null, ven_h: null })}>
                Propios a debitar <b className="text-neutro-800">{moneda(resumen.propios.monto, 0)}</b>
              </button>
            )}
          </div>
        )}
      </div>

      {/* ─── Filtros ─── */}
      <div className="mb-3 rounded-2xl border border-neutro-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutro-400" />
            <Input
              value={q}
              onChange={(e) => setF({ q: e.target.value })}
              placeholder="Buscar número, banco, cliente, proveedor, observaciones…"
              className="pl-8"
            />
          </div>

          <div className="flex h-10 overflow-hidden rounded-lg border border-neutro-300">
            {[
              { v: "todos", label: "Todos" },
              { v: "terceros", label: "De terceros" },
              { v: "propios", label: "Propios" },
            ].map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => setF({ tipo: o.v })}
                className={cn(
                  "px-3 text-sm font-medium transition-colors",
                  tipo === o.v ? "bg-azul-600 text-white" : "bg-white text-neutro-700 hover:bg-neutro-50"
                )}
              >
                {o.label}
              </button>
            ))}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-10">
                Estado: {etiquetaEstados} <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
              <DropdownMenuLabel>Estados</DropdownMenuLabel>
              {ESTADOS.map((e) => (
                <DropdownMenuCheckboxItem
                  key={e.v}
                  checked={estados.length === 0 || estados.includes(e.v)}
                  onCheckedChange={() => toggleEstado(e.v)}
                  onSelect={(ev) => ev.preventDefault()}
                >
                  {e.label}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setF({ estado: null })}>Solo activos (por defecto)</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setF({ estado: "TODOS" })}>Todos los estados</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="flex items-center gap-1">
            {CARTERAS.map((c) => {
              const activo = carteras.includes(c.v)
              return (
                <button
                  key={c.v}
                  type="button"
                  onClick={() => toggleCartera(c.v)}
                  className={cn(
                    "h-10 rounded-lg border px-3 text-sm font-medium transition-colors",
                    activo ? "border-azul-600 bg-azul-600 text-white" : "border-neutro-300 bg-white text-neutro-700 hover:bg-neutro-50"
                  )}
                >
                  {c.label}
                </button>
              )
            })}
          </div>

          <Select value={banco || "__todos"} onValueChange={(v) => setF({ banco: v === "__todos" ? null : v })}>
            <SelectTrigger className="h-10 w-[170px]"><SelectValue placeholder="Banco" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__todos">Todos los bancos</SelectItem>
              {bancos.map((b) => (
                <SelectItem key={b} value={b}>{b}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={orden} onValueChange={(v) => setF({ orden: v })}>
            <SelectTrigger className="h-10 w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ORDENES.map((o) => (
                <SelectItem key={o.v} value={o.v}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button variant={masFiltros ? "secondary" : "outline"} className="h-10" onClick={() => setMasFiltros((v) => !v)}>
            <SlidersHorizontal className="h-4 w-4" /> Fechas y montos
          </Button>

          {hayFiltros && (
            <Button variant="ghost" className="h-10 text-neutro-600" onClick={limpiar}>
              <X className="h-4 w-4" /> Limpiar
            </Button>
          )}
        </div>

        {masFiltros && (
          <div className="mt-3 grid grid-cols-1 gap-3 border-t border-neutro-100 pt-3 sm:grid-cols-2 xl:grid-cols-4">
            <RangoFechas
              label="Vencimiento"
              desde={venD}
              hasta={venH}
              onChange={(d, h) => setF({ ven_d: d, ven_h: h })}
              extra={
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {atajos.map((a) => {
                    const activo = venD === a.desde && venH === a.hasta
                    return (
                      <button
                        key={a.label}
                        type="button"
                        onClick={() => setF({ ven_d: a.desde || null, ven_h: a.hasta || null })}
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-xs font-medium",
                          activo ? "border-azul-600 bg-azul-600 text-white" : "border-neutro-300 text-neutro-700 hover:bg-neutro-50"
                        )}
                      >
                        {a.label}
                      </button>
                    )
                  })}
                </div>
              }
            />
            <RangoFechas label="Emisión" desde={emiD} hasta={emiH} onChange={(d, h) => setF({ emi_d: d, emi_h: h })} />
            <RangoFechas label="Depósito" desde={depD} hasta={depH} onChange={(d, h) => setF({ dep_d: d, dep_h: h })} />
            <div>
              <Label className="text-[13px] font-semibold text-neutro-600">Monto</Label>
              <div className="mt-1 flex items-center gap-1.5">
                <div className="min-w-0 flex-1">
                  <InputMonto
                    pesos
                    soloPositivos
                    value={montoD}
                    onChange={(n) => setF({ monto_d: n == null ? null : String(n) })}
                    placeholder="desde"
                  />
                </div>
                <span className="text-neutro-400">–</span>
                <div className="min-w-0 flex-1">
                  <InputMonto
                    pesos
                    soloPositivos
                    value={montoH}
                    onChange={(n) => setF({ monto_h: n == null ? null : String(n) })}
                    placeholder="hasta"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── Totales del filtro ─── */}
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 px-1">
        <p className="text-sm text-neutro-600">
          <b className="text-azul-900">{filtrados.length}</b> {filtrados.length === 1 ? "cheque" : "cheques"} ·{" "}
          <b className="tabular-nums text-azul-900">{moneda(totalFiltrado, 0)}</b>
        </p>
      </div>

      {/* ─── Listado ─── */}
      <div className="rounded-2xl border border-neutro-200 bg-white">
        {loading && cheques.length === 0 ? (
          <CargaProgreso compacto mensajes={MENSAJES.finanzas} className="mx-auto max-w-sm py-8" />
        ) : filtrados.length === 0 ? (
          <p className="py-12 text-center text-sm text-neutro-500">
            No hay cheques con estos filtros.
            {hayFiltros && (
              <button type="button" className="ml-1 font-semibold text-azul-700 hover:underline" onClick={limpiar}>
                Limpiar filtros
              </button>
            )}
          </p>
        ) : (
          <div className="max-h-[70vh] overflow-auto rounded-2xl">
            <table className="w-full min-w-[1100px] border-separate border-spacing-0 text-sm">
              <thead className="sticky top-0 z-10 bg-neutro-50">
                <tr className="text-left">
                  {["Vencimiento", "Número", "Banco", "De / A", "Cartera", "Estado"].map((h) => (
                    <th key={h} className="border-b border-neutro-200 bg-neutro-50 px-3 py-2 text-[13px] font-semibold normal-case text-neutro-600">
                      {h}
                    </th>
                  ))}
                  <th className="border-b border-neutro-200 bg-neutro-50 px-3 py-2 text-right text-[13px] font-semibold normal-case text-neutro-600">Monto</th>
                  <th className="border-b border-neutro-200 bg-neutro-50 px-3 py-2 text-right text-[13px] font-semibold normal-case text-neutro-600">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((c) => (
                  <FilaCheque key={c.id} c={c} hoy={hoy} onAccion={abrirAccion} onCambiarColor={cambiarColor} />
                ))}
              </tbody>
            </table>
            {filtrados.length > limite && (
              <div className="border-t border-neutro-100 py-3 text-center">
                <Button variant="outline" size="sm" onClick={() => setLimite((l) => l + 300)}>
                  Ver 300 más (mostrando {visibles.length} de {filtrados.length})
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── Modal de acción ─── */}
      <Dialog open={!!accion} onOpenChange={(o) => !o && setAccion(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {accion?.tipo === "depositar" && "Depositar cheque"}
              {accion?.tipo === "acreditar" && "Acreditar cheque"}
              {accion?.tipo === "rechazar" && "Rechazar cheque"}
              {accion?.tipo === "debitar" && "Cheque propio debitado"}
            </DialogTitle>
          </DialogHeader>
          {accion && (
            <div className="space-y-4">
              <p className="text-sm text-neutro-600">
                {accion.cheque.banco} Nº {accion.cheque.numero} — {moneda(accion.cheque.monto)}
                {accion.cheque.cliente_nombre && ` · ${accion.cheque.cliente_nombre}`}
                {accion.cheque.proveedor_nombre && ` · ${accion.cheque.proveedor_nombre}`}
              </p>
              {accion.tipo === "depositar" && (
                <div className="space-y-1">
                  <Label className="text-[13px] font-semibold text-neutro-600">Cuenta bancaria de depósito</Label>
                  <Select value={cuentaBanco || undefined} onValueChange={setCuentaBanco}>
                    <SelectTrigger><SelectValue placeholder="Seleccioná cuenta" /></SelectTrigger>
                    <SelectContent>
                      {cuentas.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.nombre}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {accion.tipo === "rechazar" && (
                <div className="space-y-1">
                  <Label className="text-[13px] font-semibold text-neutro-600">Motivo del rechazo</Label>
                  <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Sin fondos, defecto formal..." />
                </div>
              )}
              {accion.tipo === "debitar" ? (
                <div className="space-y-1">
                  <Label className="text-[13px] font-semibold text-neutro-600">Fecha de débito</Label>
                  <DateInputAR value={fechaDebito} onChange={setFechaDebito} />
                  <p className="mt-1 text-xs text-neutro-500">
                    Concilia el débito del cheque propio (pasa a cobrado). No toca el saldo del banco: ajustalo al
                    conciliar la cuenta.
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  <Label className="text-[13px] font-semibold text-neutro-600">Gastos bancarios</Label>
                  <InputMonto soloPositivos value={gastos} onChange={setGastos} placeholder="0" />
                  {accion.tipo === "acreditar" && gastos != null && gastos > 0 && (
                    <p className="mt-1 text-xs text-neutro-500">
                      Se acreditan {moneda(Math.max(0, Number(accion.cheque.monto) - gastos))} netos.
                    </p>
                  )}
                  {accion.tipo === "rechazar" && (
                    <p className="mt-1 text-xs text-neutro-500">
                      Si el pago origen estaba confirmado, se genera ND al cliente (monto + gastos).
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAccion(null)}>Cancelar</Button>
            <Button onClick={ejecutarAccion} disabled={saving} variant={accion?.tipo === "rechazar" ? "destructive" : "default"}>
              {saving ? "Procesando..." : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ChequeManualDialog open={manualOpen} onOpenChange={setManualOpen} onSaved={loadCheques} />
      <ImportChequesDialog open={importOpen} onOpenChange={setImportOpen} carteraInicial="AUTO" onImported={loadCheques} />
      <ChequesEmitidosDialog open={emitidoOpen} onOpenChange={setEmitidoOpen} onSaved={loadCheques} />
    </div>
  )
}

// ─── Piezas ──────────────────────────────────────────────────────────────────

function CarteraBadge({ cartera }: { cartera: Cartera | "PENDIENTE" }) {
  const info = CARTERAS.find((c) => c.v === cartera)
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold normal-case",
        info ? info.cls : "border-neutro-200 bg-neutro-50 text-neutro-500"
      )}
    >
      {info ? info.label : "Pendiente"}
    </span>
  )
}

function EstadoBadge({ estado }: { estado: string }) {
  const info = ESTADO_INFO[estado]
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold normal-case",
        info ? info.cls : "bg-neutro-100 text-neutro-600"
      )}
    >
      {info ? info.label : estado}
    </span>
  )
}

function FilaCheque({ c, hoy, onAccion, onCambiarColor }: { c: Cheque; hoy: string; onAccion: (t: TipoAccion, c: Cheque) => void; onCambiarColor: (c: Cheque) => void }) {
  const colorEditable = c.tipo === "TERCERO" && !c.es_echeq && ["EN_CARTERA", "EN_VERIFICACION"].includes(c.estado)
  const esPropio = c.tipo === "PROPIO"
  const manual = origenManual(c.observaciones)
  const deA = esPropio
    ? c.proveedor_nombre || "—"
    : c.cliente_nombre || manual || c.observaciones || "—"
  const venc = (c.fecha_vencimiento || "").slice(0, 10)
  const activo = ["EN_CARTERA", "EN_VERIFICACION", "DEPOSITADO", "ENTREGADO_A_PROVEEDOR"].includes(c.estado)
  const cobrable = activo && venc <= hoy

  let detalle: string | null = null
  if (c.estado === "DEPOSITADO") {
    detalle = [c.cuenta_deposito_nombre ? `en ${c.cuenta_deposito_nombre}` : null, c.fecha_deposito ? fecha(c.fecha_deposito) : null]
      .filter(Boolean).join(" · ") || null
  } else if (c.estado === "RECHAZADO") {
    detalle = [c.motivo_rechazo, c.fecha_rechazo ? fecha(c.fecha_rechazo) : null].filter(Boolean).join(" · ") || null
  } else if (c.estado === "COBRADO" && c.fecha_debito) {
    detalle = `debitado ${fecha(c.fecha_debito)}`
  }

  return (
    <tr className="hover:bg-azul-50/40">
      <td className="whitespace-nowrap border-b border-neutro-100 px-3 py-2 tabular-nums">
        <span className={cn(cobrable && "font-semibold text-exito-700")}>{fecha(c.fecha_vencimiento)}</span>
        {c.fecha_emision && <span className="block text-[11px] text-neutro-400">emitido {fecha(c.fecha_emision)}</span>}
      </td>
      <td className="whitespace-nowrap border-b border-neutro-100 px-3 py-2 font-mono">
        {c.numero}
        {esPropio && (
          <span className="ml-1.5 rounded bg-neutro-100 px-1 py-0.5 text-[10px] font-semibold normal-case text-neutro-600">propio</span>
        )}
      </td>
      <td className="border-b border-neutro-100 px-3 py-2">{c.banco}</td>
      <td className="max-w-[260px] border-b border-neutro-100 px-3 py-2">
        <span className="line-clamp-2" title={c.observaciones ?? undefined}>
          {esPropio && <span className="text-neutro-400">a </span>}
          {deA}
        </span>
      </td>
      <td className="border-b border-neutro-100 px-3 py-2">
        {colorEditable ? (
          <button type="button" title="Tocá para cambiar el color" onClick={() => onCambiarColor(c)} className="rounded-full hover:ring-2 hover:ring-azul-300">
            <CarteraBadge cartera={carteraDe(c)} />
          </button>
        ) : (
          <CarteraBadge cartera={carteraDe(c)} />
        )}
      </td>
      <td className="border-b border-neutro-100 px-3 py-2">
        <EstadoBadge estado={c.estado} />
        {detalle && (
          <span className="mt-0.5 block max-w-[200px] truncate text-[11px] text-neutro-500" title={detalle}>{detalle}</span>
        )}
      </td>
      <td className="whitespace-nowrap border-b border-neutro-100 px-3 py-2 text-right font-bold tabular-nums text-azul-900">
        {moneda(c.monto)}
      </td>
      <td className="whitespace-nowrap border-b border-neutro-100 px-3 py-2 text-right">
        <div className="flex justify-end gap-1.5">
          {c.estado === "EN_CARTERA" && (
            <Button size="sm" variant="outline" onClick={() => onAccion("depositar", c)}>Depositar</Button>
          )}
          {c.estado === "DEPOSITADO" && (
            <Button size="sm" onClick={() => onAccion("acreditar", c)}>Acreditar</Button>
          )}
          {esPropio && c.estado === "ENTREGADO_A_PROVEEDOR" && (
            <Button
              size="sm"
              variant="outline"
              className="border-exito-200 text-exito-700 hover:bg-exito-50"
              onClick={() => onAccion("debitar", c)}
            >
              Debitado
            </Button>
          )}
          {["EN_VERIFICACION", "EN_CARTERA", "DEPOSITADO"].includes(c.estado) && (
            <Button size="sm" variant="ghost" className="text-error-600 hover:bg-error-50" onClick={() => onAccion("rechazar", c)}>
              {c.estado === "DEPOSITADO" ? "Rechazado" : "Rechazar"}
            </Button>
          )}
        </div>
      </td>
    </tr>
  )
}

/** Desde / hasta con DateInputAR (dd/mm/aaaa). */
function RangoFechas({
  label, desde, hasta, onChange, extra,
}: {
  label: string
  desde: string
  hasta: string
  onChange: (desde: string | null, hasta: string | null) => void
  extra?: ReactNode
}) {
  return (
    <div>
      <Label className="text-[13px] font-semibold text-neutro-600">{label}</Label>
      <div className="mt-1 flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <DateInputAR value={desde} onChange={(v) => onChange(v || null, hasta || null)} placeholder="desde" />
        </div>
        <span className="text-neutro-400">–</span>
        <div className="min-w-0 flex-1">
          <DateInputAR value={hasta} onChange={(v) => onChange(desde || null, v || null)} placeholder="hasta" />
        </div>
      </div>
      {extra}
    </div>
  )
}
