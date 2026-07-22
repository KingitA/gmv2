"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import { ArrowLeft, Landmark, RefreshCw, ExternalLink, Upload, Wand2 } from "lucide-react"
import Link from "next/link"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { ImportExtractoDialog } from "@/components/finanzas/import-extracto-dialog"
import { formatDateAR } from "@/lib/utils"

const fmt = (n: number) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2, maximumFractionDigits: 2 })

const CATEGORIAS = ["IMPUESTOS", "OPERATIVO", "SUELDOS", "INVERSION", "CREDITO", "OTROS"]

const ESTADO_BADGE: Record<string, { label: string; cls: string }> = {
  PENDIENTE: { label: "Sin match", cls: "bg-amber-100 text-amber-800" },
  SUGERIDO: { label: "Sugerido", cls: "bg-sky-100 text-sky-800" },
  CONCILIADO: { label: "Conciliado", cls: "bg-green-100 text-green-800" },
  REGISTRADO_EGRESO: { label: "Egreso registrado", cls: "bg-violet-100 text-violet-800" },
  REGISTRADO_INGRESO: { label: "Ingreso registrado", cls: "bg-emerald-100 text-emerald-800" },
  IGNORADO: { label: "Ignorado", cls: "bg-slate-100 text-slate-600" },
}

export default function ConciliacionPage() {
  const { toast } = useToast()

  // ── Extracto bancario ──
  const [bancos, setBancos] = useState<{ cuenta_id: string; nombre: string }[]>([])
  const [cuentaId, setCuentaId] = useState("")
  const [movs, setMovs] = useState<any[]>([])
  const [loadingMovs, setLoadingMovs] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [accionando, setAccionando] = useState<string | null>(null)
  const [categorias, setCategorias] = useState<Record<string, string>>({})

  // ── Transferencias declaradas (flujo existente) ──
  const [items, setItems] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [conciliando, setConciliando] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/finanzas/cajas")
      .then((r) => r.json())
      .then((d) => {
        const bs = (d.cuentas || []).filter((c: any) => c.cuenta_tipo === "BANCO")
        setBancos(bs)
        if (bs.length && !cuentaId) setCuentaId(bs[0].cuenta_id)
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadMovs = useCallback(async () => {
    if (!cuentaId) return
    setLoadingMovs(true)
    try {
      const res = await fetch(`/api/finanzas/extractos?pendientes=1&cuenta_id=${cuentaId}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setMovs(d.movimientos || [])
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message })
    } finally {
      setLoadingMovs(false)
    }
  }, [cuentaId, toast])

  useEffect(() => { loadMovs() }, [loadMovs])

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

  const accion = async (body: any, okMsg: string) => {
    setAccionando(body.mov_id ?? "lote")
    try {
      const res = await fetch("/api/finanzas/extractos/acciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      if (body.action === "conciliar_lote" && d.errores?.length) {
        toast({
          title: `${d.conciliados} conciliados`,
          description: `${d.errores.length} fallaron (ej.: ${d.errores[0].error})`,
        })
      } else {
        toast({ title: okMsg })
      }
      loadMovs()
      load()
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message })
    } finally {
      setAccionando(null)
    }
  }

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

  const sugeridos = useMemo(() => movs.filter((m) => m.estado_matching === "SUGERIDO"), [movs])
  const pendientes = useMemo(() => movs.filter((m) => m.estado_matching === "PENDIENTE"), [movs])
  const cuentaNombre = bancos.find((b) => b.cuenta_id === cuentaId)?.nombre ?? ""

  const porCuenta = items.reduce((acc: Record<string, any[]>, i) => {
    ;(acc[i.cuenta_destino] = acc[i.cuenta_destino] || []).push(i)
    return acc
  }, {})

  const matchLabel = (m: any) => {
    if (m.pagos_clientes) {
      return `Cobranza ${m.pagos_clientes.clientes?.nombre ?? ""} ${fmt(Number(m.pagos_clientes.monto))}`
    }
    if (m.kardex_contable) {
      return `${m.kardex_contable.tipo_movimiento} — ${m.kardex_contable.concepto ?? ""} ${fmt(Number(m.kardex_contable.monto))}`
    }
    return null
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
              <h1 className="text-2xl font-bold">Conciliación bancaria</h1>
              <p className="text-sm text-muted-foreground">
                Extracto del banco contra el sistema · transferencias sin verificar: {loading ? "…" : fmt(total)}
              </p>
            </div>
          </div>
          <Button variant="outline" size="icon" onClick={() => { loadMovs(); load() }} disabled={loading || loadingMovs}>
            <RefreshCw className={`h-4 w-4 ${loading || loadingMovs ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 space-y-10">
        {/* ══ Extracto bancario ══ */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Landmark className="h-5 w-5 text-muted-foreground" /> Extracto bancario
            </h2>
            <Select value={cuentaId} onValueChange={setCuentaId}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Cuenta…" /></SelectTrigger>
              <SelectContent>
                {bancos.map((b) => (
                  <SelectItem key={b.cuenta_id} value={b.cuenta_id}>{b.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => setImportOpen(true)} disabled={!cuentaId}>
              <Upload className="h-4 w-4 mr-2" /> Importar extracto
            </Button>
            {cuentaNombre.toLowerCase().includes("mercado") && (
              <Button variant="outline" disabled={accionando !== null}
                onClick={async () => {
                  setAccionando("mp-sync")
                  try {
                    const res = await fetch("/api/finanzas/extractos/mp", { method: "POST" })
                    const d = await res.json()
                    if (!res.ok) throw new Error(d.error)
                    toast({ title: `MP sincronizado: ${d.importados ?? 0} nuevos, ${d.matching?.sugeridos ?? 0} sugeridos` })
                    loadMovs()
                  } catch (e: any) {
                    toast({ variant: "destructive", title: "Error MP", description: e.message })
                  } finally {
                    setAccionando(null)
                  }
                }}>
                <RefreshCw className="h-4 w-4 mr-2" /> Sincronizar MP
              </Button>
            )}
            {pendientes.length > 0 && (
              <Button variant="ghost" disabled={accionando !== null}
                onClick={async () => {
                  const extractoIds = [...new Set(pendientes.map((m) => m.extracto_id))]
                  for (const id of extractoIds) {
                    await accion({ action: "rematchear", extracto_id: id }, "Matching actualizado")
                  }
                }}>
                <Wand2 className="h-4 w-4 mr-2" /> Re-matchear
              </Button>
            )}
            {sugeridos.length > 1 && (
              <Button
                onClick={() => accion(
                  { action: "conciliar_lote", mov_ids: sugeridos.map((m) => m.id) },
                  `${sugeridos.length} movimientos conciliados`
                )}
                disabled={accionando !== null}
              >
                <Wand2 className="h-4 w-4 mr-2" /> Conciliar {sugeridos.length} sugeridos
              </Button>
            )}
          </div>

          {loadingMovs ? (
            <Card><CardContent className="py-12 animate-pulse bg-muted/30" /></Card>
          ) : !movs.length ? (
            <Card><CardContent className="py-10 text-center text-muted-foreground">
              No hay movimientos de extracto sin resolver en {cuentaNombre || "esta cuenta"}. Importá un extracto para arrancar.
            </CardContent></Card>
          ) : (
            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left">
                    <th className="px-3 py-2 font-medium">Fecha</th>
                    <th className="px-3 py-2 font-medium">Extracto del banco</th>
                    <th className="px-3 py-2 font-medium text-right">Monto</th>
                    <th className="px-3 py-2 font-medium">Match en sistema</th>
                    <th className="px-3 py-2 font-medium text-right">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {movs.map((m) => {
                    const badge = ESTADO_BADGE[m.estado_matching]
                    const label = matchLabel(m)
                    const esDebito = Number(m.monto) < 0
                    return (
                      <tr key={m.id} className="border-b last:border-0 align-top">
                        <td className="px-3 py-2 whitespace-nowrap">{formatDateAR(m.fecha)}</td>
                        <td className="px-3 py-2 max-w-[280px]">
                          <p className="truncate">{m.descripcion || "—"}</p>
                          {m.referencia_externa && !m.referencia_externa.startsWith("h:") && (
                            <p className="text-xs text-muted-foreground">Ref {m.referencia_externa}</p>
                          )}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap font-medium ${esDebito ? "text-red-700" : "text-green-700"}`}>
                          {fmt(Number(m.monto))}
                        </td>
                        <td className="px-3 py-2">
                          <Badge className={badge.cls}>{badge.label}</Badge>
                          {label && <p className="text-xs text-muted-foreground mt-1 max-w-[260px] truncate">{label}</p>}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-2 flex-wrap">
                            {m.estado_matching === "SUGERIDO" && (
                              <Button size="sm" disabled={accionando !== null}
                                onClick={() => accion({ action: "conciliar", mov_id: m.id }, "Movimiento conciliado")}>
                                {accionando === m.id ? "…" : "✓ Conciliar"}
                              </Button>
                            )}
                            {m.estado_matching === "PENDIENTE" && !esDebito && (
                              <Button size="sm" variant="outline" disabled={accionando !== null}
                                onClick={() => accion(
                                  { action: "ingreso", mov_id: m.id },
                                  "Ingreso registrado (kardex + saldo)"
                                )}>
                                {accionando === m.id ? "…" : "Registrar ingreso"}
                              </Button>
                            )}
                            {m.estado_matching === "PENDIENTE" && esDebito && (
                              <>
                                <Select
                                  value={categorias[m.id] ?? m.categoria_sugerida ?? "OTROS"}
                                  onValueChange={(v) => setCategorias((p) => ({ ...p, [m.id]: v }))}
                                >
                                  <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {CATEGORIAS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                                <Button size="sm" variant="outline" disabled={accionando !== null}
                                  onClick={() => accion(
                                    { action: "egreso", mov_id: m.id, categoria: categorias[m.id] ?? m.categoria_sugerida ?? "OTROS" },
                                    "Egreso registrado (kardex + saldo)"
                                  )}>
                                  {accionando === m.id ? "…" : "Registrar egreso"}
                                </Button>
                              </>
                            )}
                            <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={accionando !== null}
                              onClick={() => accion({ action: "ignorar", mov_id: m.id }, "Movimiento ignorado")}>
                              Ignorar
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {pendientes.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Los créditos sin match suelen ser transferencias de clientes sin cobranza cargada: cargala en Cobranzas y después
              tocá "Re-matchear" para que el sistema los vincule.
            </p>
          )}
        </section>

        {/* ══ Transferencias declaradas sin verificar (flujo existente) ══ */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Landmark className="h-5 w-5 text-muted-foreground" /> Transferencias declaradas sin verificar
          </h2>
          {loading ? (
            <Card><CardContent className="py-12 animate-pulse bg-muted/30" /></Card>
          ) : !items.length ? (
            <Card><CardContent className="py-10 text-center text-muted-foreground">
              No hay transferencias pendientes de conciliar. 🎉
            </CardContent></Card>
          ) : (
            Object.entries(porCuenta).map(([cuenta, lista]) => (
              <div key={cuenta}>
                <h3 className="text-sm font-semibold mb-2 text-muted-foreground">
                  {cuenta} · {fmt((lista as any[]).reduce((s, i) => s + i.monto_transferencias, 0))}
                </h3>
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
              </div>
            ))
          )}
        </section>
      </main>

      {cuentaId && (
        <ImportExtractoDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          cuentaId={cuentaId}
          cuentaNombre={cuentaNombre}
          onImported={loadMovs}
        />
      )}
    </div>
  )
}
