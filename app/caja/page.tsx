"use client"

// ─── La Caja del Día ────────────────────────────────────────────────────────
// Libro diario unificado de la plata, a ancho completo. Reemplaza la hoja de
// caja de Drive: cobros, transferencias, echeqs, proveedores y rendiciones en
// una sola lista, con el arqueo de caja chica siempre a la vista.
// E1: lectura. E2: barra de registro rápido (cobros pendientes vía
// /api/cobranzas confirmar:false), Mover plata (transferencias/egresos) y
// confirmación/rechazo inline (PATCH /api/pagos/[id]/confirmar). Pendientes:
// control físico de rendiciones (E3) y cierre que imputa (E4).

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Ban, ChevronLeft, ChevronRight, Loader2, RefreshCw, Search } from "lucide-react"
import { createBrowserClient } from "@supabase/ssr"
import { FechaInput } from "@/components/finanzas/fecha-input"
import { RegistrarCobro, type CuentaFondos } from "@/components/caja/registrar-cobro"
import { MoverPlata } from "@/components/caja/mover-plata"
import { ConfirmarDialog, type PagoAConfirmar } from "@/components/caja/confirmar-dialog"
import { ControlarRendicion } from "@/components/caja/controlar-rendicion"
import { CerrarDia } from "@/components/caja/cerrar-dia"
import { ImputarPago, type PagoAImputar } from "@/components/caja/imputar-pago"
import { useToast } from "@/hooks/use-toast"
import { todayArgentina } from "@/lib/utils"

type Estado = { tipo: "ok" | "info" | "accion" | "esperando" | "error"; texto: string }

interface FilaCaja {
  id: string
  fuente: "kardex" | "pago" | "rendicion"
  categoria: "cobro" | "transferencia" | "echeq" | "proveedor" | "rendicion" | "interno"
  hora: string | null
  quien: string
  sub: string
  medio: string
  entrada: number | null
  salida: number | null
  neutro: number | null
  estado: Estado
  cliente_id?: string | null
  pago_id?: string | null
  rendicion_id?: string | null
  confirmable?: boolean
  detalles_resumen?: { tipo: string; monto: number; descripcion: string }[]
  requiere_color?: boolean
  imputable?: boolean
  imputacion_disponible?: number
}

interface FeedCaja {
  fecha: string
  filas: FilaCaja[]
  pendientes_anteriores: FilaCaja[]
  rendiciones_abiertas: FilaCaja[]
  totales: { entrada: number; salida: number }
  arqueo: { caja_chica_id: string | null; caja_chica_nombre: string | null; efectivo_esperado: number }
  panel_pendientes: {
    echeqs_por_aceptar: number
    transferencias_por_confirmar: number
    rendiciones_en_camino: number
  }
}

const TABS = [
  { key: "todo", label: "Todo" },
  { key: "cobro", label: "Cobros" },
  { key: "transferencia", label: "Transferencias" },
  { key: "echeq", label: "Echeqs" },
  { key: "proveedor", label: "Proveedores" },
  { key: "rendicion", label: "Rendiciones" },
  { key: "interno", label: "Internos" },
] as const

const NUM = { fontVariantNumeric: "tabular-nums" } as const

const fmt = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 2 })

function horaAR(iso: string | null) {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleTimeString("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
  } catch {
    return "—"
  }
}

function fechaLarga(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`)
  const s = d.toLocaleDateString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    weekday: "long",
    day: "numeric",
    month: "long",
  })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function sumarDias(iso: string, dias: number) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

function EstadoChip({ estado, fila, onAccion }: { estado: Estado; fila: FilaCaja; onAccion?: (f: FilaCaja) => void }) {
  const estilos: Record<Estado["tipo"], string> = {
    ok: "bg-green-100 text-green-700",
    info: "bg-slate-100 text-slate-600",
    accion: "bg-amber-100 text-amber-800",
    esperando: "bg-purple-100 text-purple-700",
    error: "bg-red-100 text-red-700",
  }
  // El estado ES el botón: chip Imputar → cuenta corriente del cliente.
  if (estado.tipo === "accion" && fila.imputable && fila.pago_id && onAccion) {
    return (
      <button
        onClick={() => onAccion(fila)}
        className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-3.5 py-1 text-[11px] font-bold text-white shadow-sm transition hover:bg-blue-700 whitespace-nowrap"
      >
        Imputar
      </button>
    )
  }
  // Pagos confirmables abren el modal de confirmación acá mismo.
  if (estado.tipo === "accion" && fila.confirmable && fila.pago_id && onAccion) {
    return (
      <button
        onClick={() => onAccion(fila)}
        className="inline-flex items-center gap-1 rounded-full bg-green-600 px-3.5 py-1 text-[11px] font-bold text-white shadow-sm transition hover:bg-green-700 whitespace-nowrap"
      >
        {estado.texto}
      </button>
    )
  }
  // Rendiciones esperando la plata: Controlar abre el checklist físico acá mismo.
  if (estado.tipo === "esperando" && fila.rendicion_id && onAccion) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className={`rounded-full px-3 py-0.5 text-[11px] font-semibold whitespace-nowrap ${estilos.esperando}`}>
          {estado.texto}
        </span>
        <button
          onClick={() => onAccion(fila)}
          className="rounded-full bg-blue-600 px-3.5 py-1 text-[11px] font-bold text-white shadow-sm transition hover:bg-blue-700 whitespace-nowrap"
        >
          Controlar
        </button>
      </span>
    )
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-3 py-0.5 text-[11px] font-semibold whitespace-nowrap ${estilos[estado.tipo]}`}
    >
      {estado.texto}
    </span>
  )
}

function Fila({
  f,
  onAccion,
  onAnular,
}: {
  f: FilaCaja
  onAccion?: (f: FilaCaja) => void
  onAnular?: (f: FilaCaja) => void
}) {
  const fondo =
    f.estado.tipo === "accion"
      ? "bg-amber-50/60 border-amber-200"
      : f.estado.tipo === "esperando"
        ? "bg-purple-50/60 border-purple-200"
        : f.estado.tipo === "error"
          ? "bg-red-50/60 border-red-200"
          : "bg-white border-slate-200"
  const monto =
    f.entrada != null ? (
      <span className="text-green-700" style={NUM}>+ {fmt(f.entrada)}</span>
    ) : f.salida != null ? (
      <span className="text-red-700" style={NUM}>− {fmt(f.salida)}</span>
    ) : f.neutro != null ? (
      <span className="text-slate-600" style={NUM}>{fmt(f.neutro)}</span>
    ) : (
      <span className="text-slate-400">—</span>
    )
  return (
    <div className={`flex items-center gap-4 rounded-xl border px-4 py-2.5 ${fondo}`}>
      <span className="w-10 flex-none text-[11px] text-slate-400" style={NUM}>
        {horaAR(f.hora)}
      </span>
      <span className="w-[280px] flex-none min-w-0">
        <span className="block truncate text-[13px] font-bold text-slate-900">{f.quien}</span>
        <span className="block truncate text-[11px] text-slate-500">{f.sub}</span>
      </span>
      <span className="flex-1 min-w-0 truncate text-[12.5px] text-slate-600">{f.medio}</span>
      <span className="w-[130px] flex-none text-right text-[13.5px] font-bold">{monto}</span>
      <span className="w-[220px] flex-none text-right">
        <EstadoChip estado={f.estado} fila={f} onAccion={onAccion} />
      </span>
      {/* Anular recibo: cobros asentados en el libro (kardex) con pago asociado */}
      {onAnular && f.fuente === "kardex" && f.pago_id && ["cobro", "transferencia", "echeq"].includes(f.categoria) && f.estado.tipo !== "error" ? (
        <button
          onClick={() => onAnular(f)}
          title="Anular recibo (revierte imputaciones, caja y cheques)"
          className="w-6 flex-none rounded-md p-1 text-slate-300 transition hover:bg-red-50 hover:text-red-600"
        >
          <Ban className="h-3.5 w-3.5" />
        </button>
      ) : (
        <span className="w-6 flex-none" />
      )}
    </div>
  )
}

export default function CajaDelDiaPage() {
  const [fecha, setFecha] = useState(todayArgentina())
  const [feed, setFeed] = useState<FeedCaja | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("todo")
  const [busqueda, setBusqueda] = useState("")
  const [cuentas, setCuentas] = useState<CuentaFondos[]>([])
  const [usuarioId, setUsuarioId] = useState("")
  const [pagoAConfirmar, setPagoAConfirmar] = useState<PagoAConfirmar | null>(null)
  const [rendicionAControlar, setRendicionAControlar] = useState<string | null>(null)
  const [pagoAImputar, setPagoAImputar] = useState<PagoAImputar | null>(null)
  const [cerrandoDia, setCerrandoDia] = useState(false)
  const [pagoAAnular, setPagoAAnular] = useState<{ pago_id: string; quien: string } | null>(null)
  const [motivoAnulacion, setMotivoAnulacion] = useState("")
  const [anulando, setAnulando] = useState(false)
  const { toast } = useToast()

  const cargar = useCallback(async (f: string) => {
    setCargando(true)
    setError(null)
    try {
      const res = await fetch(`/api/caja?fecha=${f}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Error al cargar la caja")
      setFeed(data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar(fecha)
  }, [fecha, cargar])

  // Cuentas para la barra de registro y Mover plata + usuario para confirmar
  useEffect(() => {
    fetch("/api/finanzas/cajas")
      .then((r) => r.json())
      .then((d) => setCuentas(d.cuentas || []))
      .catch(() => {})
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    supabase.auth.getUser().then(({ data }) => setUsuarioId(data.user?.id ?? ""))
  }, [])

  const abrirConfirmacion = useCallback((f: FilaCaja) => {
    if (f.fuente === "rendicion" && f.rendicion_id) {
      setRendicionAControlar(f.rendicion_id)
      return
    }
    if (f.imputable && f.pago_id && f.cliente_id) {
      setPagoAImputar({
        pago_id: f.pago_id,
        cliente_id: f.cliente_id,
        quien: f.quien,
        disponible: f.imputacion_disponible ?? 0,
      })
      return
    }
    if (!f.pago_id) return
    setPagoAConfirmar({
      pago_id: f.pago_id,
      quien: f.quien,
      monto: f.entrada ?? f.neutro ?? 0,
      detalles: f.detalles_resumen ?? [],
      requiere_color: f.requiere_color ?? false,
      accion_texto: f.estado.texto,
    })
  }, [])

  const filtrar = useCallback(
    (filas: FilaCaja[]) => {
      let out = filas
      if (tab !== "todo") out = out.filter((f) => f.categoria === tab)
      const q = busqueda.trim().toLowerCase()
      if (q)
        out = out.filter((f) =>
          `${f.quien} ${f.sub} ${f.medio} ${f.estado.texto}`.toLowerCase().includes(q)
        )
      return out
    },
    [tab, busqueda]
  )

  const filasDia = useMemo(() => filtrar(feed?.filas ?? []), [feed, filtrar])
  const filasAnteriores = useMemo(() => filtrar(feed?.pendientes_anteriores ?? []), [feed, filtrar])
  const filasRend = useMemo(
    () => (tab === "todo" || tab === "rendicion" ? (feed?.rendiciones_abiertas ?? []) : []),
    [feed, tab]
  )

  const esHoy = fecha === todayArgentina()

  const anularRecibo = async () => {
    if (!pagoAAnular) return
    setAnulando(true)
    try {
      const res = await fetch(`/api/pagos-clientes/${pagoAAnular.pago_id}/anular`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: motivoAnulacion || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Error anulando el recibo")
      toast({
        title: "Recibo anulado",
        description: `${pagoAAnular.quien}: imputaciones revertidas, la plata salió de la caja y los comprobantes volvieron a quedar pendientes.`,
      })
      setPagoAAnular(null)
      setMotivoAnulacion("")
      cargar(fecha)
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message })
    } finally {
      setAnulando(false)
    }
  }

  // Cobros del día con plata sin aplicar a comprobantes (chip Imputar)
  const sinImputar = useMemo(
    () => (feed?.filas ?? []).filter((f) => f.imputable).length,
    [feed]
  )

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="px-6 py-5">
        {/* ── Encabezado ── */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setFecha(sumarDias(fecha, -1))}
                className="rounded-lg border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-50"
                aria-label="Día anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <h1 className="text-2xl font-extrabold text-slate-900">{fechaLarga(fecha)}</h1>
              <button
                onClick={() => setFecha(sumarDias(fecha, 1))}
                disabled={esHoy}
                className="rounded-lg border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                aria-label="Día siguiente"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <FechaInput value={fecha} onChange={(iso) => iso && setFecha(iso)} containerClassName="w-[130px]" />
              {!esHoy && (
                <button
                  onClick={() => setFecha(todayArgentina())}
                  className="text-xs font-semibold text-blue-600 hover:underline"
                >
                  Ir a hoy
                </button>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              La Caja del Día · caja chica
              {feed?.arqueo.caja_chica_nombre ? ` (${feed.arqueo.caja_chica_nombre})` : ""} — libro
              unificado de cobros, transferencias, echeqs, proveedores y rendiciones
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar cliente, banco, número…"
                className="w-64 rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <button
              onClick={() => cargar(fecha)}
              className="rounded-lg border border-slate-300 bg-white p-2 text-slate-600 hover:bg-slate-50"
              title="Actualizar"
            >
              <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* ── Pestañas ── */}
        <div className="mb-4 inline-flex rounded-lg bg-slate-200 p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition ${
                tab === t.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {(feed as any)?.reconciliacion_descuadres > 0 && (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            ⚠ Hay {(feed as any).reconciliacion_descuadres} cliente(s) con el libro mayor desalineado de sus
            comprobantes. Revisá <code className="font-mono">/api/finanzas/reconciliacion</code> antes del cierre.
          </div>
        )}

        <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
          {/* ── Lista de movimientos ── */}
          <div className="min-w-0 flex-1">
            {/* Barra de registro rápido + Mover plata (solo sobre el día de hoy) */}
            {esHoy && (
              <>
                <RegistrarCobro cuentas={cuentas} onRegistrado={() => cargar(fecha)} />
                <div className="mb-4 -mt-2">
                  <MoverPlata cuentas={cuentas} onMovido={() => cargar(fecha)} />
                </div>
              </>
            )}
            {/* Rendiciones esperando la plata (siempre arriba: son lo próximo que llega) */}
            {filasRend.length > 0 && (
              <div className="mb-4">
                <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-purple-600">
                  Esperando la plata
                </div>
                <div className="flex flex-col gap-1.5">
                  {filasRend.map((f) => (
                    <Fila key={f.id} f={f} onAccion={abrirConfirmacion} onAnular={(x) => x.pago_id && setPagoAAnular({ pago_id: x.pago_id, quien: x.quien })} />
                  ))}
                </div>
              </div>
            )}

            {/* Pendientes de días anteriores */}
            {filasAnteriores.length > 0 && (
              <div className="mb-4">
                <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-amber-600">
                  Pendientes de días anteriores
                </div>
                <div className="flex flex-col gap-1.5">
                  {filasAnteriores.map((f) => (
                    <Fila key={f.id} f={f} onAccion={abrirConfirmacion} onAnular={(x) => x.pago_id && setPagoAAnular({ pago_id: x.pago_id, quien: x.quien })} />
                  ))}
                </div>
              </div>
            )}

            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                {esHoy ? "Hoy" : "Movimientos del día"}
              </span>
              <span className="text-[11px] text-slate-400">
                {filasDia.length} movimiento{filasDia.length !== 1 ? "s" : ""}
              </span>
            </div>
            {cargando && !feed ? (
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400">
                Cargando…
              </div>
            ) : filasDia.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400">
                Sin movimientos {tab !== "todo" ? "de este tipo " : ""}en el día
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {filasDia.map((f) => (
                  <Fila key={f.id} f={f} onAccion={abrirConfirmacion} onAnular={(x) => x.pago_id && setPagoAAnular({ pago_id: x.pago_id, quien: x.quien })} />
                ))}
              </div>
            )}
          </div>

          {/* ── Panel derecho ── */}
          <div className="w-full flex-none xl:w-[290px]">
            <div className="rounded-xl border-2 border-green-200 bg-white p-4">
              <div className="text-[13px] font-bold text-slate-900">Arqueo de caja chica</div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-slate-500">Efectivo esperado</span>
                <span className="font-bold" style={NUM}>
                  $ {fmt(feed?.arqueo.efectivo_esperado ?? 0)}
                </span>
              </div>
              {sinImputar > 0 && (
                <div className="mt-1 flex items-center justify-between text-sm">
                  <span className="text-slate-500">Cobros sin imputar</span>
                  <span className="font-bold" style={NUM}>{sinImputar}</span>
                </div>
              )}
              {esHoy && feed?.arqueo.caja_chica_id ? (
                <>
                  <button
                    onClick={() => setCerrandoDia(true)}
                    className="mt-3 w-full rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700"
                  >
                    Cerrar el día
                  </button>
                  <div className="mt-2 text-[11px] text-slate-400">
                    Al cerrar: contás el efectivo, se verifican los cobros del día y la diferencia
                    queda auditada. Conteo billete por billete en{" "}
                    <Link href="/finanzas/cierres" className="font-semibold text-blue-600 hover:underline">
                      Cierre de caja
                    </Link>
                    .
                  </div>
                </>
              ) : (
                <div className="mt-2 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
                  El cierre se hace parado en el día de hoy.
                </div>
              )}
            </div>

            <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-[12.5px] font-bold text-slate-900">Pendientes</div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-slate-500">⚡ Echeqs por aceptar</span>
                <span className="font-bold" style={NUM}>{feed?.panel_pendientes.echeqs_por_aceptar ?? 0}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-sm">
                <span className="text-slate-500">🏦 Transf. por confirmar</span>
                <span className="font-bold" style={NUM}>
                  {feed?.panel_pendientes.transferencias_por_confirmar ?? 0}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-sm">
                <span className="text-slate-500">⏳ Rendiciones en camino</span>
                <span className="font-bold" style={NUM}>
                  {feed?.panel_pendientes.rendiciones_en_camino ?? 0}
                </span>
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-[12.5px] font-bold text-slate-900">
                {esHoy ? "Hoy" : "El día"}
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-slate-500">Entradas</span>
                <span className="font-bold text-green-700" style={NUM}>
                  + {fmt(feed?.totales.entrada ?? 0)}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-sm">
                <span className="text-slate-500">Salidas</span>
                <span className="font-bold text-red-700" style={NUM}>
                  − {fmt(feed?.totales.salida ?? 0)}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-sm">
                <span className="font-semibold text-slate-700">Neto</span>
                <span className="font-bold" style={NUM}>
                  {fmt((feed?.totales.entrada ?? 0) - (feed?.totales.salida ?? 0))}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {pagoAConfirmar && (
        <ConfirmarDialog
          pago={pagoAConfirmar}
          usuarioId={usuarioId}
          onCerrar={() => setPagoAConfirmar(null)}
          onListo={() => {
            setPagoAConfirmar(null)
            cargar(fecha)
          }}
        />
      )}

      {rendicionAControlar && (
        <ControlarRendicion
          rendicionId={rendicionAControlar}
          cuentas={cuentas}
          onCerrar={() => setRendicionAControlar(null)}
          onListo={() => {
            setRendicionAControlar(null)
            cargar(fecha)
          }}
        />
      )}

      {pagoAImputar && (
        <ImputarPago
          pago={pagoAImputar}
          usuarioId={usuarioId}
          onCerrar={() => setPagoAImputar(null)}
          onListo={() => {
            setPagoAImputar(null)
            cargar(fecha)
          }}
        />
      )}

      {pagoAAnular && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPagoAAnular(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-slate-900">Anular recibo — {pagoAAnular.quien}</h3>
            <p className="mt-1 text-xs text-slate-500">
              Se revierten las imputaciones (los comprobantes vuelven a quedar con saldo), la plata
              sale de la caja/banco en el libro, y si había cheques quedan anulados. El recibo queda
              registrado como anulado en el historial.
            </p>
            <textarea
              value={motivoAnulacion}
              onChange={(e) => setMotivoAnulacion(e.target.value)}
              placeholder="Motivo (opcional) — ej. error en el monto, cheque rechazado"
              rows={2}
              className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={anularRecibo}
                disabled={anulando}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {anulando && <Loader2 className="h-4 w-4 animate-spin" />}
                Anular recibo
              </button>
              <button
                onClick={() => setPagoAAnular(null)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {cerrandoDia && feed?.arqueo.caja_chica_id && (
        <CerrarDia
          fecha={fecha}
          cajaChicaId={feed.arqueo.caja_chica_id}
          cajaChicaNombre={feed.arqueo.caja_chica_nombre ?? "Caja chica"}
          onCerrar={() => setCerrandoDia(false)}
          onListo={() => {
            setCerrandoDia(false)
            cargar(fecha)
          }}
        />
      )}
    </div>
  )
}
