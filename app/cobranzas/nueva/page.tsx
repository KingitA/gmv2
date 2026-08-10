"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { ClienteSearchCombobox } from "@/components/pagos/ClienteSearchCombobox"
import { Loader2, Trash2, Plus } from "lucide-react"
import { toast } from "sonner"

interface Comp {
  id: string
  tipo_comprobante: string
  numero_comprobante: string
  fecha: string
  saldo_pendiente: number
}
interface Asignacion {
  cliente: any
  comprobantes: Comp[]
  seleccion: Record<string, number> // compId -> monto a imputar
  aCuenta: number
}

export default function NuevaCobranzaPage() {
  const router = useRouter()
  const supabase = createClient()
  const [asignaciones, setAsignaciones] = useState<Asignacion[]>([])
  const [tipoInstrumento, setTipoInstrumento] = useState<"cheque" | "efectivo" | "transferencia">("cheque")
  const [cheque, setCheque] = useState({ banco: "", numero: "", fecha_cheque: "", color: "BLANCO" })
  const [transfer, setTransfer] = useState({ numero_comprobante: "", fecha_transferencia: "" })
  const [guardando, setGuardando] = useState(false)
  // Clave de idempotencia: estable ante doble click/reintento, rota al éxito
  const idemKeyRef = useRef<string>(crypto.randomUUID())

  const agregarCliente = async (cliente: any) => {
    if (!cliente) return
    if (asignaciones.some((a) => a.cliente.id === cliente.id)) {
      toast.error("Ese cliente ya está en la cobranza")
      return
    }
    const { data } = await supabase
      .from("comprobantes_venta")
      .select("id, tipo_comprobante, numero_comprobante, fecha, saldo_pendiente")
      .eq("cliente_id", cliente.id)
      .gt("saldo_pendiente", 0)
      .order("fecha", { ascending: true })
    setAsignaciones((prev) => [
      ...prev,
      { cliente, comprobantes: (data as Comp[]) || [], seleccion: {}, aCuenta: 0 },
    ])
  }

  const quitarCliente = (id: string) =>
    setAsignaciones((prev) => prev.filter((a) => a.cliente.id !== id))

  const toggleComp = (ci: number, comp: Comp) => {
    setAsignaciones((prev) => {
      const next = [...prev]
      const sel = { ...next[ci].seleccion }
      if (sel[comp.id] != null) delete sel[comp.id]
      else sel[comp.id] = Number(comp.saldo_pendiente)
      next[ci] = { ...next[ci], seleccion: sel }
      return next
    })
  }

  const setMontoComp = (ci: number, compId: string, monto: number) => {
    setAsignaciones((prev) => {
      const next = [...prev]
      next[ci] = { ...next[ci], seleccion: { ...next[ci].seleccion, [compId]: monto } }
      return next
    })
  }

  const setACuenta = (ci: number, monto: number) => {
    setAsignaciones((prev) => {
      const next = [...prev]
      next[ci] = { ...next[ci], aCuenta: monto }
      return next
    })
  }

  const porcionCliente = (a: Asignacion) =>
    Object.values(a.seleccion).reduce((s, m) => s + (Number(m) || 0), 0) + (Number(a.aCuenta) || 0)

  const total = asignaciones.reduce((s, a) => s + porcionCliente(a), 0)

  const enviar = async (confirmar: boolean) => {
    if (asignaciones.length === 0) { toast.error("Agregá al menos un cliente"); return }
    if (total <= 0) { toast.error("El total debe ser mayor a 0"); return }

    const cheque_compartido =
      tipoInstrumento === "cheque"
        ? { banco: cheque.banco, numero: cheque.numero, fecha_cheque: cheque.fecha_cheque, monto: total, color: cheque.color }
        : null

    const asignacionesBody = asignaciones.map((a) => {
      const porcion = porcionCliente(a)
      const imputaciones = Object.entries(a.seleccion).map(([comprobante_id, monto_imputado]) => ({ comprobante_id, monto_imputado }))
      const metodo: any = { tipo: tipoInstrumento, monto: porcion }
      if (tipoInstrumento === "cheque") metodo.usa_cheque_compartido = true
      if (tipoInstrumento === "transferencia") {
        metodo.numero_comprobante = transfer.numero_comprobante || null
        metodo.fecha_transferencia = transfer.fecha_transferencia || null
      }
      return { cliente_id: a.cliente.id, imputaciones, metodos: [metodo] }
    })

    setGuardando(true)
    try {
      const res = await fetch("/api/cobranzas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origen: "ERP", confirmar, cheque_compartido, asignaciones: asignacionesBody, idempotency_key: idemKeyRef.current }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      idemKeyRef.current = crypto.randomUUID()
      toast.success(
        confirmar
          ? `Cobranza confirmada: ${data.clientes.length} cliente(s), recibos generados.`
          : `Cobranza registrada como PENDIENTE de verificación.`,
      )
      router.push("/clientes")
    } catch (err: any) {
      toast.error("Error: " + err.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="container mx-auto px-6 py-8 max-w-5xl">
      <h1 className="text-3xl font-bold mb-2">Nueva Cobranza (multi-cliente)</h1>
      <p className="text-muted-foreground mb-6">
        Un cobro físico (ej. un cheque por el total) que cancela deudas de varios clientes/CUITs.
      </p>

      <Card className="mb-6">
        <CardHeader><CardTitle>Clientes y comprobantes</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <ClienteSearchCombobox onSelect={agregarCliente} />

          {asignaciones.map((a, ci) => (
            <div key={a.cliente.id} className="border rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-semibold">{a.cliente.razon_social || a.cliente.nombre}</p>
                  <p className="text-xs text-muted-foreground">CUIT: {a.cliente.cuit || "—"}</p>
                </div>
                <button onClick={() => quitarCliente(a.cliente.id)} className="text-red-500 hover:text-red-700">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {a.comprobantes.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin comprobantes con saldo. Podés cobrar "a cuenta" abajo.</p>
              ) : (
                <div className="space-y-1">
                  {a.comprobantes.map((c) => {
                    const sel = a.seleccion[c.id] != null
                    return (
                      <div key={c.id} className="flex items-center gap-3 text-sm py-1">
                        <Checkbox checked={sel} onCheckedChange={() => toggleComp(ci, c)} />
                        <span className="flex-1">{c.tipo_comprobante} {c.numero_comprobante} — saldo ${Number(c.saldo_pendiente).toLocaleString("es-AR")}</span>
                        {sel && (
                          <Input
                            type="number"
                            className="w-32"
                            value={a.seleccion[c.id]}
                            max={Number(c.saldo_pendiente)}
                            onChange={(e) => setMontoComp(ci, c.id, Number(e.target.value) || 0)}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="flex items-center gap-2 mt-3">
                <Label className="text-xs whitespace-nowrap">A cuenta (extra):</Label>
                <Input type="number" className="w-32" value={a.aCuenta || ""} onChange={(e) => setACuenta(ci, Number(e.target.value) || 0)} />
                <span className="ml-auto text-sm font-semibold">Porción: ${porcionCliente(a).toLocaleString("es-AR")}</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader><CardTitle>Instrumento de pago (por el total)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            {(["cheque", "efectivo", "transferencia"] as const).map((t) => (
              <Button key={t} variant={tipoInstrumento === t ? "default" : "outline"} size="sm" onClick={() => setTipoInstrumento(t)}>
                {t === "cheque" ? "Cheque" : t === "efectivo" ? "Efectivo" : "Transferencia"}
              </Button>
            ))}
          </div>

          {tipoInstrumento === "cheque" && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div><Label className="text-xs">Banco</Label><Input value={cheque.banco} onChange={(e) => setCheque({ ...cheque, banco: e.target.value })} /></div>
              <div><Label className="text-xs">Número</Label><Input value={cheque.numero} onChange={(e) => setCheque({ ...cheque, numero: e.target.value })} /></div>
              <div><Label className="text-xs">Fecha cobro</Label><Input type="date" value={cheque.fecha_cheque} onChange={(e) => setCheque({ ...cheque, fecha_cheque: e.target.value })} /></div>
              <div>
                <Label className="text-xs">Color</Label>
                <select className="w-full border rounded h-9 px-2 text-sm" value={cheque.color} onChange={(e) => setCheque({ ...cheque, color: e.target.value })}>
                  <option value="BLANCO">Blanco</option>
                  <option value="NEGRO">Negro</option>
                </select>
              </div>
            </div>
          )}

          {tipoInstrumento === "transferencia" && (
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">N° comprobante</Label><Input value={transfer.numero_comprobante} onChange={(e) => setTransfer({ ...transfer, numero_comprobante: e.target.value })} /></div>
              <div><Label className="text-xs">Fecha</Label><Input type="date" value={transfer.fecha_transferencia} onChange={(e) => setTransfer({ ...transfer, fecha_transferencia: e.target.value })} /></div>
            </div>
          )}

          <div className="flex items-center justify-between border-t pt-3">
            <span className="text-sm text-muted-foreground">Total de la cobranza</span>
            <span className="text-2xl font-bold">${total.toLocaleString("es-AR")}</span>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button size="lg" className="flex-1" onClick={() => enviar(true)} disabled={guardando || total <= 0}>
          {guardando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
          Confirmar cobranza y generar recibos
        </Button>
        <Button size="lg" variant="outline" onClick={() => enviar(false)} disabled={guardando || total <= 0}>
          Registrar sin confirmar
        </Button>
      </div>
    </div>
  )
}
