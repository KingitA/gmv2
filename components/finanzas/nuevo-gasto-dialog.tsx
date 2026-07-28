"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FechaInput } from "@/components/finanzas/fecha-input"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { todayArgentina } from "@/lib/utils"

import { CATEGORIAS_GASTO } from "@/lib/finanzas/categorias-gasto"

// Para el alta de gastos no ofrecemos "factura" (eso va por proveedores)
const TIPOS = CATEGORIAS_GASTO.filter((c) => c.value !== "factura")
const RECURRENCIAS = [
  { v: "ninguna", l: "Pago único" },
  { v: "mensual", l: "Todos los meses" },
  { v: "bimestral", l: "Cada 2 meses" },
  { v: "trimestral", l: "Cada 3 meses" },
  { v: "semestral", l: "Cada 6 meses" },
  { v: "anual", l: "Una vez al año" },
]

/**
 * Alta de gasto o servicio recurrente desde el panel de finanzas.
 * Crea vencimientos (misma agenda que los proveedores): la serie se mantiene
 * sola hacia adelante (rolling) y, si tiene fin de ciclo, el sistema crea el
 * recordatorio de renovación. Montos: punto = centavos.
 */
export function NuevoGastoDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved?: () => void
}) {
  const [concepto, setConcepto] = useState("")
  const [tipo, setTipo] = useState("servicios")
  const [monto, setMonto] = useState("")
  const [esEstimado, setEsEstimado] = useState(false)
  const [fecha, setFecha] = useState(todayArgentina())
  const [recurrencia, setRecurrencia] = useState("mensual")
  const [finCiclo, setFinCiclo] = useState("")
  const [formaPago, setFormaPago] = useState("transferencia")
  const [modalidad, setModalidad] = useState("deposito")
  const [saving, setSaving] = useState(false)

  const reset = () => {
    setConcepto(""); setTipo("servicios"); setMonto(""); setEsEstimado(false)
    setFecha(todayArgentina()); setRecurrencia("mensual"); setFinCiclo("")
    setFormaPago("transferencia"); setModalidad("deposito")
  }

  const parseMonto = (s: string) => {
    const t = s.trim().replace(",", ".")
    if (!t || !/^\d+(\.\d{0,2})?$/.test(t)) return null
    return Number(t)
  }

  const guardar = async () => {
    const m = parseMonto(monto)
    if (!concepto.trim()) { toast.error("Poné un concepto (ej: VEP 931, Seguro camioneta)"); return }
    if (m === null || m <= 0) { toast.error("Monto inválido — el punto son centavos: 1000.5 = $1.000,50"); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { toast.error("Fecha inválida"); return }
    setSaving(true)
    try {
      const res = await fetch("/api/vencimientos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          concepto: concepto.trim(),
          tipo,
          monto: m,
          fecha_vencimiento: fecha,
          recurrencia: recurrencia === "ninguna" ? null : recurrencia,
          recurrencia_hasta: recurrencia !== "ninguna" && finCiclo ? finCiclo : null,
          forma_pago: formaPago,
          modalidad,
          es_estimado: esEstimado,
          descuentos_aplicados: true,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      toast.success(
        recurrencia === "ninguna"
          ? "Gasto agendado"
          : `Serie creada — las próximas cuotas se generan solas${finCiclo ? " y al fin del ciclo te avisa para renovar" : ""}`
      )
      reset()
      onOpenChange(false)
      onSaved?.()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo gasto o servicio</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Concepto</Label>
            <Input value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Ej: VEP 931 · Seguro camioneta · Hosting web" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={setTipo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TIPOS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Monto</Label>
              <Input inputMode="decimal" className="tabular-nums" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0.00" />
              <p className="mt-1 text-[11px] text-muted-foreground">Punto = centavos</p>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer -mt-1">
            <input type="checkbox" className="h-4 w-4" checked={esEstimado} onChange={(e) => setEsEstimado(e.target.checked)} />
            El monto varía (es un estimado — lo corregís cuando llega el real)
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Primer vencimiento</Label>
              <FechaInput value={fecha} onChange={setFecha} />
            </div>
            <div>
              <Label>Se repite</Label>
              <Select value={recurrencia} onValueChange={setRecurrencia}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{RECURRENCIAS.map(r => <SelectItem key={r.v} value={r.v}>{r.l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {recurrencia !== "ninguna" && (
            <div>
              <Label>Fin de ciclo (opcional — ej. seguro trimestral)</Label>
              <FechaInput value={finCiclo} onChange={setFinCiclo} />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Si lo cargás, al acercarse esa fecha el sistema crea solo el recordatorio de renovación con el estimado del ciclo.
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Forma de pago</Label>
              <Select value={formaPago} onValueChange={setFormaPago}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="transferencia">Transferencia / débito</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                  <SelectItem value="efectivo">Efectivo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Modalidad</Label>
              <Select value={modalidad} onValueChange={setModalidad}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="deposito">Lo pago yo</SelectItem>
                  <SelectItem value="entrega">Lo retiran por caja</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="button" disabled={saving} onClick={guardar}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Agendar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
