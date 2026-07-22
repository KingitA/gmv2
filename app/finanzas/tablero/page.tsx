"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import { ArrowLeft, RefreshCw, Wallet, ShieldCheck, FileWarning, TrendingUp } from "lucide-react"
import Link from "next/link"
import { formatDateAR } from "@/lib/utils"
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
} from "recharts"

const fmt = (n: number) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 })
const fmtC = (n: number) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2, maximumFractionDigits: 2 })

const GRUPO_ORDEN = ["EFECTIVO", "BANCOS", "BOLSA", "BILLETERAS"]
const VENTANA_LABEL: Record<string, string> = {
  VENCIDO: "Vencidos", D7: "≤ 7 días", D15: "8–15 días", D30: "16–30 días", D30MAS: "+30 días",
}

export default function TableroTesoreriaPage() {
  const { toast } = useToast()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/finanzas/tablero")
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

  const porGrupo = useMemo(() => {
    const g: Record<string, { total: number; cuentas: any[] }> = {}
    for (const p of data?.posicion || []) {
      g[p.grupo] = g[p.grupo] || { total: 0, cuentas: [] }
      g[p.grupo].total += Number(p.saldo)
      g[p.grupo].cuentas.push(p)
    }
    return g
  }, [data])

  const totalGeneral = Object.values(porGrupo).reduce((s, g) => s + g.total, 0)

  const chequesPorVentana = useMemo(() => {
    const v: Record<string, { cantidad: number; total: number }> = {}
    for (const c of data?.cheques || []) {
      v[c.ventana] = v[c.ventana] || { cantidad: 0, total: 0 }
      v[c.ventana].cantidad += Number(c.cantidad)
      v[c.ventana].total += Number(c.total)
    }
    return v
  }, [data])

  const enCalle = (data?.dias_calle || []).reduce((s: number, d: any) => s + Number(d.en_calle), 0)
  const verif = data?.verificacion
  const pctVerificado = verif?.total_confirmados
    ? Math.round((1 - Number(verif.sin_verificar) / Number(verif.total_confirmados)) * 100)
    : null

  const aging = data?.aging
  const agingMax = aging ? Math.max(aging.corriente, aging.dias_30_59, aging.dias_60_89, aging.mas_90, 1) : 1
  const agingRows = aging ? [
    { label: "0–29 días", monto: aging.corriente, color: "#93c5fd" },
    { label: "30–59 días", monto: aging.dias_30_59, color: "#3b82f6" },
    { label: "60–89 días", monto: aging.dias_60_89, color: "#1d4ed8" },
    { label: "+90 días", monto: aging.mas_90, color: "#1e3a8a" },
  ] : []

  const proyeccion = (data?.proyeccion || []).map((p: any) => ({
    semana: formatDateAR(p.semana).slice(0, 5),
    "A cobrar (cheques)": Number(p.cheques_a_cobrar),
    "Comprometido": Number(p.pagos_comprometidos) + Number(p.cheques_propios_a_debitar),
  }))

  const alertas = useMemo(() => {
    const a: { tipo: string; texto: string; nivel: "warn" | "crit" }[] = []
    for (const r of data?.rendiciones || []) {
      if (Math.abs(Number(r.diferencia_acumulada)) > 0.01) {
        a.push({
          tipo: "Rendición",
          nivel: "crit",
          texto: `${r.cobrador_nombre} (${r.cobrador_tipo}): diferencia acumulada ${fmtC(Number(r.diferencia_acumulada))} en ${r.con_diferencia} de ${r.rendiciones} rendiciones`,
        })
      }
    }
    if (chequesPorVentana.VENCIDO) {
      a.push({
        tipo: "Cheques",
        nivel: "crit",
        texto: `${chequesPorVentana.VENCIDO.cantidad} cheques vencidos en cartera por ${fmt(chequesPorVentana.VENCIDO.total)} — depositar o reclamar`,
      })
    }
    if (verif && Number(verif.dias_mas_viejo) > 3) {
      a.push({
        tipo: "Verificación",
        nivel: "warn",
        texto: `Hay cobranzas sin verificar hace ${verif.dias_mas_viejo} días (${verif.sin_verificar} en total por ${fmt(Number(verif.monto_sin_verificar))})`,
      })
    }
    for (const d of data?.dias_calle || []) {
      if (d.dias_calle && Number(d.dias_calle) > 7) {
        a.push({
          tipo: "Calle",
          nivel: "warn",
          texto: `${d.cobrador_nombre} tiene ${fmt(Number(d.en_calle))} en la calle (~${d.dias_calle} días de cobranza) — coordinar rendición`,
        })
      }
    }
    return a
  }, [data, chequesPorVentana, verif])

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/finanzas">
              <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold">Tablero de Tesorería</h1>
              <p className="text-sm text-muted-foreground">KPIs en vivo desde el kardex</p>
            </div>
          </div>
          <Button variant="outline" size="icon" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 space-y-8">
        {loading && !data ? (
          <Card><CardContent className="py-16 animate-pulse bg-muted/30" /></Card>
        ) : (
          <>
            {/* ── Fila de KPIs ── */}
            <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-5">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Posición consolidada</p>
                  <p className="text-2xl font-bold tabular-nums">{fmt(totalGeneral)}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {GRUPO_ORDEN.filter((g) => porGrupo[g]).map((g) => `${g.toLowerCase()} ${fmt(porGrupo[g].total)}`).join(" · ")}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Cobranzas verificadas</p>
                  <p className="text-2xl font-bold tabular-nums">{pctVerificado === null ? "—" : `${pctVerificado}%`}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {verif ? `${verif.sin_verificar} sin verificar · la más vieja ${verif.dias_mas_viejo ?? 0} días` : "sin datos"}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Cheques ≤ 30 días</p>
                  <p className="text-2xl font-bold tabular-nums">
                    {fmt((chequesPorVentana.D7?.total ?? 0) + (chequesPorVentana.D15?.total ?? 0) + (chequesPorVentana.D30?.total ?? 0))}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {Object.entries(VENTANA_LABEL).filter(([k]) => chequesPorVentana[k])
                      .map(([k, l]) => `${l}: ${chequesPorVentana[k].cantidad}`).join(" · ") || "sin cheques en cartera"}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Plata en la calle</p>
                  <p className="text-2xl font-bold tabular-nums">{fmt(enCalle)}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {(data?.dias_calle || []).length} billeteras con saldo
                  </p>
                </CardContent>
              </Card>
            </section>

            {/* ── Alertas ── */}
            {alertas.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <FileWarning className="h-5 w-5 text-muted-foreground" /> Alertas
                </h2>
                <div className="space-y-2">
                  {alertas.map((a, i) => (
                    <div key={i} className="flex items-start gap-2 border rounded-lg px-4 py-2.5 text-sm">
                      <Badge className={a.nivel === "crit" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}>
                        {a.tipo}
                      </Badge>
                      <span>{a.texto}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* ── Aging ── */}
              <Card>
                <CardContent className="pt-5">
                  <p className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <Wallet className="h-4 w-4 text-muted-foreground" /> Aging de deuda de clientes
                    <span className="text-muted-foreground font-normal">· total {fmt(aging?.saldo_total ?? 0)}</span>
                  </p>
                  <div className="space-y-2">
                    {agingRows.map((r) => (
                      <div key={r.label} className="flex items-center gap-3 text-sm">
                        <span className="w-24 text-muted-foreground shrink-0">{r.label}</span>
                        <div className="flex-1 h-4 bg-muted/40 rounded">
                          <div className="h-4 rounded" style={{ width: `${Math.max(2, (r.monto / agingMax) * 100)}%`, background: r.color }} />
                        </div>
                        <span className="w-28 text-right tabular-nums font-medium shrink-0">{fmt(r.monto)}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* ── Proyección ── */}
              <Card>
                <CardContent className="pt-5">
                  <p className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-muted-foreground" /> Próximas 12 semanas
                  </p>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={proyeccion} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                        <XAxis dataKey="semana" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                        <YAxis tickFormatter={(v) => `$${(v / 1_000_000).toFixed(1)}M`} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={52} />
                        <Tooltip formatter={(v: any) => fmt(Number(v))} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="A cobrar (cheques)" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="Comprometido" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </section>

            <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* ── Rendiciones ── */}
              <Card>
                <CardContent className="pt-5">
                  <p className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-muted-foreground" /> Rendiciones por cobrador
                  </p>
                  {!(data?.rendiciones || []).length ? (
                    <p className="text-sm text-muted-foreground">Sin rendiciones confirmadas todavía.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground border-b">
                          <th className="py-1.5 font-medium">Cobrador</th>
                          <th className="py-1.5 font-medium text-right">Rendiciones</th>
                          <th className="py-1.5 font-medium text-right">Con diferencia</th>
                          <th className="py-1.5 font-medium text-right">Dif. acumulada</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.rendiciones.map((r: any) => (
                          <tr key={r.cobrador_id} className="border-b last:border-0">
                            <td className="py-1.5">{r.cobrador_nombre} <span className="text-xs text-muted-foreground capitalize">({r.cobrador_tipo})</span></td>
                            <td className="py-1.5 text-right tabular-nums">{r.rendiciones}</td>
                            <td className="py-1.5 text-right tabular-nums">{r.con_diferencia}</td>
                            <td className={`py-1.5 text-right tabular-nums ${Math.abs(Number(r.diferencia_acumulada)) > 0.01 ? "text-red-700 font-semibold" : ""}`}>
                              {fmtC(Number(r.diferencia_acumulada))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>

              {/* ── Cierres recientes ── */}
              <Card>
                <CardContent className="pt-5">
                  <p className="text-sm font-semibold mb-3">Últimos cierres de caja</p>
                  {!(data?.cierres || []).length ? (
                    <p className="text-sm text-muted-foreground">Sin cierres confirmados todavía.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground border-b">
                          <th className="py-1.5 font-medium">Fecha</th>
                          <th className="py-1.5 font-medium">Caja</th>
                          <th className="py-1.5 font-medium text-right">Contado</th>
                          <th className="py-1.5 font-medium text-right">Diferencia</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.cierres.slice(0, 8).map((c: any, i: number) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="py-1.5">{formatDateAR(c.fecha)}</td>
                            <td className="py-1.5">{c.caja ?? "—"}</td>
                            <td className="py-1.5 text-right tabular-nums">{fmtC(Number(c.saldo_contado))}</td>
                            <td className={`py-1.5 text-right tabular-nums ${Number(c.diferencia) !== 0 ? "text-red-700 font-semibold" : "text-green-700"}`}>
                              {fmtC(Number(c.diferencia))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
