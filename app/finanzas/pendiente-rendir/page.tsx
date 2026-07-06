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

  const confirmarRendicion = async (rendicionId: string) => {
    if (!cajaDestino) {
      toast({ variant: "destructive", title: "Elegí la caja destino del efectivo" })
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
          forzar_diferencia: Boolean(forzar[rendicionId]),
        }),
      })
      const d = await res.json()
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
                <div key={r.id} className="flex items-center justify-between border-2 border-amber-200 bg-amber-50/40 rounded-lg px-4 py-3">
                  <div>
                    <p className="font-medium">
                      {r.cobrador_nombre}
                      <Badge variant="outline" className="ml-2 capitalize">{r.cobrador_tipo}</Badge>
                      <span className="text-sm text-muted-foreground ml-2">
                        {new Date(r.fecha).toLocaleString("es-AR")} · {r.cantidad_pagos} pagos
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Efectivo declarado {fmt(r.efectivo_declarado)} · registrado {fmt(r.efectivo_registrado)}
                      {Math.abs(r.diferencia) > 0.01 && (
                        <span className="text-amber-700 font-semibold"> · diferencia {fmt(r.diferencia)}</span>
                      )}
                      {r.observaciones && ` · ${r.observaciones}`}
                    </p>
                  </div>
                  <Button
                    disabled={confirmandoRendicion === r.id || !cajaDestino}
                    variant={forzar[r.id] ? "destructive" : "default"}
                    onClick={() => confirmarRendicion(r.id)}
                  >
                    {confirmandoRendicion === r.id ? "..." : forzar[r.id] ? "Confirmar CON diferencia" : "✓ Confirmar rendición"}
                  </Button>
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
