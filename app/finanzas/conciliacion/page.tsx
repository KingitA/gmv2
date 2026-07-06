"use client"

import { useEffect, useState, useCallback } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import { ArrowLeft, Landmark, RefreshCw, ExternalLink } from "lucide-react"
import Link from "next/link"

const fmt = (n: number) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 })

export default function ConciliacionPage() {
  const { toast } = useToast()
  const [items, setItems] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [conciliando, setConciliando] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/finanzas/conciliacion")
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setItems(d.items || [])
      setTotal(d.total || 0)
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  const conciliar = async (pagoId: string) => {
    setConciliando(pagoId)
    try {
      const res = await fetch("/api/finanzas/conciliacion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pago_id: pagoId }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      toast({ title: "Transferencia conciliada (segunda firma registrada)" })
      load()
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message })
    } finally {
      setConciliando(null)
    }
  }

  // Agrupar por cuenta destino
  const porCuenta = items.reduce((acc: Record<string, any[]>, i) => {
    ;(acc[i.cuenta_destino] = acc[i.cuenta_destino] || []).push(i)
    return acc
  }, {})

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/finanzas">
              <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold">Conciliación bancaria</h1>
              <p className="text-sm text-muted-foreground">
                Transferencias y e-cheqs a verificar contra extracto: {loading ? "…" : fmt(total)}
              </p>
            </div>
          </div>
          <Button variant="outline" size="icon" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 space-y-6">
        {loading ? (
          <Card><CardContent className="py-12 animate-pulse bg-muted/30" /></Card>
        ) : !items.length ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">
            No hay transferencias pendientes de conciliar. 🎉
          </CardContent></Card>
        ) : (
          Object.entries(porCuenta).map(([cuenta, lista]) => (
            <section key={cuenta}>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <Landmark className="h-5 w-5 text-muted-foreground" /> {cuenta}
                <span className="text-sm font-normal text-muted-foreground">
                  {fmt((lista as any[]).reduce((s, i) => s + i.monto_transferencias, 0))}
                </span>
              </h2>
              <div className="space-y-2">
                {(lista as any[]).map((i) => (
                  <div key={i.pago_id} className="flex items-center justify-between border rounded-lg px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{i.cliente}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(i.fecha).toLocaleDateString("es-AR")}
                        {i.viaje && ` · ${i.viaje}`}
                        <Badge variant="outline" className="ml-2 capitalize">{i.cobrador_tipo}</Badge>
                        {i.referencias.length > 0 && ` · Ref: ${i.referencias.join(", ")}`}
                      </p>
                      {i.fotos.length > 0 && (
                        <div className="flex gap-2 mt-1">
                          {i.fotos.map((url: string, x: number) => (
                            <a key={x} href={url} target="_blank" rel="noreferrer"
                               className="text-xs text-primary hover:underline flex items-center gap-0.5">
                              Comprobante {x + 1} <ExternalLink className="h-3 w-3" />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-3">
                      <div className="text-right">
                        <p className="font-bold">{fmt(i.monto_transferencias)}</p>
                        {i.monto_transferencias !== i.monto_pago && (
                          <p className="text-xs text-muted-foreground">de un pago de {fmt(i.monto_pago)}</p>
                        )}
                      </div>
                      <Button size="sm" disabled={conciliando === i.pago_id} onClick={() => conciliar(i.pago_id)}>
                        {conciliando === i.pago_id ? "..." : "✓ Acreditada"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))
        )}
      </main>
    </div>
  )
}
