"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { ArrowLeft, RefreshCw, Lock, Banknote, ShieldCheck, CheckCircle2 } from "lucide-react"
import Link from "next/link"
import { FechaInput } from "@/components/finanzas/fecha-input"
import { todayArgentina, formatDateAR } from "@/lib/utils"

// Regla del sistema: el punto delimita centavos → "1000.5" = $1.000,50
const parseMonto = (raw: string): number | null => {
  const limpio = raw.trim().replace(",", ".")
  if (!limpio || !/^\d+(\.\d{0,2})?$/.test(limpio)) return null
  return Number(limpio)
}
const fmt = (n: number) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2, maximumFractionDigits: 2 })

const BILLETES = [20000, 10000, 2000, 1000, 500, 200, 100]

type Caja = { cuenta_id: string; nombre: string; saldos: { BLANCO: number; NEGRO: number } }
// El "color" (blanco/negro) es una categorización de CHEQUES, no de cajas.
// El ledger interno guarda los saldos de caja bajo BLANCO; la UI no lo expone.

export default function CierresCajaPage() {
  const { toast } = useToast()
  const [fecha, setFecha] = useState(todayArgentina())
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  // Wizard
  const [cierreId, setCierreId] = useState<string | null>(null)
  const [caja, setCaja] = useState<Caja | null>(null)
  const [paso, setPaso] = useState<1 | 2 | 3>(1)
  const [desglose, setDesglose] = useState<Record<number, string>>({})
  const [contadoTexto, setContadoTexto] = useState("")
  const [contadoManual, setContadoManual] = useState(false)
  const [seleccion, setSeleccion] = useState<Record<string, boolean>>({})
  const [notas, setNotas] = useState("")
  const [confirmando, setConfirmando] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/finanzas/cierres?fecha=${fecha}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setData(d)
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message })
    } finally {
      setLoading(false)
    }
  }, [fecha, toast])

  useEffect(() => { load() }, [load])

  const resetWizard = () => {
    setCierreId(null); setCaja(null); setPaso(1)
    setDesglose({}); setContadoTexto(""); setContadoManual(false)
    setSeleccion({}); setNotas("")
  }

  const sumaDesglose = useMemo(
    () => BILLETES.reduce((acc, b) => acc + b * (parseInt(desglose[b] || "0", 10) || 0), 0),
    [desglose]
  )
  const contado = contadoManual ? parseMonto(contadoTexto) : sumaDesglose
  const teorico = caja ? caja.saldos.BLANCO : 0
  const diferencia = contado === null ? null : contado - teorico

  // Pagos del día sin segunda firma: efectivo y cheque marcados por defecto;
  // transferencias/depósitos quedan para la conciliación bancaria.
  const pagos = data?.pagos_sin_verificar || []
  useEffect(() => {
    if (!cierreId) return
    const sel: Record<string, boolean> = {}
    for (const p of pagos) {
      const medios = (p.pagos_detalle || []).map((d: any) => d.tipo_pago)
      sel[p.id] = medios.some((m: string) => m === "efectivo" || m === "cheque")
    }
    setSeleccion(sel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cierreId])

  const abrir = async (c: Caja) => {
    try {
      const res = await fetch("/api/finanzas/cierres", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "abrir", fecha, cuenta_id: c.cuenta_id }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setCaja(c); setCierreId(d.cierre_id); setPaso(1)
      if (d.ya_abierto) toast({ title: "Cierre ya abierto — se retoma" })
    } catch (e: any) {
      toast({ variant: "destructive", title: "No se pudo abrir el cierre", description: e.message })
    }
  }

  const confirmar = async () => {
    if (contado === null) {
      toast({ variant: "destructive", title: "Monto contado inválido", description: "Usá punto para los centavos: 1000.5 = $1.000,50" })
      return
    }
    setConfirmando(true)
    try {
      const desgloseJson: Record<string, number> = {}
      for (const b of BILLETES) {
        const n = parseInt(desglose[b] || "0", 10) || 0
        if (n > 0) desgloseJson[String(b)] = n
      }
      const res = await fetch("/api/finanzas/cierres", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "confirmar",
          cierre_id: cierreId,
          saldo_contado: contado,
          desglose: Object.keys(desgloseJson).length ? desgloseJson : null,
          pago_ids: Object.entries(seleccion).filter(([, v]) => v).map(([id]) => id),
          notas: notas || null,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      const omitidos = Array.isArray(d.pagos_omitidos) ? d.pagos_omitidos.length : 0
      toast({
        title: `Cierre confirmado — ${d.pagos_verificados} pagos verificados`,
        description:
          `${Number(d.diferencia) === 0 ? "Sin diferencia de arqueo." : `Diferencia ${fmt(Number(d.diferencia))} registrada como ajuste auditado.`}` +
          (omitidos ? ` ${omitidos} pagos omitidos (revisar: firma propia u otro motivo).` : ""),
      })
      resetWizard()
      load()
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error al confirmar", description: e.message })
    } finally {
      setConfirmando(false)
    }
  }

  const cierresHoy = data?.cierres || []
  const cierreDe = (cuentaId: string) =>
    cierresHoy.find((c: any) => c.cuenta_id === cuentaId)

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/finanzas">
              <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold">Cierre de caja</h1>
              <p className="text-sm text-muted-foreground">Arqueo diario con verificación en lote y diferencia auditada</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <FechaInput value={fecha} onChange={(iso) => { if (iso) { setFecha(iso); resetWizard() } }} />
            <Button variant="outline" size="icon" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 space-y-8">
        {/* ── Selección de caja ── */}
        {!cierreId && (
          <section>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Banknote className="h-5 w-5 text-muted-foreground" /> Elegí la caja a cerrar — {formatDateAR(fecha)}
            </h2>
            {loading ? (
              <Card><CardContent className="py-12 animate-pulse bg-muted/30" /></Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(data?.cajas || []).map((c: Caja) => {
                  const hecho = cierreDe(c.cuenta_id)
                  return (
                    <Card key={c.cuenta_id}>
                      <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-semibold text-lg">{c.nombre}</p>
                            <p className="text-sm text-muted-foreground">
                              Saldo del sistema: <span className="font-medium tabular-nums text-foreground">{fmt(c.saldos.BLANCO)}</span>
                            </p>
                          </div>
                          {hecho?.estado === "CONFIRMADO" ? (
                            <Badge className="bg-green-100 text-green-800">
                              <CheckCircle2 className="h-3 w-3 mr-1" /> Cerrada
                              {Number(hecho.diferencia) !== 0 && ` (dif ${fmt(Number(hecho.diferencia))})`}
                            </Badge>
                          ) : (
                            <Button size="sm" onClick={() => abrir(c)}>
                              {hecho ? "Retomar cierre" : "Iniciar cierre"}
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </section>
        )}

        {/* ── Wizard ── */}
        {cierreId && caja && (
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Lock className="h-5 w-5 text-muted-foreground" />
                Cierre {caja.nombre} — {formatDateAR(fecha)}
              </h2>
              <Button variant="ghost" size="sm" onClick={resetWizard}>Cancelar</Button>
            </div>

            <div className="flex items-center gap-3 text-sm">
              {[1, 2, 3].map((n) => (
                <div key={n} className={`flex items-center gap-2 ${paso === n ? "font-semibold" : "text-muted-foreground"}`}>
                  <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${paso >= n ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{n}</span>
                  {n === 1 ? "Conteo físico" : n === 2 ? "Verificar cobranzas" : "Confirmar"}
                </div>
              ))}
            </div>

            {/* Paso 1: conteo */}
            {paso === 1 && (
              <Card>
                <CardContent className="pt-6 space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                    {BILLETES.map((b) => (
                      <div key={b}>
                        <p className="text-xs text-muted-foreground mb-1">$ {b.toLocaleString("es-AR")}</p>
                        <Input
                          inputMode="numeric"
                          placeholder="0"
                          value={desglose[b] || ""}
                          onChange={(e) => {
                            const v = e.target.value.replace(/\D/g, "")
                            setDesglose((prev) => ({ ...prev, [b]: v }))
                            setContadoManual(false)
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-end gap-4 pt-2 border-t">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Total contado (punto = centavos: 1000.5 → $1.000,50)</p>
                      <Input
                        className="w-48 tabular-nums"
                        inputMode="decimal"
                        value={contadoManual ? contadoTexto : String(sumaDesglose || "")}
                        placeholder="0"
                        onChange={(e) => { setContadoManual(true); setContadoTexto(e.target.value) }}
                      />
                    </div>
                    <div className="text-sm space-y-1">
                      <p>Contado: <span className="font-semibold tabular-nums">{contado === null ? "—" : fmt(contado)}</span></p>
                      <p className="text-muted-foreground">Teórico (sistema): <span className="tabular-nums">{fmt(teorico)}</span></p>
                    </div>
                    <Button className="ml-auto" disabled={contado === null} onClick={() => setPaso(2)}>Siguiente →</Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Paso 2: verificación en lote */}
            {paso === 2 && (
              <Card>
                <CardContent className="pt-6 space-y-3">
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4" />
                    Cobranzas confirmadas del día sin segunda firma. Las transferencias conviene dejarlas para la conciliación bancaria.
                  </p>
                  {!pagos.length ? (
                    <p className="text-sm text-muted-foreground py-4">No hay cobranzas sin verificar para el {formatDateAR(fecha)}.</p>
                  ) : (
                    <div className="space-y-2">
                      {pagos.map((p: any) => (
                        <label key={p.id} className="flex items-center justify-between border rounded-lg px-3 py-2 cursor-pointer hover:bg-muted/40">
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={Boolean(seleccion[p.id])}
                              onChange={(e) => setSeleccion((prev) => ({ ...prev, [p.id]: e.target.checked }))}
                            />
                            <div>
                              <p className="font-medium">{p.clientes?.nombre ?? p.cliente_id}</p>
                              <p className="text-xs text-muted-foreground">
                                {(p.pagos_detalle || []).map((d: any) =>
                                  `${d.tipo_pago}${d.color_cheque ? ` ${d.color_cheque}` : ""} ${fmt(Number(d.monto))}`
                                ).join(" · ") || "sin detalle"}
                                {p.cobrador_tipo !== "oficina" && ` · ${p.cobrador_tipo}`}
                              </p>
                            </div>
                          </div>
                          <span className="font-semibold tabular-nums">{fmt(Number(p.monto))}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-between pt-2">
                    <Button variant="outline" onClick={() => setPaso(1)}>← Volver</Button>
                    <Button onClick={() => setPaso(3)}>
                      Siguiente → ({Object.values(seleccion).filter(Boolean).length} a verificar)
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Paso 3: confirmación */}
            {paso === 3 && (
              <Card>
                <CardContent className="pt-6 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                    <div className="border rounded-lg p-3">
                      <p className="text-xs text-muted-foreground">Saldo teórico</p>
                      <p className="text-xl font-bold tabular-nums">{fmt(teorico)}</p>
                    </div>
                    <div className="border rounded-lg p-3">
                      <p className="text-xs text-muted-foreground">Contado físico</p>
                      <p className="text-xl font-bold tabular-nums">{contado === null ? "—" : fmt(contado)}</p>
                    </div>
                    <div className={`border rounded-lg p-3 ${diferencia ? "border-red-300 bg-red-50/50" : "border-green-300 bg-green-50/50"}`}>
                      <p className="text-xs text-muted-foreground">Diferencia</p>
                      <p className={`text-xl font-bold tabular-nums ${diferencia ? "text-red-700" : "text-green-700"}`}>
                        {diferencia === null ? "—" : fmt(diferencia)}
                      </p>
                    </div>
                  </div>
                  {diferencia !== null && diferencia !== 0 && (
                    <p className="text-sm text-amber-700">
                      La diferencia se registra en el kardex como ajuste auditado (quién, cuándo y por qué) y el saldo queda fijado al contado.
                    </p>
                  )}
                  <Textarea
                    placeholder="Notas del cierre (opcional) — ej. motivo de la diferencia"
                    value={notas}
                    onChange={(e) => setNotas(e.target.value)}
                  />
                  <div className="flex justify-between">
                    <Button variant="outline" onClick={() => setPaso(2)}>← Volver</Button>
                    <Button disabled={confirmando} onClick={confirmar}>
                      {confirmando ? "Confirmando…" : "✓ Confirmar cierre"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </section>
        )}

        {/* ── Historial ── */}
        <section>
          <h2 className="text-lg font-semibold mb-3">Últimos cierres</h2>
          {!data?.historial?.length ? (
            <p className="text-sm text-muted-foreground">Todavía no hay cierres confirmados.</p>
          ) : (
            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left">
                    <th className="px-3 py-2 font-medium">Fecha</th>
                    <th className="px-3 py-2 font-medium">Caja</th>
                    <th className="px-3 py-2 font-medium text-right">Teórico</th>
                    <th className="px-3 py-2 font-medium text-right">Contado</th>
                    <th className="px-3 py-2 font-medium text-right">Diferencia</th>
                    <th className="px-3 py-2 font-medium text-right">Verificados</th>
                  </tr>
                </thead>
                <tbody>
                  {data.historial.map((h: any) => (
                    <tr key={h.id} className="border-b last:border-0">
                      <td className="px-3 py-2">{formatDateAR(h.fecha)}</td>
                      <td className="px-3 py-2">{(data?.cajas || []).find((c: Caja) => c.cuenta_id === h.cuenta_id)?.nombre ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(Number(h.saldo_teorico))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(Number(h.saldo_contado))}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${Number(h.diferencia) !== 0 ? "text-red-700 font-semibold" : ""}`}>
                        {fmt(Number(h.diferencia))}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{h.pagos_verificados}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
