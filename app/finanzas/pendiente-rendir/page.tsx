"use client"

import { useEffect, useState, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import { ArrowLeft, Wallet, RefreshCw, ShieldCheck, Inbox } from "lucide-react"
import Link from "next/link"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"

const fmt = (n: number) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 })

export default function PendienteRendirPage() {
  const { toast } = useToast()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [verificando, setVerificando] = useState<string | null>(null)
  const [confirmandoRendicion, setConfirmandoRendicion] = useState<string | null>(null)
  const [cajaDestino, setCajaDestino] = useState("")
  const [forzar, setForzar] = useState<Record<string, boolean>>({})
  // Pagos a cuenta con cheques en color PENDIENTE detectados al intentar
  // confirmar: la oficina elige BLANCO/NEGRO y se reintenta con ese color.
  const [pagosSinColor, setPagosSinColor] = useState<Record<string, string[]>>({})
  const [colorElegido, setColorElegido] = useState<Record<string, string>>({})
  // Control físico de la rendición: qué pagos la oficina verificó (cotejó la
  // plata / los cheques). Solo esos se confirman. Por defecto, todos tildados;
  // destildar = queda pendiente de rendir, no se pierde.
  const [noVerificados, setNoVerificados] = useState<Record<string, Set<string>>>({})
  const [abierta, setAbierta] = useState<Record<string, boolean>>({})
  const toggleVerificado = (rendId: string, pagoId: string) =>
    setNoVerificados((prev) => {
      const set = new Set(prev[rendId] || [])
      if (set.has(pagoId)) set.delete(pagoId)
      else set.add(pagoId)
      return { ...prev, [rendId]: set }
    })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/finanzas/pendiente-rendir")
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setData(d)
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  // Rechazar un cobro declarado (no llegó la plata / mal cargado / prueba):
  // nunca tocó libro ni caja, así que se descarta limpio. Si la rendición
  // queda sin pagos, se cancela sola.
  const [rechazando, setRechazando] = useState<string | null>(null)
  const rechazarPago = async (rendicionId: string, pago: any) => {
    const motivo = window.prompt(`Rechazar el cobro de ${pago.cliente} por ${fmt(pago.monto)}.\n¿Motivo?`)
    if (motivo === null) return
    if (!motivo.trim()) { toast({ variant: "destructive", title: "Indicá el motivo del rechazo" }); return }
    setRechazando(pago.id)
    try {
      const res = await fetch(`/api/finanzas/rendiciones/${rendicionId}/rechazar-pago`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pago_id: pago.id, motivo: motivo.trim() }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      toast({ title: "Pago rechazado", description: d.mensaje })
      load()
    } catch (e: any) {
      toast({ variant: "destructive", title: "No se pudo rechazar", description: e.message })
    } finally {
      setRechazando(null)
    }
  }

  const confirmarRendicion = async (rendicionId: string) => {
    if (!cajaDestino) {
      toast({ variant: "destructive", title: "Elegí la caja destino del efectivo" })
      return
    }
    const rend = (data?.rendiciones_declaradas || []).find((r: any) => r.id === rendicionId)
    const excluidos = noVerificados[rendicionId] || new Set<string>()
    const pagosVerificados: string[] = (rend?.pagos || []).map((p: any) => p.id).filter((id: string) => !excluidos.has(id))
    if (!pagosVerificados.length) {
      toast({ variant: "destructive", title: "No hay pagos verificados", description: "Tildá al menos un pago como cotejado para confirmar." })
      return
    }
    setConfirmandoRendicion(rendicionId)
    try {
      const res = await fetch(`/api/finanzas/rendiciones/${rendicionId}/confirmar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caja_destino_tipo: "CAJA",
          caja_destino_id: cajaDestino,
          // La oficina cotejó estos pagos (checklist del desglose): son los que
          // se confirman. Sin esto el RPC no encontraba "ningún pago verificado".
          pagos_verificados: pagosVerificados,
          forzar_diferencia: Boolean(forzar[rendicionId]),
          ...(colorElegido[rendicionId] && pagosSinColor[rendicionId]?.length
            ? {
                colores_cheque: Object.fromEntries(
                  pagosSinColor[rendicionId].map((pagoId) => [pagoId, colorElegido[rendicionId]]),
                ),
              }
            : {}),
        }),
      })
      const d = await res.json()
      if (res.status === 400 && Array.isArray(d.pagos_sin_color) && d.pagos_sin_color.length) {
        setPagosSinColor((prev) => ({ ...prev, [rendicionId]: d.pagos_sin_color }))
        toast({
          variant: "destructive",
          title: "Cheques sin color (pago a cuenta)",
          description: "Elegí BLANCO o NEGRO para esos cheques y volvé a confirmar.",
        })
        return
      }
      if (res.status === 409 && d.requiere_forzar) {
        setForzar((prev) => ({ ...prev, [rendicionId]: true }))
        toast({
          variant: "destructive",
          title: "Diferencia de efectivo",
          description: `${d.error}. Si es real, volvé a confirmar: queda documentada.`,
        })
        return
      }
      if (!res.ok) throw new Error(d.error)
      toast({
        title: `Rendición confirmada: ${d.confirmados} pagos`,
        description: `Efectivo a caja $${Number(d.efectivo_a_caja).toLocaleString("es-AR")}${d.a_conciliar ? ` · ${d.a_conciliar} transferencias a conciliar` : ""}`,
      })
      load()
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message })
    } finally {
      setConfirmandoRendicion(null)
    }
  }

  const verificar = async (pagoId: string) => {
    setVerificando(pagoId)
    try {
      const res = await fetch(`/api/pagos/${pagoId}/verificar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metodo: "arqueo" }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      toast({ title: "Pago verificado (segunda firma registrada)" })
      load()
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message })
    } finally {
      setVerificando(null)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/finanzas">
              <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold">Pendiente de rendir</h1>
              <p className="text-sm text-muted-foreground">
                Plata en la calle: {loading ? "…" : fmt(data?.total_en_calle ?? 0)}
              </p>
            </div>
          </div>
          <Button variant="outline" size="icon" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 space-y-8">
        {/* ── Rendiciones declaradas por viajantes (a confirmar) ── */}
        {(data?.rendiciones_declaradas?.length ?? 0) > 0 && (
          <section>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Inbox className="h-5 w-5 text-muted-foreground" />
              Rendiciones declaradas — esperando confirmación de oficina
            </h2>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm text-muted-foreground">Caja destino del efectivo:</span>
              <Select value={cajaDestino} onValueChange={setCajaDestino}>
                <SelectTrigger className="w-52"><SelectValue placeholder="Seleccionar caja…" /></SelectTrigger>
                <SelectContent>
                  {(data?.cajas || []).map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>{c.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              {data.rendiciones_declaradas.map((r: any) => (
                <div key={r.id} className="border-2 border-amber-200 bg-amber-50/40 rounded-lg px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">
                      {r.cobrador_nombre}
                      <Badge variant="outline" className="ml-2 capitalize">{r.cobrador_tipo}</Badge>
                      <span className="text-sm text-muted-foreground ml-2">
                        {new Date(r.fecha).toLocaleString("es-AR")} · {r.cantidad_pagos} pagos
                      </span>
                      <button
                        onClick={() => setAbierta((p) => ({ ...p, [r.id]: !p[r.id] }))}
                        className="ml-3 text-xs font-semibold text-blue-700 hover:underline"
                      >
                        {abierta[r.id] === false ? "▸ Ver desglose" : "▾ Ocultar desglose"}
                      </button>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Efectivo declarado {fmt(r.efectivo_declarado)} · registrado {fmt(r.efectivo_registrado)}
                      {Math.abs(r.diferencia) > 0.01 && (
                        <span className="text-amber-700 font-semibold"> · diferencia {fmt(r.diferencia)}</span>
                      )}
                      {r.observaciones && ` · ${r.observaciones}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {(pagosSinColor[r.id]?.length ?? 0) > 0 && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-amber-700 font-medium">Color cheques a cuenta:</span>
                        {["BLANCO", "NEGRO"].map((c) => (
                          <Button
                            key={c}
                            size="sm"
                            variant={colorElegido[r.id] === c ? "default" : "outline"}
                            onClick={() => setColorElegido((prev) => ({ ...prev, [r.id]: c }))}
                          >
                            {c}
                          </Button>
                        ))}
                      </div>
                    )}
                    <Button
                      disabled={
                        confirmandoRendicion === r.id ||
                        !cajaDestino ||
                        Boolean(pagosSinColor[r.id]?.length && !colorElegido[r.id])
                      }
                      variant={forzar[r.id] ? "destructive" : "default"}
                      onClick={() => confirmarRendicion(r.id)}
                    >
                      {confirmandoRendicion === r.id ? "..." : forzar[r.id] ? "Confirmar CON diferencia" : "✓ Confirmar rendición"}
                    </Button>
                  </div>
                </div>

                {/* ── Desglose para cotejar: pago por pago, medios, cheques, totales ── */}
                {abierta[r.id] !== false && (r.pagos?.length ?? 0) > 0 && (
                  <div className="mt-3 rounded-lg border bg-white">
                    <div className="grid grid-cols-[auto_1fr_1fr_1fr_auto] gap-x-3 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground border-b">
                      <span>Cotejado</span><span>Cliente / comprobantes</span><span>Cómo pagó</span><span>Detalle</span><span className="text-right">Monto</span>
                    </div>
                    {r.pagos.map((p: any) => {
                      const excluido = noVerificados[r.id]?.has(p.id)
                      return (
                        <div key={p.id} className={`grid grid-cols-[auto_1fr_1fr_1fr_auto] gap-x-3 px-3 py-2 text-sm border-b last:border-b-0 ${excluido ? "opacity-50" : ""}`}>
                          <label className="flex items-start pt-0.5">
                            <input type="checkbox" checked={!excluido} onChange={() => toggleVerificado(r.id, p.id)} className="h-4 w-4" />
                          </label>
                          <div className="min-w-0">
                            <p className="font-medium truncate">{p.cliente}</p>
                            <p className="text-xs text-muted-foreground">
                              {p.comprobantes.length
                                ? p.comprobantes.map((c: any) => `${c.numero} ${fmt(c.monto)}`).join(" · ")
                                : "a cuenta (sin imputar)"}
                              {p.observaciones ? ` · ${p.observaciones}` : ""}
                            </p>
                          </div>
                          <div className="text-xs">
                            {p.medios.map((m: any, i: number) => (
                              <p key={i} className="capitalize">{m.tipo} {fmt(m.monto)}</p>
                            ))}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {p.medios.map((m: any, i: number) => (
                              <p key={i}>
                                {m.tipo === "cheque" && `${m.banco || "—"} N° ${m.numero_cheque || "—"} · venc ${m.fecha_cheque ? m.fecha_cheque.split("-").reverse().join("/") : "—"}${m.color ? ` · ${m.color}` : ""}`}
                                {m.tipo === "transferencia" && `ref ${m.referencia || "—"}`}
                                {m.tipo === "efectivo" && "—"}
                              </p>
                            ))}
                          </div>
                          <div className="text-right">
                            <p className="font-semibold tabular-nums">{fmt(p.monto)}</p>
                            <button
                              type="button"
                              onClick={() => rechazarPago(r.id, p)}
                              disabled={rechazando === p.id || confirmandoRendicion === r.id}
                              className="text-[11px] text-red-600 hover:underline disabled:opacity-50"
                              title="No llegó la plata / mal cargado / prueba: el cobro se descarta y no entra a caja ni a la cuenta del cliente"
                            >
                              {rechazando === p.id ? "..." : "✕ Rechazar"}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-3 py-2 bg-slate-50 text-xs rounded-b-lg">
                      <span className="font-semibold uppercase tracking-wide text-muted-foreground">Totales a cotejar:</span>
                      {Object.entries(r.totales || {}).map(([tipo, t]: [string, any]) => (
                        <span key={tipo} className="capitalize">
                          {tipo}: <b className="tabular-nums">{fmt(t.monto)}</b>{tipo === "cheque" ? ` (${t.cantidad} cheque${t.cantidad === 1 ? "" : "s"})` : ""}
                        </span>
                      ))}
                      <span className="ml-auto">
                        Verificados: <b>{r.pagos.length - (noVerificados[r.id]?.size ?? 0)}</b> de {r.pagos.length}
                      </span>
                    </div>
                  </div>
                )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Por cobrador ── */}
        <section>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Wallet className="h-5 w-5 text-muted-foreground" /> Cobradores con plata en la calle
          </h2>
          {loading ? (
            <Card><CardContent className="py-12 animate-pulse bg-muted/30" /></Card>
          ) : !data?.cobradores?.length ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">
              Nadie tiene cobranzas sin rendir. 🎉
            </CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {data.cobradores.map((g: any) => (
                <Card key={g.cobrador_id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center justify-between">
                      <span>
                        {g.cobrador_nombre}
                        <Badge variant="outline" className="ml-2 capitalize">{g.cobrador_tipo}</Badge>
                      </span>
                      <span className="text-lg font-bold">{fmt(g.total)}</span>
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Billetera: {fmt(g.billetera_saldo)} · Efectivo {fmt(g.efectivo)} · Cheques {fmt(g.cheques)} · Transf. {fmt(g.transferencias)}
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-1.5">
                    {g.pagos.map((p: any) => (
                      <div key={p.id} className="flex items-center justify-between text-sm border rounded px-2.5 py-1.5">
                        <div className="min-w-0">
                          <p className="font-medium truncate">{p.cliente}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(p.fecha).toLocaleDateString("es-AR")}
                            {p.viaje && ` · ${p.viaje}`}
                          </p>
                        </div>
                        <div className="text-right shrink-0 ml-2">
                          <p className="font-semibold">{fmt(p.monto)}</p>
                          {p.viaje_id && (
                            <Link href={`/viajes/${p.viaje_id}/rendicion`} className="text-xs text-primary hover:underline">
                              Rendir viaje →
                            </Link>
                          )}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* ── Confirmados sin verificar (arqueo) ── */}
        <section>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-muted-foreground" />
            Confirmados sin segunda firma ({data?.sin_verificar?.length ?? 0})
          </h2>
          {!loading && !data?.sin_verificar?.length ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">
              Todo verificado. Las transferencias pendientes están en <Link className="text-primary hover:underline" href="/finanzas/conciliacion">Conciliación</Link>.
            </CardContent></Card>
          ) : (
            <div className="space-y-2">
              {(data?.sin_verificar || []).map((p: any) => (
                <div key={p.id} className="flex items-center justify-between border rounded-lg px-4 py-2.5 bg-blue-50/50">
                  <div>
                    <p className="font-medium text-sm">{p.cliente}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(p.fecha).toLocaleDateString("es-AR")} · {p.metodos.join(", ")} · {p.cobrador_tipo}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-bold">{fmt(p.monto)}</span>
                    <Button size="sm" variant="outline" disabled={verificando === p.id} onClick={() => verificar(p.id)}>
                      {verificando === p.id ? "..." : "✓ Verificar"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
