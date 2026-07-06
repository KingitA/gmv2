"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import {
  ArrowLeft, ArrowRightLeft, TrendingDown, History, Banknote,
  Landmark, LineChart, Wallet, RefreshCw,
} from "lucide-react"
import Link from "next/link"

interface Cuenta {
  cuenta_tipo: string
  cuenta_id: string
  nombre: string
  grupo: "EFECTIVO" | "BANCOS" | "BOLSA" | "BILLETERAS"
  saldos: { BLANCO: number; NEGRO: number }
}

interface Movimiento {
  id: string
  fecha: string
  created_at: string
  tipo_movimiento: string
  concepto: string
  direccion: "ingreso" | "egreso"
  monto_efectivo: number
  gastos: number
  color: string | null
  metodo: string | null
  verificado: boolean
  saldo_despues: number | null
}

const fmt = (n: number) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 })

const GRUPOS: { key: Cuenta["grupo"]; label: string; icon: any }[] = [
  { key: "EFECTIVO", label: "Efectivo", icon: Banknote },
  { key: "BANCOS", label: "Bancos", icon: Landmark },
  { key: "BOLSA", label: "Bolsa", icon: LineChart },
  { key: "BILLETERAS", label: "Billeteras en la calle", icon: Wallet },
]

const CATEGORIAS_EGRESO = ["OPERATIVO", "SUELDOS", "INVERSION", "CREDITO", "IMPUESTOS", "OTROS"]

export default function CajasPage() {
  const { toast } = useToast()
  const [cuentas, setCuentas] = useState<Cuenta[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Modales
  const [showTransfer, setShowTransfer] = useState(false)
  const [showEgreso, setShowEgreso] = useState(false)
  const [historialDe, setHistorialDe] = useState<Cuenta | null>(null)
  const [movimientos, setMovimientos] = useState<Movimiento[]>([])
  const [loadingMov, setLoadingMov] = useState(false)

  // Form transferencia
  const [tOrigen, setTOrigen] = useState("")
  const [tDestino, setTDestino] = useState("")
  const [tMonto, setTMonto] = useState("")
  const [tGastos, setTGastos] = useState("")
  const [tColor, setTColor] = useState("BLANCO")
  const [tConcepto, setTConcepto] = useState("")

  // Form egreso
  const [eOrigen, setEOrigen] = useState("")
  const [eCategoria, setECategoria] = useState("OPERATIVO")
  const [eMonto, setEMonto] = useState("")
  const [eColor, setEColor] = useState("BLANCO")
  const [eConcepto, setEConcepto] = useState("")

  const fetchCuentas = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/finanzas/cajas")
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCuentas(data.cuentas || [])
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { fetchCuentas() }, [fetchCuentas])

  const abrirHistorial = async (cuenta: Cuenta) => {
    setHistorialDe(cuenta)
    setLoadingMov(true)
    try {
      const res = await fetch(
        `/api/finanzas/cajas/movimientos?cuenta_tipo=${cuenta.cuenta_tipo}&cuenta_id=${cuenta.cuenta_id}`
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMovimientos(data.movimientos || [])
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message })
    } finally {
      setLoadingMov(false)
    }
  }

  const keyDe = (c: Cuenta) => `${c.cuenta_tipo}|${c.cuenta_id}`
  const cuentaDe = (key: string) => cuentas.find((c) => keyDe(c) === key)

  const submitTransferencia = async () => {
    const origen = cuentaDe(tOrigen)
    const destino = cuentaDe(tDestino)
    if (!origen || !destino || !tMonto) {
      toast({ variant: "destructive", title: "Error", description: "Completá origen, destino y monto" })
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/finanzas/transferencias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origen_tipo: origen.cuenta_tipo,
          origen_id: origen.cuenta_id,
          destino_tipo: destino.cuenta_tipo,
          destino_id: destino.cuenta_id,
          monto: parseFloat(tMonto),
          gastos: parseFloat(tGastos) || 0,
          color: tColor,
          concepto: tConcepto || `${origen.nombre} → ${destino.nombre}`,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast({
        title: "Transferencia registrada",
        description: `Acreditado neto: ${fmt(data.neto_acreditado)}`,
      })
      setShowTransfer(false)
      setTMonto(""); setTGastos(""); setTConcepto("")
      fetchCuentas()
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message })
    } finally {
      setSaving(false)
    }
  }

  const submitEgreso = async () => {
    const origen = cuentaDe(eOrigen)
    if (!origen || !eMonto || !eConcepto) {
      toast({ variant: "destructive", title: "Error", description: "Completá origen, monto y concepto" })
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/finanzas/egresos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origen_tipo: origen.cuenta_tipo,
          origen_id: origen.cuenta_id,
          categoria: eCategoria,
          monto: parseFloat(eMonto),
          color: eColor,
          concepto: eConcepto,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast({ title: "Egreso registrado" })
      setShowEgreso(false)
      setEMonto(""); setEConcepto("")
      fetchCuentas()
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message })
    } finally {
      setSaving(false)
    }
  }

  const totalGeneral = cuentas.reduce((s, c) => s + c.saldos.BLANCO + c.saldos.NEGRO, 0)

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/finanzas">
                <Button variant="ghost" size="icon">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold">Cajas</h1>
                <p className="text-sm text-muted-foreground">
                  Saldos derivados del kardex contable — Total: {loading ? "…" : fmt(totalGeneral)}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="icon" onClick={fetchCuentas} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
              <Button variant="outline" onClick={() => setShowEgreso(true)}>
                <TrendingDown className="h-4 w-4 mr-2" /> Egreso
              </Button>
              <Button onClick={() => setShowTransfer(true)}>
                <ArrowRightLeft className="h-4 w-4 mr-2" /> Transferir
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 space-y-8">
        {GRUPOS.map(({ key, label, icon: Icon }) => {
          const grupo = cuentas.filter((c) => c.grupo === key)
          if (!loading && grupo.length === 0 && key === "BILLETERAS") return null
          return (
            <section key={key}>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <Icon className="h-5 w-5 text-muted-foreground" /> {label}
                <span className="text-sm font-normal text-muted-foreground">
                  {grupo.length > 0 &&
                    fmt(grupo.reduce((s, c) => s + c.saldos.BLANCO + c.saldos.NEGRO, 0))}
                </span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {loading
                  ? Array.from({ length: 2 }).map((_, i) => (
                      <Card key={i}><CardContent className="py-8 animate-pulse bg-muted/30" /></Card>
                    ))
                  : grupo.map((c) => (
                      <Card key={keyDe(c)}>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base flex items-center justify-between">
                            {c.nombre}
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7"
                              onClick={() => abrirHistorial(c)}
                              title="Historial de movimientos"
                            >
                              <History className="h-4 w-4" />
                            </Button>
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-2xl font-bold">{fmt(c.saldos.BLANCO)}</p>
                          {c.saldos.NEGRO !== 0 && (
                            <p className="text-sm text-muted-foreground mt-1">
                              <Badge variant="outline" className="mr-1">NEGRO</Badge>
                              {fmt(c.saldos.NEGRO)}
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    ))}
              </div>
            </section>
          )
        })}
      </main>

      {/* ─── Modal Transferencia ─── */}
      <Dialog open={showTransfer} onOpenChange={setShowTransfer}>
        <DialogContent>
          <DialogHeader><DialogTitle>Transferir entre cuentas</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Origen</Label>
                <Select value={tOrigen} onValueChange={setTOrigen}>
                  <SelectTrigger><SelectValue placeholder="Cuenta origen" /></SelectTrigger>
                  <SelectContent>
                    {cuentas.map((c) => (
                      <SelectItem key={keyDe(c)} value={keyDe(c)}>
                        {c.nombre} ({fmt(c.saldos.BLANCO)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Destino</Label>
                <Select value={tDestino} onValueChange={setTDestino}>
                  <SelectTrigger><SelectValue placeholder="Cuenta destino" /></SelectTrigger>
                  <SelectContent>
                    {cuentas.filter((c) => keyDe(c) !== tOrigen).map((c) => (
                      <SelectItem key={keyDe(c)} value={keyDe(c)}>{c.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Monto</Label>
                <Input type="number" min="0" value={tMonto} onChange={(e) => setTMonto(e.target.value)} />
              </div>
              <div>
                <Label>Gastos bancarios</Label>
                <Input type="number" min="0" value={tGastos} onChange={(e) => setTGastos(e.target.value)} placeholder="0" />
              </div>
              <div>
                <Label>Color</Label>
                <Select value={tColor} onValueChange={setTColor}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BLANCO">Blanco</SelectItem>
                    <SelectItem value="NEGRO">Negro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Concepto</Label>
              <Input value={tConcepto} onChange={(e) => setTConcepto(e.target.value)} placeholder="Opcional" />
            </div>
            {tMonto && tGastos && (
              <p className="text-sm text-muted-foreground">
                El destino recibe {fmt(Math.max(0, parseFloat(tMonto) - (parseFloat(tGastos) || 0)))} (neto de gastos).
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTransfer(false)}>Cancelar</Button>
            <Button onClick={submitTransferencia} disabled={saving}>
              {saving ? "Registrando..." : "Transferir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Modal Egreso ─── */}
      <Dialog open={showEgreso} onOpenChange={setShowEgreso}>
        <DialogContent>
          <DialogHeader><DialogTitle>Registrar egreso</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Cuenta origen</Label>
                <Select value={eOrigen} onValueChange={setEOrigen}>
                  <SelectTrigger><SelectValue placeholder="Cuenta" /></SelectTrigger>
                  <SelectContent>
                    {cuentas.map((c) => (
                      <SelectItem key={keyDe(c)} value={keyDe(c)}>
                        {c.nombre} ({fmt(c.saldos.BLANCO)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Categoría</Label>
                <Select value={eCategoria} onValueChange={setECategoria}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIAS_EGRESO.map((cat) => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Monto</Label>
                <Input type="number" min="0" value={eMonto} onChange={(e) => setEMonto(e.target.value)} />
              </div>
              <div>
                <Label>Color</Label>
                <Select value={eColor} onValueChange={setEColor}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BLANCO">Blanco</SelectItem>
                    <SelectItem value="NEGRO">Negro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Concepto *</Label>
              <Input value={eConcepto} onChange={(e) => setEConcepto(e.target.value)} placeholder="Detalle del gasto" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEgreso(false)}>Cancelar</Button>
            <Button onClick={submitEgreso} disabled={saving}>
              {saving ? "Registrando..." : "Registrar egreso"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Modal Historial ─── */}
      <Dialog open={!!historialDe} onOpenChange={(o) => !o && setHistorialDe(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Movimientos — {historialDe?.nombre}</DialogTitle>
          </DialogHeader>
          {loadingMov ? (
            <p className="text-center py-8 text-muted-foreground">Cargando...</p>
          ) : movimientos.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">Sin movimientos registrados</p>
          ) : (
            <div className="space-y-2">
              {movimientos.map((m) => (
                <div key={m.id} className="flex items-center justify-between border rounded-lg px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{m.concepto}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(m.created_at).toLocaleString("es-AR")} · {m.tipo_movimiento}
                      {Number(m.gastos) > 0 && ` · gastos ${fmt(Number(m.gastos))}`}
                      {!m.verificado && " · sin verificar"}
                    </p>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className={`font-semibold ${m.direccion === "ingreso" ? "text-green-600" : "text-red-600"}`}>
                      {m.direccion === "ingreso" ? "+" : ""}{fmt(m.monto_efectivo)}
                    </p>
                    {m.saldo_despues != null && (
                      <p className="text-xs text-muted-foreground">saldo {fmt(Number(m.saldo_despues))}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
