"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { InputMonto } from "@/components/ui/input-monto"
import { DateInputAR } from "@/components/ui/date-input-ar"
import { moneda } from "@/lib/formato"
import { cn } from "@/lib/utils"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

type Cartera = "BLANCO" | "NEGRO" | "ECHEQ"

const CARTERAS: { v: Cartera; label: string }[] = [
  { v: "BLANCO", label: "Blanco" },
  { v: "NEGRO", label: "Negro" },
  { v: "ECHEQ", label: "Echeq" },
]

/**
 * Carga a mano de un cheque de tercero sin cliente ni proveedor (venta de
 * pallets, venta del camión…). Queda en cartera; "Guardar y agregar otro"
 * deja el diálogo abierto con banco, origen, cartera y fechas para cargar
 * varios seguidos.
 */
export function ChequeManualDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved?: () => void
}) {
  const [numero, setNumero] = useState("")
  const [banco, setBanco] = useState("")
  const [monto, setMonto] = useState<number | null>(null)
  const [fechaEmision, setFechaEmision] = useState("")
  const [fechaVenc, setFechaVenc] = useState("")
  const [cartera, setCartera] = useState<Cartera | "">("")
  const [origen, setOrigen] = useState("")
  const [observaciones, setObservaciones] = useState("")
  const [saving, setSaving] = useState(false)
  const [cargados, setCargados] = useState<{ numero: string; monto: number }[]>([])
  const numeroRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setNumero("")
      setBanco("")
      setMonto(null)
      setFechaEmision("")
      setFechaVenc("")
      setCartera("")
      setOrigen("")
      setObservaciones("")
      setCargados([])
    }
  }, [open])

  const error = (): string | null => {
    if (!numero.trim()) return "Falta el número"
    if (!banco.trim()) return "Falta el banco"
    if (monto == null || monto <= 0) return "El monto tiene que ser mayor a cero"
    if (!fechaVenc) return "Falta la fecha de vencimiento"
    if (!cartera) return "Elegí la cartera (Blanco, Negro o Echeq)"
    if (!origen.trim()) return "Falta el origen (ej. Venta de pallets)"
    return null
  }

  const guardar = async (otro: boolean) => {
    const err = error()
    if (err) {
      toast.error(err)
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/cheques/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numero: numero.trim(),
          banco: banco.trim(),
          monto,
          fecha_emision: fechaEmision || null,
          fecha_vencimiento: fechaVenc,
          cartera,
          origen: origen.trim(),
          observaciones: observaciones.trim() || null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || "No se pudo cargar el cheque")
      toast.success(`Cheque Nº ${numero.trim()} cargado en cartera`)
      onSaved?.()
      if (otro) {
        setCargados((prev) => [...prev, { numero: numero.trim(), monto: monto ?? 0 }])
        setNumero("")
        setMonto(null)
        setObservaciones("")
        setTimeout(() => numeroRef.current?.focus(), 0)
      } else {
        onOpenChange(false)
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const totalCargados = cargados.reduce((s, c) => s + c.monto, 0)

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cargar cheque</DialogTitle>
          <DialogDescription>
            Cheque de tercero que no viene de un cliente (venta de pallets, del camión…). Queda en cartera; no
            toca cajas ni cuentas corrientes.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-[13px] font-semibold text-neutro-600">Número *</Label>
            <Input ref={numeroRef} value={numero} onChange={(e) => setNumero(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1">
            <Label className="text-[13px] font-semibold text-neutro-600">Banco *</Label>
            <Input value={banco} onChange={(e) => setBanco(e.target.value)} placeholder="Galicia, Nación…" />
          </div>
          <div className="space-y-1">
            <Label className="text-[13px] font-semibold text-neutro-600">Monto *</Label>
            <InputMonto pesos soloPositivos value={monto} onChange={setMonto} />
          </div>
          <div className="space-y-1">
            <Label className="text-[13px] font-semibold text-neutro-600">Cartera *</Label>
            <div className="flex gap-1.5">
              {CARTERAS.map((c) => (
                <button
                  key={c.v}
                  type="button"
                  onClick={() => setCartera(c.v)}
                  className={cn(
                    "h-9 flex-1 rounded-md border text-sm font-medium transition-colors",
                    cartera === c.v
                      ? "border-azul-600 bg-azul-600 text-white"
                      : "border-neutro-300 bg-white text-neutro-700 hover:bg-neutro-50"
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-[13px] font-semibold text-neutro-600">Fecha de emisión</Label>
            <DateInputAR value={fechaEmision} onChange={setFechaEmision} />
          </div>
          <div className="space-y-1">
            <Label className="text-[13px] font-semibold text-neutro-600">Fecha de vencimiento *</Label>
            <DateInputAR value={fechaVenc} onChange={setFechaVenc} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-[13px] font-semibold text-neutro-600">Origen *</Label>
            <Input value={origen} onChange={(e) => setOrigen(e.target.value)} placeholder="Venta de pallets, Venta del camión…" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-[13px] font-semibold text-neutro-600">Observaciones</Label>
            <Input value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
          </div>
        </div>

        {cargados.length > 0 && (
          <p className="rounded-lg bg-exito-50 px-3 py-2 text-sm text-exito-700">
            Cargados en esta tanda: <b>{cargados.length}</b> · {moneda(totalCargados)}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {cargados.length ? "Terminar" : "Cancelar"}
          </Button>
          <Button variant="outline" onClick={() => guardar(true)} disabled={saving}>
            Guardar y agregar otro
          </Button>
          <Button onClick={() => guardar(false)} disabled={saving}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
