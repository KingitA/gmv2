"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FechaInput } from "@/components/finanzas/fecha-input"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

export interface VencimientoEditable {
  id: string
  concepto?: string | null
  monto: number
  fecha_vencimiento: string
  forma_pago?: string | null
  modalidad?: string | null
  descuentos_aplicados?: boolean | null
  proveedores?: { nombre?: string | null } | null
}

/**
 * Edición rápida de un vencimiento desde la lista de pagos del panel.
 * Mismo backend que el calendario (PUT/DELETE /api/vencimientos).
 * Montos: el punto delimita centavos (1000.5 = $1.000,50).
 */
export function VencimientoEditDialog({
  venc,
  open,
  onOpenChange,
  onSaved,
}: {
  venc: VencimientoEditable | null
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved?: () => void
}) {
  const [monto, setMonto] = useState("")
  const [fecha, setFecha] = useState("")
  const [formaPago, setFormaPago] = useState("transferencia")
  const [modalidad, setModalidad] = useState("deposito")
  const [descuentos, setDescuentos] = useState(false)
  const [concepto, setConcepto] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (venc && open) {
      setMonto(String(venc.monto ?? ""))
      setFecha(venc.fecha_vencimiento ?? "")
      setFormaPago(venc.forma_pago || "transferencia")
      setModalidad(venc.modalidad || "deposito")
      setDescuentos(Boolean(venc.descuentos_aplicados))
      setConcepto(venc.concepto ?? "")
    }
  }, [venc, open])

  if (!venc) return null
  const titulo = venc.proveedores?.nombre || venc.concepto || "Vencimiento"

  const parseMonto = (s: string) => {
    const t = s.trim().replace(",", ".")
    if (!t || !/^\d+(\.\d{0,2})?$/.test(t)) return null
    return Number(t)
  }

  const guardar = async () => {
    const m = parseMonto(monto)
    if (m === null || m <= 0) {
      toast.error("Monto inválido — el punto son centavos: 1000.5 = $1.000,50")
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      toast.error("Fecha inválida")
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/vencimientos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: venc.id,
          monto: m,
          fecha_vencimiento: fecha,
          forma_pago: formaPago,
          modalidad,
          descuentos_aplicados: descuentos,
          concepto: concepto || null,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      toast.success("Vencimiento actualizado")
      onOpenChange(false)
      onSaved?.()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const marcarPagado = async () => {
    if (!confirm(`¿Marcar "${titulo}" como pagado?`)) return
    setSaving(true)
    try {
      const res = await fetch("/api/vencimientos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: venc.id, estado: "pagado" }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      toast.success(
        formaPago === "cheque"
          ? "Pago marcado. Registrá con qué cheques fue desde el calendario completo (para descargarlos de cartera)."
          : "Pago marcado como pagado"
      )
      onOpenChange(false)
      onSaved?.()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const eliminar = async () => {
    if (!confirm(`¿Eliminar el pago "${titulo}" por ${monto}? Queda cancelado (no se borra el registro).`)) return
    setSaving(true)
    try {
      const res = await fetch(`/api/vencimientos?id=${venc.id}`, { method: "DELETE" })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      toast.success("Vencimiento cancelado")
      onOpenChange(false)
      onSaved?.()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar pago — {titulo}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Monto</Label>
              <Input inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} className="tabular-nums" />
              <p className="mt-1 text-[11px] text-muted-foreground">Punto = centavos</p>
            </div>
            <div>
              <Label>Vence</Label>
              <FechaInput value={fecha} onChange={setFecha} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Forma de pago</Label>
              <Select value={formaPago} onValueChange={setFormaPago}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="transferencia">Transferencia</SelectItem>
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
                  <SelectItem value="deposito">Lo deposito yo</SelectItem>
                  <SelectItem value="entrega">Lo retiran por caja</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Concepto</Label>
            <Input value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Ej: factura julio" />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" className="h-4 w-4" checked={descuentos} onChange={(e) => setDescuentos(e.target.checked)} />
            Descuentos / NC ya aplicados (listo para pagar)
          </label>
          <div className="flex items-center gap-2 flex-wrap">
            <Button type="button" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50 mr-auto" disabled={saving} onClick={eliminar}>
              Eliminar
            </Button>
            <Button type="button" variant="outline" className="text-green-700 border-green-300 hover:bg-green-50" disabled={saving} onClick={marcarPagado}>
              ✓ Marcar pagado
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="button" disabled={saving} onClick={guardar}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Guardar cambios
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
