"use client"

// Control diario de bancos (Tanda 5 del plan de bancos): por cuenta, saldo del banco contra el del
// sistema y todo lo que falta explicar, con el enlace a donde se resuelve. Y los cargos del banco
// (impuestos, comisiones, débitos automáticos, rendimientos) para pasar al libro de fondos.
// Solo admin (la API responde 403 a los demás).
import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { DateInputAR } from "@/components/ui/date-input-ar"
import { useConfirmar } from "@/components/ui/confirmar"
import { fecha, fechaHora, moneda } from "@/lib/formato"
import { cn } from "@/lib/utils"
import type { PanelControl } from "@/lib/bancos/control/servidor"
import type { Pendiente } from "@/lib/bancos/control/reglas"

const API = "/api/finanzas/control-bancos"

type Clave = Pendiente | "demorados" | "no_aparecieron"
const ITEMS: { clave: Clave; texto: string; href: string }[] = [
  { clave: "cargo", texto: "Cargos para registrar", href: "#cargos" },
  { clave: "sin_identificar", texto: "Créditos sin identificar", href: "/caja" },
  { clave: "propuesta_transferencia", texto: "Transferencias para confirmar", href: "/caja" },
  { clave: "no_aparecieron", texto: "Transferencias que no aparecieron", href: "/caja" },
  { clave: "propuesta_cheque", texto: "Cheques para aplicar", href: "/finanzas/cheques" },
  { clave: "rechazo", texto: "Rechazos para confirmar", href: "/finanzas/cheques" },
  { clave: "demorados", texto: "Cheques sin acreditar +96 h", href: "/finanzas/cheques" },
  { clave: "sugerido", texto: "Sugeridos sin conciliar", href: "/finanzas/conciliacion" },
  { clave: "debito", texto: "Débitos sin registrar", href: "/finanzas/conciliacion" },
  { clave: "credito", texto: "Créditos sin conciliar", href: "/finanzas/conciliacion" },
]
const TEXTO = Object.fromEntries(ITEMS.map((i) => [i.clave, i])) as Record<Clave, (typeof ITEMS)[number]>

type CuentaCtl = PanelControl["cuentas"][number]
const valor = (c: CuentaCtl, k: Clave) => (k === "demorados" ? c.demorados : k === "no_aparecieron" ? c.no_aparecieron : c.pendientes[k])

export default function ControlBancosPage() {
  const [panel, setPanel] = useState<PanelControl | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [abierta, setAbierta] = useState<string | null>(null)
  const [verCargos, setVerCargos] = useState(false)
  const { confirmar, dialogo } = useConfirmar()

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const r = await fetch(API)
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error ?? (r.status === 403 ? "Solo para administradores" : "No se pudo cargar"))
      setPanel(d); setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCargando(false)
    }
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const accion = async (clave: string, body: Record<string, unknown>, ok?: (d: Record<string, any>) => string) => {
    setOcupado(clave)
    try {
      const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(d.error ?? "No se pudo"); return }
      if (ok) toast.success(ok(d))
      if (d.errores?.length) toast.error(`${d.errores.length} con error: ${d.errores[0]}`)
      await cargar()
    } finally {
      setOcupado(null)
    }
  }

  // Cargos agrupados por cuenta y concepto
  const grupos = useMemo(() => {
    const m = new Map<string, { cuenta: string; concepto: string; ingreso: boolean; cantidad: number; total: number }>()
    for (const c of panel?.cargos ?? []) {
      const k = `${c.cuenta_bancaria_id}|${c.concepto_id}|${c.cargo.tipo}`
      const g = m.get(k) ?? { cuenta: c.cuenta, concepto: c.concepto, ingreso: c.cargo.tipo === "ingreso", cantidad: 0, total: 0 }
      g.cantidad++; g.total += c.monto
      m.set(k, g)
    }
    return [...m.values()].sort((a, b) => a.cuenta.localeCompare(b.cuenta) || a.total - b.total)
  }, [panel])

  const registrarTodo = async () => {
    if (!panel) return
    const egresos = panel.cargos.filter((c) => c.monto < 0).reduce((t, c) => t - c.monto, 0)
    const ingresos = panel.cargos.filter((c) => c.monto > 0).reduce((t, c) => t + c.monto, 0)
    const si = await confirmar({
      titulo: `¿Registrar ${panel.cargos.length} cargos del banco?`,
      detalle: `Egresos ${moneda(egresos)} · ingresos ${moneda(ingresos)}\nBaja / sube el saldo del sistema de cada banco.`,
      confirmar: "Registrar todo",
    })
    if (!si) return
    await accion("registrar", { accion: "registrar" }, (d) => `Registrados ${d.registrados}${d.quedan ? ` · quedan ${d.quedan}` : ""}`)
  }

  const t = panel?.totales

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-3 px-4 py-4 sm:px-6">
      {dialogo}
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/finanzas/conciliacion" className="text-neutro-500 hover:text-azul-800"><ArrowLeft className="h-5 w-5" /></Link>
        <h1 className="mr-2 text-2xl font-bold tracking-tight text-azul-900">Control de bancos</h1>
        {t && (t.total === 0
          ? <span className="inline-flex items-center gap-1 text-sm text-exito-700"><CheckCircle2 className="h-4 w-4" /> Todo explicado</span>
          : <span className="text-sm text-neutro-600">{t.total} sin explicar</span>)}
        <Button variant="outline" size="sm" className="ml-auto" disabled={cargando} onClick={cargar}>
          <RefreshCw className={cn("h-3.5 w-3.5", cargando && "animate-spin")} /> Actualizar
        </Button>
      </div>

      {error && <p className="rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700">{error}</p>}
      {panel?.avisos.map((a) => <p key={a} className="rounded-lg bg-ambar-50 px-3 py-1.5 text-[13px] text-ambar-800">{a}</p>)}

      {panel && (
        <div className="overflow-x-auto rounded-2xl border border-neutro-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutro-50 text-left text-[12px] uppercase text-neutro-500">
              <tr>
                <th className="px-3 py-2">Banco</th>
                <th className="px-3 py-2 text-right">Banco</th>
                <th className="px-3 py-2 text-right">Sistema</th>
                <th className="px-3 py-2 text-right">Diferencia</th>
                <th className="px-3 py-2">Actualizado</th>
                <th className="px-3 py-2">Sin explicar</th>
              </tr>
            </thead>
            <tbody>
              {panel.cuentas.map((c) => (
                <Fragment key={c.id}>
                  <tr className="border-t border-neutro-100 align-top">
                    <td className="px-3 py-2 font-semibold text-azul-900">
                      <button type="button" className="flex items-center gap-1" onClick={() => setAbierta((a) => (a === c.id ? null : c.id))} disabled={!c.movimientos.length}>
                        {c.movimientos.length > 0 && <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", abierta === c.id && "rotate-180")} />}
                        {c.nombre}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {c.saldo_banco == null ? <span className="text-neutro-400">—</span> : moneda(c.saldo_banco)}
                      {c.saldo_banco_al && <div className="text-[11px] text-neutro-500">{fechaHora(c.saldo_banco_al)}</div>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{moneda(c.saldo_sistema)}</td>
                    <td className={cn("px-3 py-2 text-right font-semibold tabular-nums",
                      c.diferencia == null ? "text-neutro-400" : Math.abs(c.diferencia) < 1 ? "text-exito-700" : "text-error-700")}>
                      {c.diferencia == null ? "—" : moneda(c.diferencia)}
                    </td>
                    <td className="px-3 py-2">
                      {c.actualizado_hoy
                        ? <span className="text-neutro-700">{fechaHora(c.actualizado_at)}</span>
                        : <Link href="/finanzas/conciliacion" className="inline-flex items-center gap-1 text-ambar-700 hover:underline">
                            <AlertTriangle className="h-3.5 w-3.5" /> {c.actualizado_at ? fechaHora(c.actualizado_at) : "Nunca"}
                          </Link>}
                    </td>
                    <td className="px-3 py-2">
                      {c.al_dia ? <span className="text-exito-700">Al día</span> : (
                        <div className="flex flex-wrap gap-1">
                          {ITEMS.filter((i) => valor(c, i.clave).cantidad > 0).map((i) => (
                            <Link key={i.clave} href={i.href} onClick={i.clave === "cargo" ? () => setVerCargos(true) : undefined}
                              className="rounded-full border border-neutro-200 bg-neutro-50 px-2 py-0.5 text-[12px] text-neutro-700 hover:bg-azul-50"
                              title={moneda(valor(c, i.clave).monto)}>
                              {i.texto} <b>{valor(c, i.clave).cantidad}</b>
                            </Link>
                          ))}
                          {c.total === 0 && <span className="text-[12px] text-neutro-500">Nada pendiente</span>}
                        </div>
                      )}
                    </td>
                  </tr>
                  {abierta === c.id && (
                    <tr className="bg-neutro-50/60">
                      <td colSpan={6} className="px-3 py-2">
                        <ul className="space-y-0.5 text-[13px]">
                          {c.movimientos.map((m) => (
                            <li key={m.id} className="flex flex-wrap gap-x-2">
                              <span className="w-20 text-neutro-500">{fecha(m.fecha)}</span>
                              <span className={cn("w-28 text-right tabular-nums", m.monto > 0 ? "text-exito-700" : "")}>{moneda(m.monto)}</span>
                              <span className="flex-1 truncate text-neutro-700">{m.texto || "—"}</span>
                              <Link href={TEXTO[m.pendiente].href} className="text-azul-700 hover:underline">{TEXTO[m.pendiente].texto}</Link>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {!panel.cuentas.length && <tr><td colSpan={6} className="px-3 py-4 text-center text-neutro-500">Sin cuentas bancarias activas</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {panel?.instalado && (
        <div id="cargos" className="rounded-2xl border border-neutro-200 bg-white px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <button type="button" className="flex items-center gap-1 font-semibold text-azul-900" onClick={() => setVerCargos((v) => !v)}>
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", verCargos && "rotate-180")} />
              Cargos del banco al libro {panel.cargos.length > 0 && <span className="font-normal text-neutro-600">· {panel.cargos.length}</span>}
            </button>
            <label className="flex items-center gap-1.5 text-[13px] text-neutro-600">
              Desde
              <DateInputAR className="h-8 w-32" value={panel.ajustes.desde_efectivo}
                onChange={(v) => { if (v && v !== panel.ajustes.desde_efectivo) accion("desde", { accion: "desde", desde: v }) }} />
            </label>
            <div className="ml-auto flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[13px] text-neutro-600" title="Prendido: solo lista lo que registraría">
                <Switch checked={panel.ajustes.modo_propuesta} disabled={ocupado === "modo"}
                  onCheckedChange={(v) => accion("modo", { accion: "modo", propuesta: v })} />
                Modo propuesta
              </label>
              <Button size="sm" disabled={!!ocupado || !panel.cargos.length} onClick={registrarTodo}>
                <RefreshCw className={cn("h-3.5 w-3.5", ocupado === "registrar" && "animate-spin")} /> Registrar todo
              </Button>
            </div>
          </div>
          {verCargos && (
            grupos.length ? (
              <table className="mt-2 w-full text-[13px]">
                <tbody>
                  {grupos.map((g) => (
                    <tr key={`${g.cuenta}|${g.concepto}|${g.ingreso}`} className="border-t border-neutro-100">
                      <td className="py-1 pr-2 text-neutro-600">{g.cuenta}</td>
                      <td className="py-1 pr-2">{g.concepto}{g.ingreso && <span className="text-exito-700"> (ingreso)</span>}</td>
                      <td className="py-1 pr-2 text-right text-neutro-500">{g.cantidad}</td>
                      <td className={cn("py-1 text-right tabular-nums", g.ingreso && "text-exito-700")}>{moneda(g.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="mt-1 text-[13px] text-neutro-500">Nada para registrar.</p>
          )}
        </div>
      )}
    </div>
  )
}
