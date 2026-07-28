"use client"

import { useEffect, useState, useCallback } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ArrowLeft, CreditCard, Landmark, CheckCircle2, XCircle, RefreshCw } from "lucide-react"
import Link from "next/link"
import { MoneyColorBadge } from "@/components/finanzas/MoneyColorBadge"
import { useToast } from "@/hooks/use-toast"

interface Cheque {
  id: string
  banco: string
  numero: string
  fecha_vencimiento: string
  monto: number
  color: string
  estado: string
  es_echeq?: boolean
  cliente_nombre?: string | null
  cuenta_deposito_nombre?: string | null
}

const fmt = (n: number) =>
  Number(n).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 })

const fecha = (d: string) =>
  new Date(d).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })

type Accion = { tipo: "depositar" | "acreditar" | "rechazar"; cheque: Cheque } | null

export default function ChequesPage() {
  const [cheques, setCheques] = useState<Cheque[]>([])
  const [cuentas, setCuentas] = useState<{ id: string; nombre: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [accion, setAccion] = useState<Accion>(null)
  const [cuentaBanco, setCuentaBanco] = useState("")
  const [gastos, setGastos] = useState("")
  const [motivo, setMotivo] = useState("")
  const { toast } = useToast()

  const loadCheques = useCallback(async () => {
    setLoading(true)
    try {
      const [chRes, ctRes] = await Promise.all([
        fetch("/api/cheques"),
        fetch("/api/finanzas/cajas"),
      ])
      const chData = await chRes.json()
      if (!chRes.ok) throw new Error(chData.error)
      setCheques(chData.cheques || [])
      const ctData = await ctRes.json()
      setCuentas(
        (ctData.cuentas || [])
          .filter((c: any) => c.cuenta_tipo === "BANCO")
          .map((c: any) => ({ id: c.cuenta_id, nombre: c.nombre }))
      )
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { loadCheques() }, [loadCheques])

  const abrirAccion = (tipo: NonNullable<Accion>["tipo"], cheque: Cheque) => {
    setAccion({ tipo, cheque })
    setCuentaBanco("")
    setGastos("")
    setMotivo("")
  }

  const ejecutarAccion = async () => {
    if (!accion) return
    const { tipo, cheque } = accion
    if (tipo === "depositar" && !cuentaBanco) {
      toast({ title: "Error", description: "Seleccioná la cuenta bancaria", variant: "destructive" })
      return
    }
    setSaving(true)
    try {
      const body =
        tipo === "depositar"
          ? { cuenta_banco_id: cuentaBanco, gastos: parseFloat(gastos) || 0 }
          : tipo === "acreditar"
            ? { gastos: parseFloat(gastos) || 0 }
            : { motivo_rechazo: motivo || "Cheque rechazado", gastos: parseFloat(gastos) || 0 }
      const res = await fetch(`/api/cheques/${cheque.id}/${tipo}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast({
        title:
          tipo === "depositar" ? "Cheque depositado"
          : tipo === "acreditar" ? `Acreditado ${fmt(data.neto_acreditado ?? cheque.monto)}`
          : "Cheque rechazado",
        description: data.mensaje,
      })
      setAccion(null)
      loadCheques()
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const cartera = cheques.filter((c) => c.estado === "EN_CARTERA")
  const depositados = cheques.filter((c) => c.estado === "DEPOSITADO")
  const historial = cheques.filter((c) => ["COBRADO", "RECHAZADO", "ANULADO", "ENTREGADO_A_PROVEEDOR"].includes(c.estado))

  const filaBase = (c: Cheque) => (
    <>
      <TableCell className="font-medium">{c.banco}</TableCell>
      <TableCell>{c.numero}</TableCell>
      <TableCell>{c.cliente_nombre ?? "—"}</TableCell>
      <TableCell>{fecha(c.fecha_vencimiento)}</TableCell>
      <TableCell className="font-bold">{fmt(c.monto)}</TableCell>
      <TableCell>
        <span className="inline-flex items-center gap-1.5">
          <MoneyColorBadge color={c.color as any} />
          {c.es_echeq && <Badge variant="secondary">e-cheq</Badge>}
        </span>
      </TableCell>
    </>
  )

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/finanzas">
                <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold">Cartera de Cheques</h1>
                <p className="text-sm text-muted-foreground">
                  Ciclo completo: cartera → depósito → acreditación (con gastos bancarios)
                </p>
              </div>
            </div>
            <Button variant="outline" size="icon" onClick={loadCheques} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <Tabs defaultValue="cartera">
          <TabsList>
            <TabsTrigger value="cartera">
              <CreditCard className="h-4 w-4 mr-2" /> En Cartera ({cartera.length})
            </TabsTrigger>
            <TabsTrigger value="depositados">
              <Landmark className="h-4 w-4 mr-2" /> Depositados ({depositados.length})
            </TabsTrigger>
            <TabsTrigger value="historial">Historial ({historial.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="cartera" className="mt-4">
            {cartera.length === 0 ? (
              <Card><CardContent className="py-12 text-center text-muted-foreground">No hay cheques en cartera</CardContent></Card>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Banco</TableHead><TableHead>Número</TableHead>
                    <TableHead>Cliente</TableHead><TableHead>Vencimiento</TableHead>
                    <TableHead>Monto</TableHead><TableHead>Color</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cartera.map((c) => (
                    <TableRow key={c.id}>
                      {filaBase(c)}
                      <TableCell className="text-right space-x-2">
                        <Button size="sm" variant="outline" onClick={() => abrirAccion("depositar", c)}>
                          Depositar
                        </Button>
                        <Button size="sm" variant="ghost" className="text-red-600" onClick={() => abrirAccion("rechazar", c)}>
                          Rechazar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          <TabsContent value="depositados" className="mt-4">
            {depositados.length === 0 ? (
              <Card><CardContent className="py-12 text-center text-muted-foreground">No hay cheques depositados</CardContent></Card>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Banco</TableHead><TableHead>Número</TableHead>
                    <TableHead>Cliente</TableHead><TableHead>Vencimiento</TableHead>
                    <TableHead>Monto</TableHead><TableHead>Color</TableHead>
                    <TableHead>Depositado en</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {depositados.map((c) => (
                    <TableRow key={c.id}>
                      {filaBase(c)}
                      <TableCell>{c.cuenta_deposito_nombre ?? "—"}</TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button size="sm" onClick={() => abrirAccion("acreditar", c)}>
                          <CheckCircle2 className="h-4 w-4 mr-1" /> Acreditar
                        </Button>
                        <Button size="sm" variant="ghost" className="text-red-600" onClick={() => abrirAccion("rechazar", c)}>
                          <XCircle className="h-4 w-4 mr-1" /> Rechazado
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          <TabsContent value="historial" className="mt-4">
            {historial.length === 0 ? (
              <Card><CardContent className="py-12 text-center text-muted-foreground">Sin movimientos históricos</CardContent></Card>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Banco</TableHead><TableHead>Número</TableHead>
                    <TableHead>Cliente</TableHead><TableHead>Vencimiento</TableHead>
                    <TableHead>Monto</TableHead><TableHead>Color</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historial.map((c) => (
                    <TableRow key={c.id}>
                      {filaBase(c)}
                      <TableCell>
                        <Badge variant={c.estado === "COBRADO" ? "default" : c.estado === "RECHAZADO" ? "destructive" : "outline"}>
                          {c.estado}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>
        </Tabs>

        {/* ─── Modal de acción ─── */}
        <Dialog open={!!accion} onOpenChange={(o) => !o && setAccion(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {accion?.tipo === "depositar" && "Depositar cheque"}
                {accion?.tipo === "acreditar" && "Acreditar cheque"}
                {accion?.tipo === "rechazar" && "Rechazar cheque"}
              </DialogTitle>
            </DialogHeader>
            {accion && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {accion.cheque.banco} Nº {accion.cheque.numero} — {fmt(accion.cheque.monto)}
                  {accion.cheque.cliente_nombre && ` · ${accion.cheque.cliente_nombre}`}
                </p>
                {accion.tipo === "depositar" && (
                  <div>
                    <Label>Cuenta bancaria de depósito</Label>
                    <Select value={cuentaBanco} onValueChange={setCuentaBanco}>
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
                  <div>
                    <Label>Motivo del rechazo</Label>
                    <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Sin fondos, defecto formal..." />
                  </div>
                )}
                <div>
                  <Label>Gastos bancarios</Label>
                  <Input type="number" min="0" value={gastos} onChange={(e) => setGastos(e.target.value)} placeholder="0" />
                  {accion.tipo === "acreditar" && gastos && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Se acreditan {fmt(Math.max(0, Number(accion.cheque.monto) - (parseFloat(gastos) || 0)))} netos.
                    </p>
                  )}
                  {accion.tipo === "rechazar" && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Si el pago origen estaba confirmado, se genera ND al cliente (monto + gastos).
                    </p>
                  )}
                </div>
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
      </main>
    </div>
  )
}
